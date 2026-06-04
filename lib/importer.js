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

const SHEET_MODEL_ALIASES = {
  'photo_import_queue': null,
  'image_import_queue': null,
  'import_order': null,
  'importer_rules': null,
  'summary_check': null,
  'accounting_category_notes': null,
  'product_notes': null
};

const COLUMN_ALIASES = {
  // General migration-safe aliases
  external_id: '_external_id',
  xml_id: '_external_id',
  xmlid: '_external_id',
  old_db_id: '_old_db_id',

  // Common legacy relation aliases used by older ChatGPT/XLSX outputs
  parent_external_id: 'parent_id_external_id',
  categ_external_id: 'categ_id_external_id',
  category_external_ids: 'category_id_external_ids',
  public_categ_external_ids: 'public_categ_ids_external_ids',
  attribute_external_id: 'attribute_id_external_id',
  product_tmpl_external_id: 'product_tmpl_id_external_id',
  partner_external_id: 'partner_id_external_id',
  field_external_id: 'field_id_external_id',
  value_external_ids: 'value_ids_external_ids',
  product_template_external_id: 'product_tmpl_id_external_id',
  vendor_external_id: 'x_lm_vendor_id_external_id',

  // Useful human-name columns. These are intentionally kept as custom notes unless a model has such fields.
  currency_name: 'currency_id_name_hint',
  country_name: 'country_id_name_hint',
  state_name: 'state_id_name_hint',
  uom_name: 'uom_id_name_hint',
  uom_po_name: 'uom_po_id_name_hint',

  // Photo/image URL aliases. These are consumed by import_product_images, not ordinary row import.
  photo_url: 'image_url',
  image_1920_url: 'image_url',
  product_image_url: 'image_url',
  main_image_url: 'image_url',
  image_field_name: 'image_field',
  record_xml_id: 'record_external_id',
  record_external_id: 'record_external_id',
  product_external_id: 'record_external_id'
};

const MODEL_REQUIRED_FIELD_ALIASES = {
  'product.template.attribute.line': {
    value_external_ids: 'value_ids_external_ids'
  }
};

function normalizeSheetKey(sheetName) {
  return String(sheetName || '').trim().replace(/^_+/, '').toLowerCase();
}

function isMetaSheet(sheetName) {
  const raw = String(sheetName || '').trim();
  const key = normalizeSheetKey(raw);
  if (!raw) return true;
  if (raw.startsWith('00_') || raw.startsWith('99_') || raw.startsWith('_')) return true;
  if (['readme', 'notes', 'metadata', 'manifest'].includes(key)) return true;
  return Object.prototype.hasOwnProperty.call(SHEET_MODEL_ALIASES, key) && SHEET_MODEL_ALIASES[key] === null;
}

function normalizeColumnName(col, model = null) {
  const raw = String(col || '').trim();
  if (!raw) return raw;
  const lower = raw.toLowerCase().trim();
  const modelAliases = model && MODEL_REQUIRED_FIELD_ALIASES[model] ? MODEL_REQUIRED_FIELD_ALIASES[model] : {};
  return modelAliases[raw] || modelAliases[lower] || COLUMN_ALIASES[raw] || COLUMN_ALIASES[lower] || raw;
}

function normalizeRow(row, model = null) {
  const out = {};
  for (const [key, value] of Object.entries(row || {})) {
    const normalized = normalizeColumnName(key, model);
    // Prefer the first non-empty value when old and new aliases are both present.
    if (Object.prototype.hasOwnProperty.call(out, normalized)) {
      if ((out[normalized] === '' || out[normalized] === undefined || out[normalized] === null) && value !== '') out[normalized] = value;
      continue;
    }
    out[normalized] = value;
  }
  return out;
}

const IMAGE_QUEUE_COLUMNS = new Set(['image_url', 'image_file', 'image_field', 'image_alt', 'image_note', 'record_external_id', 'image_status']);

function isImageQueueColumn(col) {
  return IMAGE_QUEUE_COLUMNS.has(col);
}

function rowHasUsefulData(row) {
  return Object.entries(row || {}).some(([key, value]) => {
    const k = String(key || '').trim();
    if (!k || k === '__EMPTY' || k.startsWith('__EMPTY')) return false;
    if (value === undefined || value === null) return false;
    return String(value).trim() !== '';
  });
}

