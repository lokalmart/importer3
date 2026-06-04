const { splitXmlId, joinXmlId, makeXmlIdName, uniq } = require('./utils');

async function getExternalIds(client, model, resIds = []) {
  if (!resIds.length) return new Map();
  const rows = await client.searchRead('ir.model.data', [
    ['model', '=', model],
    ['res_id', 'in', resIds]
  ], ['module', 'name', 'model', 'res_id', 'noupdate'], { limit: Math.max(resIds.length * 2, 1000) });
  const map = new Map();
  for (const r of rows) {
    if (!map.has(r.res_id)) map.set(r.res_id, joinXmlId(r.module, r.name));
  }
  return map;
}

async function findByExternalId(client, xmlid) {
  const parts = splitXmlId(xmlid);
  if (!parts) return null;
  const rows = await client.searchRead('ir.model.data', [
    ['module', '=', parts.module],
    ['name', '=', parts.name]
  ], ['module', 'name', 'model', 'res_id'], { limit: 1 });
  return rows[0] || null;
}

async function resolveExternalId(client, xmlid, expectedModel = null) {
  if (!xmlid) return false;
  const row = await findByExternalId(client, xmlid);
  if (!row) return false;
  if (expectedModel && row.model !== expectedModel) return false;
  return row.res_id || false;
}

async function ensureExternalId(client, model, resId, moduleName = 'lokalmart_mig', preferredName = null) {
  const existing = await getExternalIds(client, model, [resId]);
  if (existing.has(resId)) return existing.get(resId);

  let record = { id: resId };
  try {
    const rows = await client.read(model, [resId], ['id', 'name', 'display_name', 'complete_name', 'url', 'key', 'login']);
    if (rows[0]) record = rows[0];
  } catch (_) {}

  let name = preferredName || makeXmlIdName(model, record);
  name = name.replace(/[^a-zA-Z0-9_\.\-]/g, '_');

  const collision = await client.searchRead('ir.model.data', [
    ['module', '=', moduleName],
    ['name', '=', name]
  ], ['id', 'model', 'res_id'], { limit: 1 });
  if (collision.length) name = `${name}_${resId}`;

  await client.create('ir.model.data', {
    module: moduleName,
    name,
    model,
    res_id: resId,
    noupdate: true
  });
  return joinXmlId(moduleName, name);
}

async function ensureExternalIdsForModel(client, model, options = {}) {
  const moduleName = options.module || 'lokalmart_mig';
  const domain = options.domain || [];
  const limit = options.limit || 500;
  const ids = await client.search(model, domain, { limit, order: 'id asc' });
  const existing = await getExternalIds(client, model, ids);
  const created = [];
  const skipped = [];
  for (const id of ids) {
    if (existing.has(id)) {
      skipped.push({ id, external_id: existing.get(id) });
      continue;
    }
    const xmlid = await ensureExternalId(client, model, id, moduleName);
    created.push({ id, external_id: xmlid });
  }
  return { model, total: ids.length, created, skipped };
}

async function getXmlIdsForRelations(client, model, ids) {
  const clean = uniq(ids).map(Number).filter(Boolean);
  if (!clean.length) return new Map();
  return getExternalIds(client, model, clean);
}

module.exports = {
  getExternalIds,
  findByExternalId,
  resolveExternalId,
  ensureExternalId,
  ensureExternalIdsForModel,
  getXmlIdsForRelations
};
