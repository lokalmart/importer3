const { makeClient } = require('../lib/odooClient');
const { fullAutopsy, scanModels, modelExists } = require('../lib/scanner');
const { ensureExternalIdsForModel } = require('../lib/externalId');
const { exportMigrationXlsx, exportMigrationPackageZip, exportFullDatabaseArchiveZip, exportSingleModelXlsx, exportFullDatabaseMultiSheetXlsx, discoverArchiveModels, countModelRows } = require('../lib/exporter');
const { importPreview, importWorkbook, importProductImagesFromWorkbook } = require('../lib/importer');
const { exportModelsForProfile, exportModelsForProfiles, presetSummary, archiveCategorySummary, categorizeModels } = require('../lib/modelProfiles');
const { validateXml } = require('../lib/validators');
const { flattenError } = require('../lib/utils');

function send(res, status, data) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.end(JSON.stringify(data));
}

async function readBody(req) {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', chunk => {
      raw += chunk;
      if (raw.length > 25 * 1024 * 1024) {
        reject(new Error('Request terlalu besar. Gunakan batch lebih kecil.'));
        req.destroy();
      }
    });
    req.on('end', () => {
      if (!raw) return resolve({});
      try { resolve(JSON.parse(raw)); }
      catch (err) { reject(new Error('Body harus JSON valid.')); }
    });
    req.on('error', reject);
  });
}

function pickConnection(body, kind = 'source') {
  return body[kind] || body.connection || body.odoo || {};
}

function modelsFromPayload(payload = {}, body = {}) {
  if (Array.isArray(payload.models) && payload.models.length) return payload.models;
  if (Array.isArray(body.models) && body.models.length) return body.models;
  const profiles = payload.profiles || body.profiles || payload.profile || body.profile || 'full';
  return exportModelsForProfiles(profiles);
}

