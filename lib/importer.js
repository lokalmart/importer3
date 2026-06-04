const XLSX = require('xlsx');
const { IMPORT_PLAN } = require('./modelProfiles');
const { splitXmlId, emptyToFalse, toBool, parseMaybeJson, flattenError, uniq } = require('./utils');
const { resolveExternalId, findByExternalId } = require('./externalId');
const { modelExists } = require('./scanner');
const { validateWorkbookRows, validateXml } = require('./validators');

function workbookFromBase64(fileBase64) {
  if (!fileBase64) throw new Error('fileBase64 kosong. Frontend harus mengirim file dalam base64.');
  const clean = String(fileBase64).replace(/^data:.*?;base64,/, '');
  return XLSX.read(Buffer.from(clean, 'base64'), { type: 'buffer', cellDates: false });
}

function rowsFromWorkbook(fileBase64) {
  const wb = workbookFromBase64(fileBase64);
  const sheets = {};
  for (const name of wb.SheetNames) {
    const rows = XLSX.utils.sheet_to_json(wb.Sheets[name], { defval: '' });
    sheets[name] = rows;
  }
  return sheets;
}

function inferModelFromSheet(sheetName, rows) {
  if (rows && rows[0] && rows[0]._model) return String(rows[0]._model).trim();
  const normalized = sheetName.replace(/_/g, '.');
  return normalized;
}

async function importPreview(client, fileBase64) {
  const sheets = rowsFromWorkbook(fileBase64);
  const preview = [];
  for (const [sheet, rows] of Object.entries(sheets)) {
    if (sheet.startsWith('00_') || sheet.startsWith('99_')) {
      preview.push({ sheet, model: null, rows: rows.length, status: 'meta_sheet' });
      continue;
    }
    const model = inferModelFromSheet(sheet, rows);
    const exists = await modelExists(client, model);
    let warnings = [];
    if (exists && rows.length) {
      const fieldsMeta = await client.fieldsGet(model).catch(() => ({}));
      warnings = validateWorkbookRows(rows.slice(0, 50), fieldsMeta);
    }
    preview.push({ sheet, model, rows: rows.length, target_model_exists: !!exists, warnings: warnings.slice(0, 20) });
  }
  return { sheet_count: Object.keys(sheets).length, preview };
}

async function modelFields(client, model) {
  return client.fieldsGet(model, [], ['type', 'relation', 'required', 'readonly', 'selection', 'string']).catch(() => ({}));
}

async function ensureManualModel(client, row) {
  const model = row.model || row['model'] || '';
  if (!model) throw new Error('ir.model row tanpa model.');
  if (!model.startsWith('x_')) return { skipped: true, reason: 'Bukan custom model x_, dilewati demi keamanan.', model };
  const existing = await client.searchRead('ir.model', [['model', '=', model]], ['id'], { limit: 1 });
  const vals = {
    name: row.name || row.field_description || model,
    model,
    state: 'manual',
    transient: toBool(row.transient)
  };
  if (row.info) vals.info = row.info;
  if (existing.length) {
    await client.write('ir.model', [existing[0].id], vals);
    return { updated: true, id: existing[0].id, model };
  }
  const id = await client.create('ir.model', vals);
  return { created: true, id, model };
}

async function ensureManualField(client, row) {
  const model = row.model || row['model'] || '';
  let name = row.name || '';
  if (!model || !name) throw new Error('ir.model.fields row wajib punya model dan name.');
  if (!name.startsWith('x_')) name = `x_${name.replace(/^x_?/, '')}`;
  const modelRows = await client.searchRead('ir.model', [['model', '=', model]], ['id'], { limit: 1 });
  if (!modelRows.length) throw new Error(`Model ${model} belum ada. Import ir.model dulu.`);
  const existing = await client.searchRead('ir.model.fields', [['model', '=', model], ['name', '=', name]], ['id', 'state'], { limit: 1 });
  const vals = {
    name,
    model,
    model_id: modelRows[0].id,
    field_description: row.field_description || row.string || name,
    ttype: row.ttype || row.type || 'char',
    state: 'manual',
    required: toBool(row.required),
    readonly: toBool(row.readonly),
    store: row.store === '' ? true : toBool(row.store)
  };
  if (row.relation) vals.relation = row.relation;
  if (row.help) vals.help = row.help;
  if (row.index !== '') vals.index = toBool(row.index);
  if (row.copied !== '') vals.copied = toBool(row.copied);
  if (row.translate !== '') vals.translate = toBool(row.translate);

  if (existing.length) {
    if (existing[0].state !== 'manual') return { skipped: true, reason: 'Field bawaan/module tidak diubah.', model, name };
    await client.write('ir.model.fields', [existing[0].id], vals);
    return { updated: true, id: existing[0].id, model, name };
  }
  const id = await client.create('ir.model.fields', vals);
  return { created: true, id, model, name };
}

async function createOrUpdateXmlId(client, xmlid, model, resId) {
  const parts = splitXmlId(xmlid);
  if (!parts) return null;
  const existing = await client.searchRead('ir.model.data', [['module', '=', parts.module], ['name', '=', parts.name]], ['id', 'model', 'res_id'], { limit: 1 });
  if (existing.length) {
    await client.write('ir.model.data', [existing[0].id], { model, res_id: resId, noupdate: true });
    return existing[0].id;
  }
  return client.create('ir.model.data', { module: parts.module, name: parts.name, model, res_id: resId, noupdate: true });
}

