const XLSX = require('xlsx');
const JSZip = require('jszip');
const { getProfile, exportModelsForProfile, exportModelsForProfiles } = require('./modelProfiles');
const { classifyField, scanModel } = require('./scanner');
const { getExternalIds, ensureExternalId, getXmlIdsForRelations } = require('./externalId');
const { SYSTEM_FIELDS, uniq, nowIso, flattenError, shouldSkipModel } = require('./utils');

function cleanSheetName(model) {
  return model.replace(/[^a-zA-Z0-9_\.]/g, '_').slice(0, 31);
}

function pickExportFields(model, fieldsMeta, options = {}) {
  const profile = getProfile(model);
  if (profile.includeFields && !options.rawAllFields) return profile.includeFields.filter(f => fieldsMeta[f]);
  const out = [];
  for (const [name, meta] of Object.entries(fieldsMeta)) {
    const c = classifyField(name, meta);
    if (!c.importable) continue;
    if (meta.type === 'binary' && !options.includeBinary) continue;
    if (SYSTEM_FIELDS.has(name)) continue;
    out.push(name);
  }
  return out.sort();
}

function scalarValue(value) {
  if (Array.isArray(value)) {
    if (value.length === 2 && Number.isInteger(value[0]) && typeof value[1] === 'string') return value[1];
    return value.join(',');
  }
  if (value === false || value === null || value === undefined) return '';
  return value;
}

async function relationMapsForRows(client, model, rows, fieldsMeta, exportFields) {
  const relationIdsByModel = {};
  for (const f of exportFields) {
    const meta = fieldsMeta[f];
    if (!meta || !['many2one', 'many2many'].includes(meta.type) || !meta.relation) continue;
    relationIdsByModel[meta.relation] ||= new Set();
    for (const r of rows) {
      const v = r[f];
      if (meta.type === 'many2one' && Array.isArray(v) && v[0]) relationIdsByModel[meta.relation].add(v[0]);
      if (meta.type === 'many2many' && Array.isArray(v)) v.forEach(id => relationIdsByModel[meta.relation].add(id));
    }
  }
  const maps = {};
  for (const [relModel, idsSet] of Object.entries(relationIdsByModel)) {
    maps[relModel] = await getXmlIdsForRelations(client, relModel, Array.from(idsSet));
  }
  return maps;
}

async function exportModelRows(client, model, options = {}) {
  const profile = getProfile(model);
  const scan = await scanModel(client, model);
  if (!scan.exists) return { model, rows: [], fields: [], warnings: [`Model ${model} tidak tersedia di source.`] };

  const fieldsMeta = scan.fields;
  const exportFields = pickExportFields(model, fieldsMeta, options);
  const domain = options.domain || ((options.rawAllFields || options.ignoreProfileDomain) ? [] : (profile.domain || []));
  let searchKwargs = { order: options.order || 'id asc' };
  if (Number.isInteger(Number(options.offset)) && Number(options.offset) > 0) searchKwargs.offset = Number(options.offset);
  const wantsAll = options.exportAll === true || options.limit === 0 || options.limit === null || options.limit === 'all';
  if (!wantsAll) searchKwargs.limit = Number(options.limit || profile.limit || 1000);
  const ids = await client.search(model, domain, searchKwargs);
  if (!ids.length) return { model, rows: [], fields: exportFields, warnings: [] };

  const rawRows = await client.readInChunks(model, ids, uniq(['id', 'display_name', ...exportFields]), options.readChunkSize || 80);
  const xmlidMap = await getExternalIds(client, model, ids);
  if (options.ensureExternalIds) {
    for (const r of rawRows) {
      if (!xmlidMap.has(r.id)) {
        const xmlid = await ensureExternalId(client, model, r.id, options.module || 'lokalmart_mig');
        xmlidMap.set(r.id, xmlid);
      }
    }
  }
  const relationMaps = await relationMapsForRows(client, model, rawRows, fieldsMeta, exportFields);

  const rows = [];
  const warnings = [];
  for (const r of rawRows) {
    const out = {
      '__action': 'upsert',
      '_model': model,
      '_external_id': xmlidMap.get(r.id) || '',
      '_old_db_id': r.id,
      '_display_name': r.display_name || ''
    };
    if (!out._external_id) warnings.push(`Record ${model}:${r.id} belum punya External ID.`);
    for (const f of exportFields) {
      const meta = fieldsMeta[f];
      if (!meta) continue;
      const v = r[f];
      if (meta.type === 'many2one') {
        const relId = Array.isArray(v) ? v[0] : false;
        out[`${f}_external_id`] = relId ? (relationMaps[meta.relation]?.get(relId) || '') : '';
        out[`${f}_display_name`] = Array.isArray(v) ? v[1] : '';
      } else if (meta.type === 'many2many') {
        const ids = Array.isArray(v) ? v : [];
        out[`${f}_external_ids`] = ids.map(id => relationMaps[meta.relation]?.get(id) || '').filter(Boolean).join(',');
      } else {
        out[f] = scalarValue(v);
      }
    }
    rows.push(out);
  }
  return { model, rows, fields: exportFields, warnings };
}

