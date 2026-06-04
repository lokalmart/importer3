const DEFAULT_EXPORT_MODELS = [
  'res.company',
  'res.partner.category',
  'res.partner',
  'product.category',
  'product.public.category',
  'uom.category',
  'uom.uom',
  'product.attribute',
  'product.attribute.value',
  'product.template',
  'product.product',
  'product.supplierinfo',
  'account.group',
  'account.account',
  'account.tax.group',
  'account.tax',
  'account.journal',
  'account.payment.term',
  'account.analytic.plan',
  'account.analytic.account',
  'project.project',
  'project.task.type',
  'project.milestone',
  'project.task',
  'account.analytic.line',
  'website',
  'website.menu',
  'website.page',
  'ir.ui.view',
  'ir.attachment'
];

const SCHEMA_MODELS = [
  'ir.model',
  'ir.model.fields',
  'ir.model.fields.selection',
  'ir.ui.view',
  'ir.ui.menu',
  'ir.actions.act_window',
  'ir.model.access',
  'ir.rule'
];

const MASTER_MODELS = [
  'res.company',
  'res.partner.category',
  'res.partner',
  'product.category',
  'product.public.category',
  'uom.category',
  'uom.uom',
  'product.attribute',
  'product.attribute.value',
  'product.template',
  'product.product',
  'product.supplierinfo'
];

const PROJECT_MODELS = [
  'account.analytic.plan',
  'account.analytic.account',
  'project.project',
  'project.task.type',
  'project.milestone',
  'project.task',
  'account.analytic.line'
];

const ACCOUNTING_MODELS = [
  'account.group',
  'account.account',
  'account.tax.group',
  'account.tax',
  'account.journal',
  'account.payment.term',
  'account.analytic.plan',
  'account.analytic.account'
];

const WEBSITE_MODELS = [
  'website',
  'ir.ui.view',
  'website.page',
  'website.menu',
  'ir.attachment'
];

const PRESET_GROUPS = {
  schema: {
    key: 'schema',
    label: 'Schema & Custom Fields',
    description: 'Custom model, custom field, selection, view teknis, menu, access rights, dan record rules.',
    models: SCHEMA_MODELS
  },
  master: {
    key: 'master',
    label: 'Master Data, Produk & Foto',
    description: 'Company, kontak/vendor, kategori produk, UoM, attribute, produk, varian, dan supplier info. Foto diproses lewat image_url setelah produk masuk.',
    models: MASTER_MODELS
  },
  project: {
    key: 'project',
    label: 'Project & Operasional',
    description: 'Project, task stage, milestone, task, analytic account, dan analytic line/timesheet.',
    models: PROJECT_MODELS
  },
  accounting: {
    key: 'accounting',
    label: 'Akuntansi Config',
    description: 'Bagan akun, pajak, jurnal, payment terms, analytic plan, dan analytic account. Transaksi besar sebaiknya dipindah setelah master stabil.',
    models: ACCOUNTING_MODELS
  },
  website: {
    key: 'website',
    label: 'Website Pages & QWeb',
    description: 'Website, QWeb view, website.page, menu website, dan attachment website.',
    models: WEBSITE_MODELS
  },
  full: {
    key: 'full',
    label: 'Semua Migration-Safe',
    description: 'Gabungan schema, master data, project, accounting config, website, dan attachment utama.',
    models: DEFAULT_EXPORT_MODELS
  }
};

const IMPORT_PLAN = [
  'ir.model',
  'ir.model.fields',
  'ir.model.fields.selection',
  'ir.model.access',
  'ir.rule',
  'res.company',
  'res.partner.category',
  'res.partner',
  'product.category',
  'product.public.category',
  'uom.category',
  'uom.uom',
  'product.attribute',
  'product.attribute.value',
  'product.template',
  'product.product',
  'product.supplierinfo',
  'account.group',
  'account.account',
  'account.tax.group',
  'account.tax',
  'account.journal',
  'account.payment.term',
  'account.analytic.plan',
  'account.analytic.account',
  'project.project',
  'project.task.type',
  'project.milestone',
  'project.task',
  'account.analytic.line',
  'website',
  'ir.ui.view',
  'website.page',
  'website.menu',
  'ir.ui.menu',
  'ir.actions.act_window',
  'ir.attachment'
];

const PROFILE_OVERRIDES = {
  'ir.model': {
    domain: [['state', '=', 'manual']],
    includeFields: ['name', 'model', 'state', 'info', 'transient']
  },
  'ir.model.fields': {
    domain: [['state', '=', 'manual']],
    includeFields: ['name', 'field_description', 'model', 'model_id', 'ttype', 'relation', 'relation_field', 'required', 'readonly', 'store', 'index', 'copied', 'translate', 'help', 'state', 'selection_ids']
  },
  'ir.model.fields.selection': {
    includeFields: ['field_id', 'value', 'name', 'sequence']
  },
  'ir.ui.view': {
    domain: ['|', ['key', 'ilike', 'lokalmart'], ['name', 'ilike', 'lokalmart']],
    includeFields: ['name', 'type', 'key', 'mode', 'model', 'priority', 'active', 'inherit_id', 'arch_db', 'website_id']
  },
  'website.page': {
    includeFields: ['name', 'url', 'view_id', 'website_id', 'is_published', 'date_publish', 'indexed']
  },
  'website.menu': {
    includeFields: ['name', 'url', 'parent_id', 'page_id', 'website_id', 'sequence']
  },
  'ir.attachment': {
    includeFields: ['name', 'res_model', 'res_id', 'type', 'url', 'mimetype', 'datas', 'public', 'website_id'],
    binary: true
  },
  'res.partner': {
    domain: [],
    required: ['name']
  },
  'product.template': {
    required: ['name']
  },
  'project.project': {
    required: ['name']
  },
  'project.task': {
    required: ['name']
  },
  'account.account': {
    required: ['code', 'name']
  }
};

function getProfile(model) {
  return PROFILE_OVERRIDES[model] || {};
}

function normalizeProfileKeys(input = 'full') {
  if (Array.isArray(input)) return input.map(v => String(v).trim()).filter(Boolean);
  if (typeof input === 'string') return input.split(',').map(v => v.trim()).filter(Boolean);
  return ['full'];
}

function exportModelsForProfile(profile = 'full') {
  const key = String(profile || 'full').trim();
  return (PRESET_GROUPS[key] && PRESET_GROUPS[key].models) || DEFAULT_EXPORT_MODELS;
}

function exportModelsForProfiles(profiles = 'full') {
  const keys = normalizeProfileKeys(profiles);
  if (!keys.length || keys.includes('full') || keys.includes('all')) return [...DEFAULT_EXPORT_MODELS];
  const out = [];
  const seen = new Set();
  for (const key of keys) {
    const models = exportModelsForProfile(key);
    for (const model of models) {
      if (!seen.has(model)) {
        seen.add(model);
        out.push(model);
      }
    }
  }
  return out.length ? out : [...DEFAULT_EXPORT_MODELS];
}

function presetSummary() {
  return Object.fromEntries(Object.entries(PRESET_GROUPS).map(([key, preset]) => [key, {
    key,
    label: preset.label,
    description: preset.description,
    model_count: preset.models.length,
    models: preset.models
  }]));
}

module.exports = {
  DEFAULT_EXPORT_MODELS,
  SCHEMA_MODELS,
  MASTER_MODELS,
  PROJECT_MODELS,
  ACCOUNTING_MODELS,
  WEBSITE_MODELS,
  PRESET_GROUPS,
  IMPORT_PLAN,
  getProfile,
  exportModelsForProfile,
  exportModelsForProfiles,
  presetSummary
};