async function convertValue(client, fieldsMeta, field, raw, row) {
  const meta = fieldsMeta[field];
  if (!meta) return { skip: true };
  const type = meta.type;
  if (raw === '' || raw === undefined || raw === null) return { value: false };
  if (type === 'boolean') return { value: toBool(raw) };
  if (['integer', 'many2one_reference'].includes(type)) return { value: Number.parseInt(raw, 10) || false };
  if (['float', 'monetary'].includes(type)) return { value: Number.parseFloat(raw) || 0 };
  if (type === 'html' && String(raw).trim()) {
    const val = validateXml(String(raw));
    if (!val.ok) return { error: `XML/QWeb tidak valid pada field ${field}: ${val.error}` };
  }
  if (type === 'selection') return { value: String(raw) };
  if (type === 'many2one') {
    if (typeof raw === 'number') return { value: raw };
    const resolved = await resolveExternalId(client, String(raw).trim(), meta.relation);
    if (!resolved) return { error: `External ID relasi tidak ditemukan: ${raw} untuk ${field} -> ${meta.relation}` };
    return { value: resolved };
  }
  if (type === 'many2many') {
    const values = String(raw).split(',').map(s => s.trim()).filter(Boolean);
    const ids = [];
    for (const xmlid of values) {
      const id = await resolveExternalId(client, xmlid, meta.relation);
      if (id) ids.push(id);
      else return { error: `External ID many2many tidak ditemukan: ${xmlid} untuk ${field}` };
    }
    return { value: [[6, 0, ids]] };
  }
  if (type === 'one2many') return { skip: true };
  return { value: emptyToFalse(raw) };
}

async function rowToVals(client, model, fieldsMeta, row) {
  const vals = {};
  const warnings = [];
  for (const [col, raw] of Object.entries(row)) {
    if (!col || col.startsWith('_') || col === '__action') continue;
    if (col.endsWith('_display_name')) continue;
    if (col.endsWith('_external_id')) {
      const field = col.replace(/_external_id$/, '');
      const converted = await convertValue(client, fieldsMeta, field, raw, row);
      if (converted.error) throw new Error(converted.error);
      if (!converted.skip) vals[field] = converted.value;
      continue;
    }
    if (col.endsWith('_external_ids')) {
      const field = col.replace(/_external_ids$/, '');
      const converted = await convertValue(client, fieldsMeta, field, raw, row);
      if (converted.error) throw new Error(converted.error);
      if (!converted.skip) vals[field] = converted.value;
      continue;
    }
    if (!fieldsMeta[col]) {
      warnings.push(`Kolom ${col} dilewati karena field tidak ada di ${model}.`);
      continue;
    }
    const converted = await convertValue(client, fieldsMeta, col, raw, row);
    if (converted.error) throw new Error(converted.error);
    if (!converted.skip) vals[col] = converted.value;
  }
  return { vals, warnings };
}

async function upsertRow(client, model, row, options = {}) {
  if (model === 'ir.model') return ensureManualModel(client, row);
  if (model === 'ir.model.fields') return ensureManualField(client, row);

  const fieldsMeta = await modelFields(client, model);
  const { vals, warnings } = await rowToVals(client, model, fieldsMeta, row);
  const action = String(row.__action || 'upsert').toLowerCase();
  const xmlid = String(row._external_id || '').trim();
  let target = xmlid ? await findByExternalId(client, xmlid) : null;
  if (target && target.model !== model) throw new Error(`External ID ${xmlid} menunjuk ke ${target.model}, bukan ${model}.`);

  if (action === 'skip') return { skipped: true, reason: '__action=skip', warnings };
  if (action === 'delete_optional') {
    if (target) await client.unlink(model, [target.res_id]);
    return { deleted: !!target, warnings };
  }

  if (target) {
    await client.write(model, [target.res_id], vals);
    return { updated: true, id: target.res_id, warnings };
  }
  const id = await client.create(model, vals);
  if (xmlid) await createOrUpdateXmlId(client, xmlid, model, id);
  return { created: true, id, warnings };
}

function orderedSheets(sheets) {
  const entries = Object.entries(sheets).filter(([name]) => !name.startsWith('00_') && !name.startsWith('99_'));
  return entries.sort((a, b) => {
    const ma = inferModelFromSheet(a[0], a[1]);
    const mb = inferModelFromSheet(b[0], b[1]);
    const ia = IMPORT_PLAN.indexOf(ma);
    const ib = IMPORT_PLAN.indexOf(mb);
    return (ia === -1 ? 999 : ia) - (ib === -1 ? 999 : ib);
  });
}

async function importWorkbook(client, fileBase64, options = {}) {
  const sheets = rowsFromWorkbook(fileBase64);
  const report = [];
  const maxRowsPerSheet = options.maxRowsPerSheet || 1000;
  for (const [sheet, rowsAll] of orderedSheets(sheets)) {
    const rows = rowsAll.slice(0, maxRowsPerSheet);
    const model = inferModelFromSheet(sheet, rows);
    const exists = await modelExists(client, model);
    if (!exists && model !== 'ir.model') {
      report.push({ sheet, model, status: 'skipped', reason: 'Model belum ada di target.', rows: rows.length });
      continue;
    }
    const item = { sheet, model, rows: rows.length, created: 0, updated: 0, skipped: 0, deleted: 0, errors: [], warnings: [] };
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      try {
        const result = await upsertRow(client, model, row, options);
        if (result.created) item.created++;
        else if (result.updated) item.updated++;
        else if (result.deleted) item.deleted++;
        else item.skipped++;
        if (result.warnings?.length) item.warnings.push({ row: i + 2, warnings: result.warnings });
      } catch (err) {
        item.errors.push({ row: i + 2, error: flattenError(err), sample: row });
        if (options.stopOnError) break;
      }
    }
    report.push(item);
  }
  return { imported_at: new Date().toISOString(), report };
}

module.exports = { rowsFromWorkbook, importPreview, importWorkbook, upsertRow };