function rowsFromWorkbook(fileBase64) {
  const wb = workbookFromBase64(fileBase64);
  const sheets = {};
  for (const name of wb.SheetNames) {
    const rows = XLSX.utils.sheet_to_json(wb.Sheets[name], { defval: '' }).filter(rowHasUsefulData);
    const model = inferModelFromSheet(name, rows);
    sheets[name] = rows.map(r => normalizeRow(r, model)).filter(rowHasUsefulData);
  }
  return sheets;
}

function inferModelFromSheet(sheetName, rows) {
  if (rows && rows[0] && rows[0]._model) return String(rows[0]._model).trim();
  const key = normalizeSheetKey(sheetName);
  if (Object.prototype.hasOwnProperty.call(SHEET_MODEL_ALIASES, key)) return SHEET_MODEL_ALIASES[key];
  const normalized = String(sheetName || '').trim().replace(/_/g, '.');
  return normalized;
}

async function importPreview(client, fileBase64) {
  const sheets = rowsFromWorkbook(fileBase64);
  const preview = [];
  for (const [sheet, rows] of Object.entries(sheets)) {
    if (isMetaSheet(sheet)) {
      preview.push({ sheet, model: null, rows: rows.length, status: 'meta_sheet' });
      continue;
    }
    const model = inferModelFromSheet(sheet, rows);
    if (!model) {
      preview.push({ sheet, model: null, rows: rows.length, status: 'skipped_sheet' });
      continue;
    }
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
    if (row._external_id) await createOrUpdateXmlId(client, String(row._external_id).trim(), 'ir.model', existing[0].id);
    return { updated: true, id: existing[0].id, model };
  }
  const id = await client.create('ir.model', vals);
  if (row._external_id) await createOrUpdateXmlId(client, String(row._external_id).trim(), 'ir.model', id);
  return { created: true, id, model };
}

function normalizeManualFieldName(name) {
  let value = String(name || '').trim();
  if (!value) return value;
  if (!value.startsWith('x_')) value = `x_${value.replace(/^x_?/, '')}`;
  return value;
}

