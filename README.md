# Lokalmart Odoo Migration Builder

Aplikasi Vercel satu-endpoint untuk scan, export, dan import XLSX migration-safe Odoo 18.

## Tujuan

Aplikasi ini dibuat untuk membangun ulang struktur dan data Odoo dari database lama ke database baru dengan pendekatan:

- External ID sebagai kunci utama, bukan Database ID.
- Scanner model dan field via `ir.model` dan `fields_get`.
- Export XLSX/ZIP migration-safe.
- Import bertahap berdasarkan urutan dependency.
- Resolver relasi Many2one/Many2many lewat kolom `*_external_id` dan `*_external_ids`.
- Validator XML/QWeb untuk `ir.ui.view.arch_db`.
- Satu Serverless Function: `/api/odoo.js`.

## Install lokal

```bash
npm install
npm run dev
```

Buka:

```text
http://localhost:3000
```

## Deploy ke Vercel

1. Upload semua file ke GitHub.
2. Import repository ke Vercel.
3. Deploy.
4. Buka domain Vercel dan isi koneksi Odoo lama/baru dari UI.

## Endpoint

Semua request memakai:

```text
POST /api/odoo
```

Contoh body:

```json
{
  "action": "test_connection",
  "source": {
    "url": "https://your-odoo.odoo.com",
    "db": "your-db",
    "username": "admin@example.com",
    "password": "api-key-or-password"
  }
}
```

## Action yang tersedia

| Action | Fungsi |
|---|---|
| `health` | Cek aplikasi hidup |
| `test_connection` | Test login Odoo |
| `version` | Ambil versi server Odoo |
| `scan_models` | Scan model dan field |
| `full_autopsy` | Scan lengkap model, field, custom field, external id, QWeb warning |
| `model_exists` | Cek apakah model tersedia |
| `ensure_external_ids` | Membuat External ID untuk record yang belum punya |
| `export_migration_safe_xlsx` | Export XLSX migration-safe |
| `export_migration_package_zip` | Export ZIP berisi XLSX per model |
| `target_gap_report` | Bandingkan source dan target |
| `import_preview_xlsx` | Preview XLSX sebelum import |
| `import_xlsx` | Import XLSX ke target |
| `validate_qweb_xml` | Validasi XML/QWeb |

## Profile export

| Profile | Isi |
|---|---|
| `schema` | `ir.model`, `ir.model.fields`, `ir.ui.view`, security dasar |
| `master` | company, partner, category, product |
| `project` | project, task, milestone, analytic |
| `website` | website, page, menu, QWeb view, attachment |
| `accounting` | chart of accounts, tax, journal, analytic |
| `full` | gabungan profile utama |

## Kolom XLSX wajib

Setiap sheet record sebaiknya memiliki:

```text
__action
_model
_external_id
_old_db_id
_display_name
```

Relasi:

```text
company_id_external_id
parent_id_external_id
categ_id_external_id
project_id_external_id
stage_id_external_id
public_categ_ids_external_ids
```

Many2one menggunakan satu External ID. Many2many menggunakan daftar External ID dipisahkan koma.

## Urutan import aman

Aplikasi mengurutkan sheet mengikuti rencana import di `lib/modelProfiles.js`:

1. custom model
2. custom field
3. security
4. company/contact
5. product/category
6. accounting config
7. project/task
8. website/view/page/menu
9. attachment

## Batasan penting

- Odoo Online tidak dapat menerima custom Python method dari XLSX. Aplikasi ini hanya membangun record, field manual, view, page, dan konfigurasi.
- Custom field/model manual harus memakai prefix `x_`.
- Accounting transaction penuh tidak disarankan sebagai langkah pertama. Gunakan config/master data dulu, lalu opening balance.
- Mail/chatter, log, session, password user, dan computed field tidak dipindahkan secara mentah.
- Export/import besar di Vercel bisa timeout. Gunakan profile kecil, batas `limit`, atau pecah per model.

## Rekomendasi workflow Lokalmart

1. Source: `Full Autopsy Source`.
2. Source: `Generate External ID` untuk model penting.
3. Source: export `schema` dulu.
4. Target: import schema.
5. Target: gap report.
6. Source: export `master`.
7. Target: import master.
8. Lanjut `project`, `website`, lalu `accounting`.

## Keamanan

Jangan commit password/API key ke GitHub. Isi credential dari UI atau Environment Variables Vercel.
