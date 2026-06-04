# API Examples

## Full autopsy

```json
{
  "action": "full_autopsy",
  "source": {
    "url": "https://source.odoo.com",
    "db": "source-db",
    "username": "admin@example.com",
    "password": "xxx"
  },
  "payload": {
    "profile": "full"
  }
}
```

## Generate External ID

```json
{
  "action": "ensure_external_ids",
  "source": {
    "url": "https://source.odoo.com",
    "db": "source-db",
    "username": "admin@example.com",
    "password": "xxx"
  },
  "payload": {
    "module": "lokalmart_mig",
    "models": ["res.partner", "product.template", "project.project", "website.page", "ir.ui.view"],
    "limit": 500
  }
}
```

## Export XLSX

```json
{
  "action": "export_migration_safe_xlsx",
  "source": {
    "url": "https://source.odoo.com",
    "db": "source-db",
    "username": "admin@example.com",
    "password": "xxx"
  },
  "payload": {
    "profile": "master",
    "ensureExternalIds": true,
    "limit": 500
  }
}
```

## Import XLSX

```json
{
  "action": "import_xlsx",
  "target": {
    "url": "https://target.odoo.com",
    "db": "target-db",
    "username": "admin@example.com",
    "password": "xxx"
  },
  "payload": {
    "fileBase64": "data:application/vnd.openxmlformats-officedocument.spreadsheetml.sheet;base64,...",
    "maxRowsPerSheet": 500,
    "stopOnError": false
  }
}
```