async function ensureManualField(client, row) {
  const model = row.model || row['model'] || '';
  const originalName = row.name || '';
  const name = normalizeManualFieldName(originalName);
  if (!model || !name) throw new Error('ir.model.fields row wajib punya model dan name.');
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
  if (row.tracking !== '') vals.tracking = Number.parseInt(row.tracking, 10) || 0;

  let id;
  let result;
  if (existing.length) {
    if (existing[0].state !== 'manual') return { skipped: true, reason: 'Field bawaan/module tidak diubah.', model, name };
    await client.write('ir.model.fields', [existing[0].id], vals);
    id = existing[0].id;
    result = { updated: true, id, model, name };
  } else {
    id = await client.create('ir.model.fields', vals);
    result = { created: true, id, model, name };
  }

  if (row._external_id) await createOrUpdateXmlId(client, String(row._external_id).trim(), 'ir.model.fields', id);

  // Backward-compatible shortcut: older XLSX files often put selection options directly on ir.model.fields.
  // Format accepted: "draft:Draft;ready:Ready" or JSON array [{value,name,sequence}].
  if ((vals.ttype === 'selection') && row.selection_values) {
    const selectionResult = await ensureSelectionValuesFromFieldRow(client, row, id);
    result.selection_values = selectionResult;
  }
  return result;
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

function selectionRowsFromString(raw) {
  const parsed = parseMaybeJson(raw, null);
  if (Array.isArray(parsed)) {
    return parsed.map((x, i) => ({
      value: x.value || x.key || x[0],
      name: x.name || x.label || x[1] || x.value || x.key || x[0],
      sequence: x.sequence || ((i + 1) * 10)
    })).filter(x => x.value);
  }
  return String(raw || '').split(';').map((part, i) => {
    const idx = part.indexOf(':');
    const value = idx >= 0 ? part.slice(0, idx).trim() : part.trim();
    const name = idx >= 0 ? part.slice(idx + 1).trim() : value;
    return { value, name, sequence: (i + 1) * 10 };
  }).filter(x => x.value);
}

async function resolveFieldId(client, row) {
  const fieldXmlId = String(row.field_id_external_id || row.field_external_id || row._field_external_id || '').trim();
  if (fieldXmlId) {
    const id = await resolveExternalId(client, fieldXmlId, 'ir.model.fields');
    if (id) return id;
  }
  if (row.field_id && typeof row.field_id === 'number') return row.field_id;
  const model = row.model || row.field_model || row.related_model || '';
  const name = normalizeManualFieldName(row.field_name || row.name_field || row.field || '');
  if (model && name) {
    const rows = await client.searchRead('ir.model.fields', [['model', '=', model], ['name', '=', name]], ['id'], { limit: 1 });
    if (rows.length) return rows[0].id;
  }
  return false;
}

async function ensureFieldSelection(client, row) {
  const fieldId = await resolveFieldId(client, row);
  if (!fieldId) throw new Error(`Field selection gagal: field_id tidak ditemukan dari ${row.field_id_external_id || row.field_external_id || row.field || ''}.`);
  const value = String(row.value || '').trim();
  if (!value) throw new Error('ir.model.fields.selection row wajib punya value.');
  const name = row.name || row.label || value;
  const sequence = row.sequence === '' ? 10 : (Number.parseInt(row.sequence, 10) || 10);
  const existing = await client.searchRead('ir.model.fields.selection', [['field_id', '=', fieldId], ['value', '=', value]], ['id'], { limit: 1 });
  const vals = { field_id: fieldId, value, name, sequence };
  let id;
  if (existing.length) {
    await client.write('ir.model.fields.selection', [existing[0].id], vals);
    id = existing[0].id;
  } else {
    id = await client.create('ir.model.fields.selection', vals);
  }
  if (row._external_id) await createOrUpdateXmlId(client, String(row._external_id).trim(), 'ir.model.fields.selection', id);
  return existing.length ? { updated: true, id, field_id: fieldId, value } : { created: true, id, field_id: fieldId, value };
}

async function ensureSelectionValuesFromFieldRow(client, fieldRow, fieldId) {
  const rows = selectionRowsFromString(fieldRow.selection_values);
  const results = [];
  const fieldXmlId = String(fieldRow._external_id || '').trim();
  for (const r of rows) {
    const xmlid = fieldXmlId ? `${fieldXmlId}_${String(r.value).replace(/[^a-zA-Z0-9_\-\.]/g, '_')}` : '';
    results.push(await ensureFieldSelection(client, {
      _external_id: xmlid,
      field_id: fieldId,
      value: r.value,
      name: r.name,
      sequence: r.sequence
    }));
  }
  return results;
}

function resolveColumnField(fieldsMeta, rawField) {
  if (fieldsMeta[rawField]) return rawField;
  if (fieldsMeta[`${rawField}_id`]) return `${rawField}_id`;
  if (fieldsMeta[`${rawField}_ids`]) return `${rawField}_ids`;
  if (rawField.endsWith('_categ') && fieldsMeta[`${rawField}_ids`]) return `${rawField}_ids`;
  return rawField;
}

async function resolveByDisplayName(client, model, name) {
  const value = String(name || '').trim();
  if (!value) return false;
  const domainCandidates = [
    [['name', '=', value]],
    [['display_name', '=', value]],
    [['complete_name', '=', value]],
    [['code', '=', value]]
  ];
  for (const domain of domainCandidates) {
    try {
      const rows = await client.searchRead(model, domain, ['id'], { limit: 1 });
      if (rows.length) return rows[0].id;
    } catch (_) {}
  }
  return false;
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
    const rawString = String(raw).trim();
    let resolved = await resolveExternalId(client, rawString, meta.relation);
    if (!resolved && !rawString.includes('.')) resolved = await resolveByDisplayName(client, meta.relation, rawString);
    if (!resolved) return { error: `External ID relasi tidak ditemukan: ${raw} untuk ${field} -> ${meta.relation}` };
    return { value: resolved };
  }
  if (type === 'many2many') {
    const values = String(raw).split(',').map(s => s.trim()).filter(Boolean);
    const ids = [];
    for (const ref of values) {
      let id = await resolveExternalId(client, ref, meta.relation);
      if (!id && !ref.includes('.')) id = await resolveByDisplayName(client, meta.relation, ref);
      if (id) ids.push(id);
      else return { error: `External ID many2many tidak ditemukan: ${ref} untuk ${field}` };
    }
    return { value: [[6, 0, ids]] };
  }
  if (type === 'one2many') return { skip: true };
  return { value: emptyToFalse(raw) };
}