function workbookToBase64(wb) {
  const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx', compression: true });
  return buffer.toString('base64');
}

function addJsonSheet(wb, name, data) {
  const rows = Array.isArray(data) ? data : [data];
  const ws = XLSX.utils.json_to_sheet(rows.length ? rows : [{}]);
  XLSX.utils.book_append_sheet(wb, ws, cleanSheetName(name));
}


async function discoverArchiveModels(client, options = {}) {
  const domain = options.includeTransient ? [] : [['transient', '=', false]];
  const rows = await client.searchRead('ir.model', domain, ['model', 'name', 'state', 'transient'], { limit: options.modelLimit || 100000, order: 'model asc' });
  const blockedPrefixes = options.includeUnsafe ? [] : ['mail.message', 'mail.mail', 'bus.', 'ir.logging'];
  return rows
    .map(r => r.model)
    .filter(Boolean)
    .filter(model => options.includeUnsafe || !shouldSkipModel(model))
    .filter(model => !blockedPrefixes.some(prefix => model === prefix || model.startsWith(prefix)));
}


async function countModelRows(client, model, options = {}) {
  const profile = getProfile(model);
  const scan = await scanModel(client, model);
  if (!scan.exists) return { model, exists: false, count: 0, warning: `Model ${model} tidak tersedia di source.` };
  const domain = options.domain || ((options.rawAllFields || options.ignoreProfileDomain) ? [] : (profile.domain || []));
  const count = await client.searchCount(model, domain);
  return { model, exists: true, count };
}

async function exportSingleModelXlsx(client, model, options = {}) {
  const limit = Number(options.limit || options.batchSize || 500);
  const offset = Number(options.offset || 0);
  const pageOptions = {
    ...options,
    exportAll: false,
    limit,
    offset,
    rawAllFields: options.rawAllFields !== false,
    ensureExternalIds: options.ensureExternalIds !== false,
    module: options.module || 'lokalmart_mig'
  };
  const wb = XLSX.utils.book_new();
  const countInfo = options.skipCount ? { count: null } : await countModelRows(client, model, pageOptions);
  const result = await exportModelRows(client, model, pageOptions);
  const safeModel = model.replace(/[^a-zA-Z0-9_.-]/g, '_');
  const part = Math.floor(offset / Math.max(limit, 1)) + 1;
  addJsonSheet(wb, '00_manifest', [{
    generated_at: nowIso(),
    source_url: client.url,
    format: 'lokalmart-single-model-xlsx-v1',
    model,
    offset,
    limit,
    total_estimate: countInfo.count,
    rows_exported: result.rows.length,
    part,
    next_offset: offset + result.rows.length,
    done: countInfo.count == null ? result.rows.length < limit : (offset + result.rows.length >= countInfo.count),
    note: 'Single-model migration-safe XLSX. Full database archive mode downloads many independent XLSX files, not ZIP.'
  }]);
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(result.rows.length ? result.rows : [{ _model: model, _note: 'Tidak ada record pada batch ini.' }]), cleanSheetName(model));
  addJsonSheet(wb, '99_export_report', [{ model, offset, limit, total: countInfo.count, rows: result.rows.length, warnings: result.warnings.join(' | ') }]);
  return {
    filename: `lokalmart_${safeModel}_part_${String(part).padStart(4, '0')}_${new Date().toISOString().slice(0, 10)}.xlsx`,
    mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    base64: workbookToBase64(wb),
    model,
    offset,
    limit,
    part,
    total: countInfo.count,
    rows: result.rows.length,
    nextOffset: offset + result.rows.length,
    done: countInfo.count == null ? result.rows.length < limit : (offset + result.rows.length >= countInfo.count),
    warnings: result.warnings
  };
}

