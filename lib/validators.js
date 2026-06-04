const { XMLParser } = require('fast-xml-parser');

const parser = new XMLParser({
  ignoreAttributes: false,
  allowBooleanAttributes: false,
  parseTagValue: false,
  parseAttributeValue: false,
  trimValues: false,
  processEntities: true
});

function validateXml(xml) {
  if (!xml || typeof xml !== 'string') return { ok: true, warnings: ['Kosong, tidak divalidasi.'] };
  try {
    parser.parse(`<root>${xml}</root>`);
    const warnings = [];
    const boolAttrs = xml.match(/\s(open|checked|selected|disabled|readonly|required|multiple|autofocus|autoplay|controls|loop|muted)\s*(?=[>\/\s])/gi);
    if (boolAttrs && boolAttrs.length) {
      warnings.push(`Ada boolean attribute HTML5 tanpa nilai XML-valid: ${[...new Set(boolAttrs.map(s => s.trim()))].join(', ')}. Gunakan checked="checked", disabled="disabled", dst.`);
    }
    if (/<script[\s>][\s\S]*?[<&][\s\S]*?<\/script>/i.test(xml) && !/<!\[CDATA\[/i.test(xml)) {
      warnings.push('Ada <script> yang mungkin berisi karakter <, >, atau &: untuk QWeb sebaiknya bungkus isi JS dengan CDATA.');
    }
    return { ok: true, warnings };
  } catch (err) {
    return { ok: false, error: err.message || String(err), warnings: [] };
  }
}

function validateWorkbookRows(rows, fieldsMeta) {
  const warnings = [];
  for (const [idx, row] of rows.entries()) {
    for (const [key, value] of Object.entries(row)) {
      if (!fieldsMeta[key] && !key.startsWith('_') && !key.endsWith('_external_id') && !key.endsWith('_external_ids') && !key.includes('/id')) {
        warnings.push({ row: idx + 2, field: key, message: 'Kolom tidak cocok dengan field model dan akan dilewati.' });
      }
      if (typeof value === 'string' && /[\u0000-\u0008\u000B\u000C\u000E-\u001F]/.test(value)) {
        warnings.push({ row: idx + 2, field: key, message: 'Terdeteksi hidden control character.' });
      }
    }
  }
  return warnings;
}

module.exports = { validateXml, validateWorkbookRows };