async function rowToVals(client, model, fieldsMeta, row) {
  const vals = {};
  const warnings = [];
  const normalized = normalizeRow(row, model);
  for (const [col, raw] of Object.entries(normalized)) {
    if (!col || col.startsWith('_') || col === '__action' || col === 'index' || col === 'import_note' || isImageQueueColumn(col)) continue;
    if (col.endsWith('_display_name')) continue;
    if (col.endsWith('_name_hint')) {
      // Best-effort human-readable alias columns such as country_name, state_name, uom_name.
      const field = col.replace(/_name_hint$/, '');
      const actualField = resolveColumnField(fieldsMeta, field);
      if (fieldsMeta[actualField] && fieldsMeta[actualField].type === 'many2one' && raw) {
        const converted = await convertValue(client, fieldsMeta, actualField, raw, normalized);
        if (converted.error) warnings.push(`${col} tidak otomatis dipakai: ${converted.error}`);
        else if (!converted.skip) vals[actualField] = converted.value;
      }
      continue;
    }
    if (col.endsWith('_external_id')) {
      const rawField = col.replace(/_external_id$/, '');
      const field = resolveColumnField(fieldsMeta, rawField);
      const converted = await convertValue(client, fieldsMeta, field, raw, normalized);
      if (converted.error) throw new Error(converted.error);
      if (!converted.skip) vals[field] = converted.value;
      else warnings.push(`Kolom ${col} dilewati karena field ${field} tidak ada di ${model}.`);
      continue;
    }
    if (col.endsWith('_external_ids')) {
      const rawField = col.replace(/_external_ids$/, '');
      const field = resolveColumnField(fieldsMeta, rawField);
      const converted = await convertValue(client, fieldsMeta, field, raw, normalized);
      if (converted.error) throw new Error(converted.error);
      if (!converted.skip) vals[field] = converted.value;
      else warnings.push(`Kolom ${col} dilewati karena field ${field} tidak ada di ${model}.`);
      continue;
    }
    if (!fieldsMeta[col]) {
      warnings.push(`Kolom ${col} dilewati karena field tidak ada di ${model}.`);
      continue;
    }
    const converted = await convertValue(client, fieldsMeta, col, raw, normalized);
    if (converted.error) throw new Error(converted.error);
    if (!converted.skip) vals[col] = converted.value;
  }
  return { vals, warnings };
}

async function upsertRow(client, model, row, options = {}) {
  const normalized = normalizeRow(row, model);
  if (model === 'ir.model') return ensureManualModel(client, normalized);
  if (model === 'ir.model.fields') return ensureManualField(client, normalized);
  if (model === 'ir.model.fields.selection') return ensureFieldSelection(client, normalized);

  const fieldsMeta = await modelFields(client, model);
  const { vals, warnings } = await rowToVals(client, model, fieldsMeta, normalized);
  const action = String(normalized.__action || 'upsert').toLowerCase();
  const xmlid = String(normalized._external_id || '').trim();
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


function inferImageSheetModel(sheetName, rows) {
  const sheetModel = inferModelFromSheet(sheetName, rows);
  if (sheetModel && sheetModel !== null && !isMetaSheet(sheetName)) return sheetModel;
  const first = rows && rows[0] ? normalizeRow(rows[0]) : {};
  return first.model || first._model || 'product.template';
}

function defaultImageField(model, fieldsMeta, preferred) {
  if (preferred && fieldsMeta[preferred]) return preferred;
  if (model === 'product.product' && fieldsMeta.image_variant_1920) return 'image_variant_1920';
  if (fieldsMeta.image_1920) return 'image_1920';
  if (fieldsMeta.image) return 'image';
  return false;
}

function extractImageRowsFromWorkbook(fileBase64) {
  const sheets = rowsFromWorkbook(fileBase64);
  const imageRows = [];
  for (const [sheet, rows] of Object.entries(sheets)) {
    const key = normalizeSheetKey(sheet);
    const isDedicatedQueue = ['photo_import_queue', 'image_import_queue'].includes(key);
    const model = isDedicatedQueue ? null : inferModelFromSheet(sheet, rows);
    for (let i = 0; i < rows.length; i++) {
      const row = normalizeRow(rows[i], model);
      const imageUrl = String(row.image_url || '').trim();
      if (!imageUrl) continue;
      const rowModel = row.model || row._model || (isDedicatedQueue ? 'product.template' : model) || 'product.template';
      const recordXmlId = String(row.record_external_id || row._external_id || '').trim();
      imageRows.push({ sheet, row_number: i + 2, model: rowModel, record_external_id: recordXmlId, image_url: imageUrl, image_field: row.image_field || '', image_alt: row.image_alt || '', note: row.image_note || row.import_note || '' });
    }
  }
  return imageRows;
}

function isProbablyImageUrl(url) {
  const clean = String(url || '').trim().toLowerCase().split('?')[0];
  return /^https?:\/\//.test(clean) && (clean.match(/\.(jpg|jpeg|png|gif|webp|bmp)$/) || clean.includes('/image/') || clean.includes('=image'));
}

async function downloadImageBase64(url, options = {}) {
  const timeoutMs = options.timeoutMs || 15000;
  const maxBytes = options.maxBytes || (5 * 1024 * 1024);
  if (!/^https?:\/\//i.test(String(url || ''))) throw new Error('image_url harus URL http/https publik.');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      method: 'GET',
      redirect: 'follow',
      signal: controller.signal,
      headers: { 'User-Agent': 'Lokalmart-Odoo-Migration-Builder/0.1.2' }
    });
    if (!response.ok) throw new Error(`Download gagal HTTP ${response.status}`);
    const contentType = String(response.headers.get('content-type') || '').toLowerCase();
    if (contentType && !contentType.startsWith('image/') && !isProbablyImageUrl(url)) {
      throw new Error(`URL tidak terlihat sebagai gambar. Content-Type: ${contentType}`);
    }
    const contentLength = Number.parseInt(response.headers.get('content-length') || '0', 10);
    if (contentLength && contentLength > maxBytes) throw new Error(`Gambar terlalu besar: ${contentLength} bytes, batas ${maxBytes} bytes.`);
    const arrayBuffer = await response.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    if (buffer.length > maxBytes) throw new Error(`Gambar terlalu besar: ${buffer.length} bytes, batas ${maxBytes} bytes.`);
    if (!buffer.length) throw new Error('File gambar kosong.');
    return { base64: buffer.toString('base64'), content_type: contentType || 'image/unknown', bytes: buffer.length };
  } finally {
    clearTimeout(timer);
  }
}

