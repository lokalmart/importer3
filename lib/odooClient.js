const xmlrpc = require('xmlrpc');
const { normalizeUrl, validateOdooUrl, chunkArray } = require('./utils');

function rpcCall(client, method, params) {
  return new Promise((resolve, reject) => {
    client.methodCall(method, params, (err, value) => {
      if (err) reject(err);
      else resolve(value);
    });
  });
}

class OdooClient {
  constructor(config) {
    this.url = normalizeUrl(config.url || process.env.ODOO_URL);
    this.db = String(config.db || process.env.ODOO_DB || '').trim();
    this.username = String(config.username || config.user || process.env.ODOO_USERNAME || '').trim();
    this.password = String(config.password || config.apiKey || process.env.ODOO_PASSWORD || '');
    if (!this.url || !this.db || !this.username || !this.password) {
      throw new Error('Konfigurasi Odoo belum lengkap: url, db, username, password/apiKey wajib diisi. Pastikan URL memakai domain Odoo, contoh https://edu-lokalmart.odoo.com');
    }
    validateOdooUrl(this.url);
    this.common = xmlrpc.createClient({ url: `${this.url}/xmlrpc/2/common` });
    this.object = xmlrpc.createClient({ url: `${this.url}/xmlrpc/2/object` });
    this.uid = null;
  }

  async authenticate() {
    if (this.uid) return this.uid;
    const uid = await rpcCall(this.common, 'authenticate', [this.db, this.username, this.password, {}]);
    if (!uid) throw new Error('Login Odoo gagal. Cek URL, database, username, dan password/API key.');
    this.uid = uid;
    return uid;
  }

  async version() {
    return rpcCall(this.common, 'version', []);
  }

  async executeKw(model, method, args = [], kwargs = {}) {
    const uid = await this.authenticate();
    return rpcCall(this.object, 'execute_kw', [this.db, uid, this.password, model, method, args, kwargs]);
  }

  async search(model, domain = [], kwargs = {}) {
    return this.executeKw(model, 'search', [domain], kwargs);
  }

  async searchCount(model, domain = []) {
    return this.executeKw(model, 'search_count', [domain], {});
  }

  async read(model, ids, fields = [], kwargs = {}) {
    if (!ids || ids.length === 0) return [];
    const finalKwargs = fields && fields.length ? { fields, ...kwargs } : kwargs;
    return this.executeKw(model, 'read', [ids], finalKwargs);
  }

  async searchRead(model, domain = [], fields = [], kwargs = {}) {
    const kw = { ...kwargs };
    if (fields && fields.length) kw.fields = fields;
    return this.executeKw(model, 'search_read', [domain], kw);
  }

  async fieldsGet(model, fields = [], attributes = []) {
    const kwargs = {};
    if (attributes && attributes.length) kwargs.attributes = attributes;
    if (fields && fields.length) return this.executeKw(model, 'fields_get', [fields], kwargs);
    return this.executeKw(model, 'fields_get', [], kwargs);
  }

  async create(model, vals) {
    return this.executeKw(model, 'create', [vals], {});
  }

  async write(model, ids, vals) {
    if (!ids || ids.length === 0) return true;
    return this.executeKw(model, 'write', [ids, vals], {});
  }

  async unlink(model, ids) {
    if (!ids || ids.length === 0) return true;
    return this.executeKw(model, 'unlink', [ids], {});
  }

  async readInChunks(model, ids, fields = [], chunkSize = 80) {
    const rows = [];
    for (const chunk of chunkArray(ids, chunkSize)) {
      rows.push(...await this.read(model, chunk, fields));
    }
    return rows;
  }

  async searchReadPaged(model, domain = [], fields = [], options = {}) {
    const limit = options.limit || 500;
    const offsetStep = options.offsetStep || Math.min(limit, 200);
    let offset = options.offset || 0;
    const all = [];
    while (all.length < limit) {
      const rows = await this.searchRead(model, domain, fields, { limit: Math.min(offsetStep, limit - all.length), offset, order: options.order || 'id asc' });
      if (!rows.length) break;
      all.push(...rows);
      offset += rows.length;
      if (rows.length < offsetStep) break;
    }
    return all;
  }
}

function makeClient(config) {
  return new OdooClient(config || {});
}

module.exports = { OdooClient, makeClient };
