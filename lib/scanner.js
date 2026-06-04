const { SYSTEM_FIELDS, shouldSkipModel, nowIso, flattenError } = require('./utils');
const { DEFAULT_EXPORT_MODELS } = require('./modelProfiles');
const { validateXml } = require('./validators');

async function modelExists(client, model) {
  try {
    const rows = await client.searchRead('ir.model', [['model', '=', model]], ['id', 'model', 'name', 'state'], { limit: 1 });
    return rows[0] || null;
  } catch (_) {
    return null;
  }
}

function classifyField(name, meta) {
  const t = meta.type;
  if (SYSTEM_FIELDS.has(name)) return { importable: false, reason: 'system_field' };
  if (meta.readonly && !meta.required) return { importable: false, reason: 'readonly' };
  if (['one2many', 'reference'].includes(t)) return { importable: false, reason: `unsupported_${t}` };
  if (t === 'binary') return { importable: true, reason: 'binary_special' };
  if (meta.compute && !meta.store) return { importable: false, reason: 'computed_not_stored' };
  return { importable: true, reason: 'ok' };
}

async function scanModel(client, model) {
  const info = await modelExists(client, model);
  if (!info) return { model, exists: false, fields: {}, importable_fields: [], skipped_fields: [], error: null };
  let fields = {};
  try {
    fields = await client.fieldsGet(model, [], ['string', 'type', 'relation', 'required', 'readonly', 'store', 'selection', 'compute']);
  } catch (err) {
    return { model, exists: true, info, fields: {}, importable_fields: [], skipped_fields: [], error: flattenError(err) };
  }
  const importable = [];
  const skipped = [];
  const relations = [];
  for (const [name, meta] of Object.entries(fields)) {
    const c = classifyField(name, meta);
    const row = { name, label: meta.string, type: meta.type, relation: meta.relation || null, required: !!meta.required, readonly: !!meta.readonly, importable: c.importable, reason: c.reason };
    if (c.importable) importable.push(row); else skipped.push(row);
    if (['many2one', 'many2many', 'one2many'].includes(meta.type)) relations.push(row);
  }
  return { model, exists: true, info, field_count: Object.keys(fields).length, fields, importable_fields: importable, skipped_fields: skipped, relations };
}

async function scanModels(client, models = DEFAULT_EXPORT_MODELS) {
  const result = [];
  for (const model of models) {
    if (shouldSkipModel(model)) continue;
    result.push(await scanModel(client, model));
  }
  return result;
}

async function scanExternalIdStats(client, model) {
  try {
    const total = await client.searchCount(model, []);
    const rows = await client.searchRead('ir.model.data', [['model', '=', model]], ['res_id'], { limit: 100000 });
    const withXmlId = new Set(rows.map(r => r.res_id)).size;
    return { model, total, with_external_id: withXmlId, missing_external_id: Math.max(total - withXmlId, 0) };
  } catch (err) {
    return { model, error: flattenError(err) };
  }
}

async function fullAutopsy(client, models = DEFAULT_EXPORT_MODELS, options = {}) {
  const version = await client.version().catch(err => ({ error: flattenError(err) }));
  const scanned = await scanModels(client, models);
  const stats = [];
  for (const item of scanned) {
    if (item.exists) stats.push(await scanExternalIdStats(client, item.model));
  }

  const customFields = await client.searchRead('ir.model.fields', [['state', '=', 'manual']], ['name', 'field_description', 'model', 'ttype', 'relation', 'required', 'readonly', 'store', 'state'], { limit: options.customFieldLimit || 5000 }).catch(err => ({ error: flattenError(err) }));
  const customModels = await client.searchRead('ir.model', [['state', '=', 'manual']], ['name', 'model', 'state', 'transient'], { limit: options.customModelLimit || 1000 }).catch(err => ({ error: flattenError(err) }));

  const qwebWarnings = [];
  const views = await client.searchRead('ir.ui.view', ['|', ['key', 'ilike', 'lokalmart'], ['name', 'ilike', 'lokalmart']], ['id', 'name', 'key', 'type', 'arch_db'], { limit: options.viewLimit || 200 }).catch(() => []);
  if (Array.isArray(views)) {
    for (const v of views) {
      const val = validateXml(v.arch_db || '');
      if (!val.ok || val.warnings.length) qwebWarnings.push({ id: v.id, name: v.name, key: v.key, ok: val.ok, error: val.error || null, warnings: val.warnings });
    }
  }

  return {
    generated_at: nowIso(),
    version,
    model_count: scanned.length,
    models: scanned.map(s => ({ model: s.model, exists: s.exists, field_count: s.field_count || 0, importable_count: s.importable_fields?.length || 0, skipped_count: s.skipped_fields?.length || 0, error: s.error || null })),
    external_id_stats: stats,
    custom_models: Array.isArray(customModels) ? customModels : [],
    custom_fields: Array.isArray(customFields) ? customFields : [],
    qweb_warnings: qwebWarnings,
    scanned_detail: scanned
  };
}

module.exports = { modelExists, classifyField, scanModel, scanModels, fullAutopsy };