async function importProductImagesFromWorkbook(client, fileBase64, options = {}) {
  const rows = extractImageRowsFromWorkbook(fileBase64);
  const maxRows = options.maxRows || options.maxRowsPerSheet || 300;
  const maxBytes = options.maxBytes || options.maxImageBytes || (5 * 1024 * 1024);
  const timeoutMs = options.timeoutMs || 15000;
  const stopOnError = !!options.stopOnError;
  const report = { processed_at: new Date().toISOString(), total_candidates: rows.length, updated: 0, skipped: 0, errors: [], items: [] };
  for (let i = 0; i < Math.min(rows.length, maxRows); i++) {
    const item = rows[i];
    try {
      if (!item.record_external_id) {
        report.skipped++;
        report.items.push({ ...item, status: 'skipped', reason: 'Tidak ada _external_id / record_external_id.' });
        continue;
      }
      const target = await findByExternalId(client, item.record_external_id);
      if (!target) throw new Error(`External ID record tidak ditemukan: ${item.record_external_id}`);
      const model = item.model || target.model;
      if (target.model !== model) throw new Error(`External ID ${item.record_external_id} menunjuk ke ${target.model}, bukan ${model}.`);
      const fieldsMeta = await modelFields(client, model);
      const imageField = defaultImageField(model, fieldsMeta, String(item.image_field || '').trim());
      if (!imageField) throw new Error(`Model ${model} tidak memiliki field gambar image_1920/image.`);
      const image = await downloadImageBase64(item.image_url, { maxBytes, timeoutMs });
      await client.write(model, [target.res_id], { [imageField]: image.base64 });
      report.updated++;
      report.items.push({ ...item, status: 'updated', id: target.res_id, image_field: imageField, bytes: image.bytes, content_type: image.content_type });
    } catch (err) {
      const error = flattenError(err);
      report.errors.push({ ...item, error });
      if (stopOnError) break;
    }
  }
  if (rows.length > maxRows) report.truncated = { maxRows, remaining: rows.length - maxRows };
  return report;
}

function importOrderMap(sheets) {
  const candidates = ['00_import_order', 'import_order', '_import_order'];
  const found = Object.entries(sheets).find(([name]) => candidates.includes(String(name).trim().toLowerCase()));
  const bySheet = new Map();
  const byModel = new Map();
  if (!found) return { bySheet, byModel };
  const [, rows] = found;
  for (const row of rows || []) {
    const sheet = String(row.sheet || row.sheet_name || '').trim();
    const model = String(row.model || row.technical_model || row.technical_sheet_name || '').trim();
    const sequence = Number.parseInt(row.sequence || row.seq || row.order || '0', 10) || 0;
    if (sheet) bySheet.set(sheet, sequence);
    if (model && !byModel.has(model)) byModel.set(model, sequence);
  }
  return { bySheet, byModel };
}