async function exportMigrationXlsx(client, options = {}) {
  const models = options.discoverAllModels ? await discoverArchiveModels(client, options) : (options.models || exportModelsForProfiles(options.profiles || options.profile || 'full'));
  const wb = XLSX.utils.book_new();
  addJsonSheet(wb, '00_manifest', [{
    generated_at: nowIso(),
    profile: Array.isArray(options.profiles) ? options.profiles.join(',') : (options.profile || options.profiles || 'full'),
    source_url: client.url,
    models: models.join(','),
    note: 'Migration-safe XLSX. Import memakai _external_id dan kolom *_external_id.'
  }]);

  const report = [];
  for (const model of models) {
    try {
      const result = await exportModelRows(client, model, options);
      const ws = XLSX.utils.json_to_sheet(result.rows.length ? result.rows : [{ _model: model, _note: 'Tidak ada record atau model tidak tersedia.' }]);
      XLSX.utils.book_append_sheet(wb, ws, cleanSheetName(model));
      report.push({ model, rows: result.rows.length, warnings: result.warnings.join(' | ') });
    } catch (err) {
      const msg = flattenError(err);
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet([{ _model: model, error: msg }]), cleanSheetName(model));
      report.push({ model, rows: 0, error: msg });
    }
  }
  addJsonSheet(wb, '99_export_report', report);
  return {
    filename: `lokalmart_migration_${Array.isArray(options.profiles) ? options.profiles.join('-') : (options.profile || options.profiles || 'full')}_${new Date().toISOString().slice(0, 10)}.xlsx`,
    mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    base64: workbookToBase64(wb),
    report
  };
}

async function exportMigrationPackageZip(client, options = {}) {
  const zip = new JSZip();
  const models = options.discoverAllModels ? await discoverArchiveModels(client, options) : (options.models || exportModelsForProfiles(options.profiles || options.profile || 'full'));
  const manifest = {
    generated_at: nowIso(),
    profile: Array.isArray(options.profiles) ? options.profiles.join(',') : (options.profile || options.profiles || 'full'),
    source_url: client.url,
    models,
    format: 'lokalmart-odoo-migration-package-v1'
  };
  zip.file('manifest.json', JSON.stringify(manifest, null, 2));
  const report = [];
  for (const model of models) {
    try {
      const wb = XLSX.utils.book_new();
      const result = await exportModelRows(client, model, options);
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(result.rows.length ? result.rows : [{ _model: model, _note: 'Tidak ada record.' }]), cleanSheetName(model));
      const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx', compression: true });
      const folder = model.startsWith('ir.') ? '00_schema' : model.startsWith('account.') ? '02_accounting' : model.startsWith('project.') ? '03_projects' : ['website', 'ir.ui.view'].includes(model) ? '04_website' : '01_master_data';
      zip.file(`${folder}/${model}.xlsx`, buffer);
      report.push({ model, rows: result.rows.length, warnings: result.warnings });
    } catch (err) {
      report.push({ model, rows: 0, error: flattenError(err) });
    }
  }
  zip.file('logs/export_report.json', JSON.stringify(report, null, 2));
  const buffer = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
  return {
    filename: `lokalmart_migration_package_${Array.isArray(options.profiles) ? options.profiles.join('-') : (options.profile || options.profiles || 'full')}_${new Date().toISOString().slice(0, 10)}.zip`,
    mime: 'application/zip',
    base64: buffer.toString('base64'),
    report
  };
}


async function exportFullDatabaseArchiveZip(client, options = {}) {
  const archiveOptions = {
    ...options,
    discoverAllModels: options.discoverAllModels !== false,
    exportAll: true,
    rawAllFields: true,
    includeBinary: options.includeBinary === true,
    ensureExternalIds: options.ensureExternalIds !== false,
    module: options.module || 'lokalmart_mig'
  };
  const result = await exportMigrationPackageZip(client, archiveOptions);
  result.filename = `lokalmart_full_database_archive_${new Date().toISOString().slice(0, 10)}.zip`;
  return result;
}

module.exports = {
  cleanSheetName,
  exportModelRows,
  exportMigrationXlsx,
  exportMigrationPackageZip,
  exportFullDatabaseArchiveZip,
  exportSingleModelXlsx,
  countModelRows,
  discoverArchiveModels,
  workbookToBase64
};
