const slugify = require('slugify');

const SYSTEM_FIELDS = new Set([
  'id', 'display_name', '__last_update', 'create_uid', 'create_date',
  'write_uid', 'write_date', 'message_follower_ids', 'message_ids',
  'message_attachment_count', 'message_needaction', 'message_needaction_counter',
  'message_has_error', 'message_has_error_counter', 'message_is_follower',
  'activity_ids', 'activity_state', 'activity_user_id', 'activity_type_id',
  'activity_date_deadline', 'activity_summary', 'activity_exception_decoration',
  'activity_exception_icon', 'website_message_ids'
]);

const UNSAFE_MODEL_PREFIXES = [
  'ir.logging', 'ir.cron', 'bus.', 'mail.mail', 'mail.message', 'base.automation'
];

function normalizeUrl(url) {
  if (!url) return '';
  return String(url).trim().replace(/\/$/, '');
}

function chunkArray(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

function uniq(arr) {
  return [...new Set((arr || []).filter(v => v !== undefined && v !== null && v !== ''))];
}

function isPlainObject(v) {
  return v && typeof v === 'object' && !Array.isArray(v);
}

function safeSlug(value, fallback = 'record') {
  const raw = String(value || fallback).trim();
  const s = slugify(raw, { lower: true, strict: true, locale: 'id' })
    .replace(/-/g, '_')
    .replace(/__+/g, '_')
    .replace(/^_+|_+$/g, '');
  return s || fallback;
}

function makeXmlIdName(model, record) {
  const base = record && (record.name || record.complete_name || record.display_name || record.login || record.url || record.key || record.id);
  return `${model.replace(/\./g, '_')}_${safeSlug(base)}_${record.id}`;
}

function splitXmlId(xmlid) {
  if (!xmlid || typeof xmlid !== 'string' || !xmlid.includes('.')) return null;
  const idx = xmlid.indexOf('.');
  const module = xmlid.slice(0, idx).trim();
  const name = xmlid.slice(idx + 1).trim();
  if (!module || !name) return null;
  return { module, name };
}

function joinXmlId(module, name) {
  return `${module}.${name}`;
}

function toBool(v) {
  if (typeof v === 'boolean') return v;
  if (v === 1 || v === '1') return true;
  if (v === 0 || v === '0') return false;
  const s = String(v ?? '').trim().toLowerCase();
  if (['true', 'yes', 'y', 'ya', 'iya', 'on'].includes(s)) return true;
  if (['false', 'no', 'n', 'tidak', 'off'].includes(s)) return false;
  return Boolean(v);
}

function emptyToFalse(v) {
  if (v === undefined || v === null) return false;
  if (typeof v === 'string' && v.trim() === '') return false;
  return v;
}

function looksLikeExternalId(value) {
  return typeof value === 'string' && /^[a-zA-Z0-9_]+\.[a-zA-Z0-9_\.\-]+$/.test(value.trim());
}

function shouldSkipModel(model) {
  return UNSAFE_MODEL_PREFIXES.some(prefix => model === prefix || model.startsWith(prefix));
}

function nowIso() {
  return new Date().toISOString();
}

function flattenError(err) {
  if (!err) return 'Unknown error';
  if (typeof err === 'string') return err;
  const msg = err.faultString || err.message || JSON.stringify(err);
  return String(msg).slice(0, 4000);
}

function parseMaybeJson(value, fallback) {
  if (value === undefined || value === null || value === '') return fallback;
  if (typeof value !== 'string') return value;
  try { return JSON.parse(value); } catch { return fallback; }
}

module.exports = {
  SYSTEM_FIELDS,
  normalizeUrl,
  chunkArray,
  uniq,
  isPlainObject,
  safeSlug,
  makeXmlIdName,
  splitXmlId,
  joinXmlId,
  toBool,
  emptyToFalse,
  looksLikeExternalId,
  shouldSkipModel,
  nowIso,
  flattenError,
  parseMaybeJson
};