function orderedSheets(sheets) {
  const order = importOrderMap(sheets);
  const entries = Object.entries(sheets).filter(([name]) => !isMetaSheet(name));
  return entries.sort((a, b) => {
    const ma = inferModelFromSheet(a[0], a[1]);
    const mb = inferModelFromSheet(b[0], b[1]);
    const sheetOrderA = order.bySheet.get(a[0]);
    const sheetOrderB = order.bySheet.get(b[0]);
    const modelOrderA = order.byModel.get(ma);
    const modelOrderB = order.byModel.get(mb);
    const ia = sheetOrderA || modelOrderA || IMPORT_PLAN.indexOf(ma);
    const ib = sheetOrderB || modelOrderB || IMPORT_PLAN.indexOf(mb);
    const fa = ia === -1 ? 999999 : ia;
    const fb = ib === -1 ? 999999 : ib;
    if (fa !== fb) return fa - fb;
    return String(ma || a[0]).localeCompare(String(mb || b[0]));
  });
}

async function importRowsJson(client, model, rowsInput = [], options = {}) {
  const sheet = options.sheet || model;
  const rows = (rowsInput || []).map(r => normalizeRow(r, model)).filter(rowHasUsefulData);
  const maxRows = Math.max(1, Math.min(Number(options.maxRowsPerRequest || options.maxRowsPerSheet || rows.length || 1), 200));
  const limitedRows = rows.slice(0, maxRows);
  if (!model) return { imported_at: new Date().toISOString(), report: [{ sheet, model: null, status: 'skipped', reason: 'Model kosong.', rows: 0 }] };
  const exists = await modelExists(client, model);
  if (!exists && model !== 'ir.model') {
    return { imported_at: new Date().toISOString(), report: [{ sheet, model, status: 'skipped', reason: 'Model belum ada di target.', rows: limitedRows.length }] };
  }
  const deadlineMs = Number(options.deadlineMs || 7500);
  const started = Date.now();
  const item = { sheet, model, rows: limitedRows.length, created: 0, updated: 0, skipped: 0, deleted: 0, errors: [], warnings: [], processed: 0 };
  for (let i = 0; i < limitedRows.length; i++) {
    if (i > 0 && Date.now() - started > deadlineMs) {
      item.partial = true;
      item.need_resume = true;
      item.resume_from = i;
      item.warnings.push({ row: i + 2, warnings: [`Request dihentikan aman sebelum timeout setelah ${i} row. Kirim sisa row sebagai batch berikutnya.`] });
      break;
    }
    const row = limitedRows[i];
    try {
      const result = await upsertRow(client, model, row, options);
      item.processed++;
      if (result.created) item.created++;
      else if (result.updated) item.updated++;
      else if (result.deleted) item.deleted++;
      else item.skipped++;
      if (result.warnings?.length) item.warnings.push({ row: (Number(options.baseRowNumber || 2) + i), warnings: result.warnings });
    } catch (err) {
      item.processed++;
      item.errors.push({ row: (Number(options.baseRowNumber || 2) + i), error: flattenError(err), sample: row });
      if (options.stopOnError) break;
    }
  }
  return { imported_at: new Date().toISOString(), report: [item] };
}

async function importWorkbook(client, fileBase64, options = {}) {
  const sheets = rowsFromWorkbook(fileBase64);
  const report = [];
  const maxRowsPerSheet = options.maxRowsPerSheet || 1000;
  for (const [sheet, rowsAll] of orderedSheets(sheets)) {
    const rows = rowsAll.filter(rowHasUsefulData).slice(0, maxRowsPerSheet);
    const model = inferModelFromSheet(sheet, rows);
    const result = await importRowsJson(client, model, rows, { ...options, sheet, baseRowNumber: 2 });
    report.push(...(result.report || []));
  }
  return { imported_at: new Date().toISOString(), report };
}

module.exports = {
  rowsFromWorkbook,
  importPreview,
  importWorkbook,
  importRowsJson,
  importProductImagesFromWorkbook,
  extractImageRowsFromWorkbook,
  upsertRow,
  normalizeRow,
  normalizeColumnName,
  isMetaSheet,
  rowHasUsefulData
};
