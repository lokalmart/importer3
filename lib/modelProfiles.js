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

function exportModelsForProfile(profile = 'full') {
  if (profile === 'schema') return SCHEMA_MODELS;
  if (profile === 'master') return ['res.company', 'res.partner.category', 'res.partner', 'product.category', 'product.public.category', 'product.template', 'product.supplierinfo'];
  if (profile === 'project') return ['project.project', 'project.task.type', 'project.milestone', 'project.task', 'account.analytic.account', 'account.analytic.line'];
  if (profile === 'website') return ['website', 'ir.ui.view', 'website.page', 'website.menu', 'ir.attachment'];
  if (profile === 'accounting') return ['account.group', 'account.account', 'account.tax.group', 'account.tax', 'account.journal', 'account.payment.term', 'account.analytic.plan', 'account.analytic.account'];
  return DEFAULT_EXPORT_MODELS;
}

module.exports = {
  DEFAULT_EXPORT_MODELS,
  SCHEMA_MODELS,
  IMPORT_PLAN,
  getProfile,
  exportModelsForProfile
};