async function targetGapReport(sourceClient, targetClient, models) {
  const sourceScan = await scanModels(sourceClient, models);
  const targetScan = await scanModels(targetClient, models);
  const targetByModel = new Map(targetScan.map(x => [x.model, x]));
  const gaps = [];
  for (const s of sourceScan) {
    const t = targetByModel.get(s.model);
    if (!s.exists) continue;
    if (!t || !t.exists) {
      gaps.push({ model: s.model, type: 'missing_model', message: `Model ${s.model} ada di source tetapi belum ada di target.` });
      continue;
    }
    const targetFields = new Set(Object.keys(t.fields || {}));
    for (const f of Object.keys(s.fields || {})) {
      if (!targetFields.has(f)) gaps.push({ model: s.model, field: f, type: 'missing_field', message: `Field ${s.model}.${f} belum ada di target.` });
    }
  }
  return { checked_models: models.length, gaps };
}

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return send(res, 200, { ok: true });
  if (req.method !== 'POST') return send(res, 405, { ok: false, error: 'Gunakan POST JSON ke /api/odoo.' });

  try {
    const body = await readBody(req);
    const action = String(body.action || '').trim();
    const payload = body.payload || {};

    if (action === 'health') return send(res, 200, { ok: true, app: 'Lokalmart Odoo Migration Builder', version: '0.1.9' });
    if (action === 'model_presets') return send(res, 200, { ok: true, presets: presetSummary(), archive_categories: archiveCategorySummary() });
    if (action === 'validate_qweb_xml') return send(res, 200, { ok: true, validation: validateXml(payload.xml || body.xml || '') });

    if (!action) return send(res, 400, { ok: false, error: 'action wajib diisi.' });

    if (action === 'test_connection') {
      const client = makeClient(pickConnection(body, 'source'));
      const version = await client.version();
      const uid = await client.authenticate();
      return send(res, 200, { ok: true, uid, version });
    }

    if (action === 'version') {
      const client = makeClient(pickConnection(body, 'source'));
      return send(res, 200, { ok: true, version: await client.version() });
    }

    if (action === 'scan_models') {
      const client = makeClient(pickConnection(body, 'source'));
      const models = modelsFromPayload(payload, body)
      return send(res, 200, { ok: true, result: await scanModels(client, models) });
    }

    if (action === 'full_autopsy') {
      const client = makeClient(pickConnection(body, 'source'));
      const models = modelsFromPayload(payload, body)
      return send(res, 200, { ok: true, result: await fullAutopsy(client, models, payload) });
    }

    if (action === 'model_exists') {
      const client = makeClient(pickConnection(body, 'source'));
      const model = payload.model || body.model;
      return send(res, 200, { ok: true, result: await modelExists(client, model) });
    }

    if (action === 'ensure_external_ids') {
      const client = makeClient(pickConnection(body, 'source'));
      const models = modelsFromPayload(payload, body);
      if (!models.length) return send(res, 400, { ok: false, error: 'Tidak ada model yang dipilih. Pilih preset seperti master/project/accounting/website/full.' });
      const results = [];
      for (const model of models) {
        results.push(await ensureExternalIdsForModel(client, model, payload));
      }
      return send(res, 200, { ok: true, results });
    }


    if (action === 'discover_archive_models') {
      const client = makeClient(pickConnection(body, 'source'));
      const models = await discoverArchiveModels(client, payload);
      const model_objects = categorizeModels(models);
      const categories = archiveCategorySummary().map(cat => ({
        ...cat,
        count: model_objects.filter(m => m.category === cat.key).length
      })).filter(cat => cat.count > 0);
      return send(res, 200, { ok: true, models, model_objects, categories, count: models.length });
    }

    if (action === 'count_model_rows') {
      const client = makeClient(pickConnection(body, 'source'));
      const model = payload.model || body.model;
      if (!model) return send(res, 400, { ok: false, error: 'payload.model wajib diisi.' });
      return send(res, 200, { ok: true, result: await countModelRows(client, model, payload) });
    }

    if (action === 'export_model_xlsx') {
      const client = makeClient(pickConnection(body, 'source'));
      const model = payload.model || body.model;
      if (!model) return send(res, 400, { ok: false, error: 'payload.model wajib diisi.' });
      const result = await exportSingleModelXlsx(client, model, payload);
      return send(res, 200, { ok: true, ...result });
    }

    if (action === 'export_migration_safe_xlsx') {
      const client = makeClient(pickConnection(body, 'source'));
      const result = await exportMigrationXlsx(client, payload);
      return send(res, 200, { ok: true, ...result });
    }

    if (action === 'export_migration_package_zip') {
      const client = makeClient(pickConnection(body, 'source'));
      const result = await exportMigrationPackageZip(client, payload);
      return send(res, 200, { ok: true, ...result });
    }


    if (action === 'export_full_database_multisheet_xlsx') {
      const client = makeClient(pickConnection(body, 'source'));
      const result = await exportFullDatabaseMultiSheetXlsx(client, payload);
      return send(res, 200, { ok: true, ...result });
    }


    if (action === 'export_full_database_archive_zip') {
      const client = makeClient(pickConnection(body, 'source'));
      const result = await exportFullDatabaseArchiveZip(client, payload);
      return send(res, 200, { ok: true, ...result });
    }

    if (action === 'import_preview_xlsx') {
      const client = makeClient(pickConnection(body, 'target'));
      const result = await importPreview(client, payload.fileBase64 || body.fileBase64);
      return send(res, 200, { ok: true, result });
    }

    if (action === 'import_xlsx') {
      const client = makeClient(pickConnection(body, 'target'));
      const result = await importWorkbook(client, payload.fileBase64 || body.fileBase64, payload);
      return send(res, 200, { ok: true, result });
    }


    if (action === 'import_product_images') {
      const client = makeClient(pickConnection(body, 'target'));
      const result = await importProductImagesFromWorkbook(client, payload.fileBase64 || body.fileBase64, payload);
      return send(res, 200, { ok: true, result });
    }

    if (action === 'target_gap_report') {
      const sourceClient = makeClient(pickConnection(body, 'source'));
      const targetClient = makeClient(pickConnection(body, 'target'));
      const models = modelsFromPayload(payload, body)
      return send(res, 200, { ok: true, result: await targetGapReport(sourceClient, targetClient, models) });
    }

    return send(res, 400, { ok: false, error: `Action tidak dikenal: ${action}` });
  } catch (err) {
    return send(res, 500, { ok: false, error: flattenError(err) });
  }
};
