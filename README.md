# Lokalmart Odoo Migration Builder

## v0.1.9 - Fault-tolerant export dan multi-sheet import-safe

Perbaikan utama:

- Frontend tidak lagi crash saat Vercel mengembalikan non-JSON seperti `An error occurred...`; pesan non-JSON dibaca sebagai error biasa.
- Full database export bertahap tetap lanjut ke model berikutnya ketika satu model gagal.
- Model/batch kosong tidak diekspor menjadi file/sheet kosong kecuali opsi **Ekspor model kosong juga** dicentang.
- Ada opsi **Export 1 XLSX Multi-Sheet** untuk membuat satu workbook dengan banyak sheet.
- Workbook multi-sheet memakai sheet data bernama technical model Odoo sebisa mungkin, dan tetap menyimpan kolom `_model` untuk model yang namanya harus dipendekkan karena batas 31 karakter Excel.
- Workbook multi-sheet membawa `00_import_order` sehingga import ulang otomatis mengikuti urutan dependency dan relasi.
- Relasi many2one/many2many tetap memakai `*_external_id` dan `*_external_ids`, sehingga mudah diimport kembali ke database lain.
- Importer mengabaikan row kosong dan tetap `stopOnError:false` secara default dari UI.


## Default Lokalmart v0.1.4

Frontend sudah di-hard-code dengan default berikut agar tidak jatuh ke localhost dan tidak perlu mengetik ulang koneksi:

```text
URL      : https://edu-lokalmart.odoo.com
Database : edu-lokalmart
Username : sadjax@gmail.com
Password : tidak di-hard-code; isi manual di form atau Vercel Environment Variables
```

Source dan Target sama-sama diberi default ini. Untuk migrasi nyata, ubah Target ke database kosong/tujuan agar tidak mengimpor ulang ke database yang sama.


Aplikasi Vercel satu-endpoint untuk scan, export, dan import XLSX migration-safe Odoo 18. Mulai v0.1.5, daftar model tidak perlu diisi manual karena UI memakai preset checklist otomatis.

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
| `model_presets` | Ambil preset checklist model otomatis: schema, master, project, accounting, website, full |
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

## Profile / checklist export

Di UI, pilih checklist berikut. Backend otomatis mengubah pilihan menjadi daftar model yang benar.

| Checklist | Isi utama |
|---|---|
| Schema & Custom Fields | `ir.model`, `ir.model.fields`, selection, view, menu, access rights, record rules |
| Master Data, Produk & Foto | company, partner, kategori, UoM, attribute, product, supplier info |
| Project & Operasional | project, stage, milestone, task, analytic account, analytic line |
| Akuntansi Config | account group, account, tax, journal, payment term, analytic |
| Website Pages & QWeb | website, `ir.ui.view`, `website.page`, `website.menu`, attachment |
| Semua Migration-Safe | gabungan utama |

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

## v0.1.1 - Legacy XLSX compatibility patch

Patch ini menambahkan mode kompatibilitas untuk file XLSX lama yang dibuat sebelum format migration-safe final.

Yang sekarang otomatis dikenali:

- `external_id` -> `_external_id`
- `parent_external_id` -> `parent_id_external_id`
- `categ_external_id` -> `categ_id_external_id`
- `public_categ_external_ids` -> `public_categ_ids_external_ids`
- `category_external_ids` -> `category_id_external_ids`
- `attribute_external_id` -> `attribute_id_external_id`
- `product_tmpl_external_id` -> `product_tmpl_id_external_id`
- `partner_external_id` -> `partner_id_external_id`
- `field_external_id` -> `field_id_external_id`
- `value_external_ids` -> `value_ids_external_ids`

Sheet metadata/notes seperti `README`, `_import_order`, `_importer_rules`, `_summary_check`, `_accounting_category_notes`, `_product_notes`, dan `photo_import_queue` tidak lagi dipaksa menjadi model Odoo palsu.

Tambahan khusus:

- `ir.model.fields` sekarang membuat external id field setelah field berhasil dibuat/diupdate.
- `ir.model.fields.selection` sekarang punya handler khusus untuk resolve field dari `field_external_id`/`field_id_external_id`.
- Kolom `selection_values` di sheet `ir.model.fields` bisa langsung dibuat menjadi pilihan selection dengan format `value:Label;value2:Label 2`.
- Kolom nama manusia seperti `country_name`, `state_name`, `uom_name`, `uom_po_name`, dan `currency_name` dipakai sebagai hint untuk mencari record relasi berdasarkan nama jika external id tidak tersedia.


## v0.1.4 - Import foto produk dari URL dan standar XLSX ChatGPT

Versi ini menambahkan standar resmi untuk file XLSX yang dibuat ChatGPT dan fitur import foto produk dari URL.

### Fitur baru

- Action API baru: `import_product_images`.
- Tombol frontend baru: **Import Foto dari URL**.
- Kolom foto standar: `image_url`.
- Alias foto lama yang diterima: `photo_url`, `image_1920_url`, `product_image_url`, `main_image_url`.
- Sheet antrean foto: `photo_import_queue` atau `_photo_import_queue`.
- Foto di-download dari URL publik, dikonversi menjadi base64, lalu ditulis ke field gambar Odoo:
  - `product.template.image_1920`
  - `product.product.image_variant_1920` jika tersedia
- `image_url` tidak lagi dianggap field biasa yang memicu warning palsu saat import data.

### Cara import produk dengan foto URL

1. Import data produk dulu dengan tombol **Import ke Target**.
2. Pastikan produk punya `_external_id` dan sukses dibuat/diupdate.
3. Klik **Import Foto dari URL**.
4. Importer akan mencari produk berdasarkan `_external_id`, download `image_url`, lalu menulis ke `image_1920`.

### Format produk dengan foto

```text
Sheet: product.template
Kolom wajib foto: _external_id, name, image_url
```

Contoh:

```text
_external_id,name,categ_id_external_id,image_url
lokalmart.prod_aglaonema_red_001,Aglaonema Red,lokalmart.cat_tanaman_hias,https://example.com/aglaonema-red.jpg
```

### Sheet antrean foto opsional

```text
Sheet: photo_import_queue
Kolom: model, record_external_id, image_url, image_field, image_alt, image_note
```

Contoh:

```text
product.template,lokalmart.prod_aglaonema_red_001,https://example.com/aglaonema-red.jpg,image_1920,Aglaonema Red,Foto utama produk
```

### Panduan XLSX untuk ChatGPT

Lihat file:

```text
docs/XLSX_TEMPLATE_GUIDE_CHATGPT.md
```

Gunakan dokumen itu sebagai standar agar ChatGPT tidak membuat template XLSX baru yang gagal import.


## Fix v0.1.4 — URL tidak boleh jatuh ke 127.0.0.1

Jika muncul error `connect ECONNREFUSED 127.0.0.1:80`, penyebab paling umum adalah URL Odoo dikirim tanpa protocol, misalnya `edu-lokalmart.odoo.com` bukan `https://edu-lokalmart.odoo.com`. Mulai v0.1.4, frontend dan backend otomatis menambahkan `https://` dan menolak URL localhost agar request XML-RPC tidak salah arah.
## v0.1.8 — Export Semua Isi Database

Versi ini menambahkan tombol **Export Semua Isi DB (ZIP)** dan action API:

```text
export_full_database_archive_zip
```

Mode ini membaca daftar model dari `ir.model`, melewati model runtime yang berisiko seperti `mail.message`, `mail.mail`, `bus.*`, dan `ir.logging`, lalu mengekspor record yang bisa dibaca ke paket ZIP berisi XLSX per model.

Payload contoh:

```json
{
  "action": "export_full_database_archive_zip",
  "source": { "url": "https://edu-lokalmart.odoo.com", "db": "edu-lokalmart", "username": "sadjax@gmail.com", "password": "API_KEY" },
  "payload": {
    "exportAll": true,
    "discoverAllModels": true,
    "includeBinary": false,
    "ensureExternalIds": true,
    "includeUnsafe": false
  }
}
```

Catatan:

- `includeBinary:false` lebih aman untuk Vercel karena file tidak terlalu besar.
- Aktifkan **Sertakan binary/foto/attachment** hanya bila ukuran database masih kecil atau kamu memang membutuhkan gambar/file di ZIP.
- Untuk backup utuh SQL + filestore, tetap gunakan backup resmi Odoo dari database manager. Export ZIP dari aplikasi ini ditujukan untuk migrasi/import selektif dan audit, bukan pengganti 100% backup PostgreSQL Odoo.


## v0.1.8 - Full Database Export Bertahap Tanpa ZIP + Kategori

Mode full database archive sekarang tidak lagi harus membuat satu ZIP besar. Frontend mengekspor model satu per satu sebagai banyak file XLSX terpisah. Setiap model bisa dipecah menjadi beberapa part berdasarkan batch rows, sehingga lebih aman untuk Vercel/serverless.

Fitur baru:

- `discover_archive_models`: mengambil daftar model aman untuk arsip database.
- `export_model_xlsx`: mengekspor satu model dan satu batch/part menjadi satu file XLSX.
- UI status loading per model.
- Progress bar global.
- Tombol Stop Export yang membatalkan request aktif dan menghentikan loop berikutnya.
- Manifest JSON yang berisi daftar file XLSX yang sudah berhasil diunduh.

Alur export semua isi database:

```text
1. Test Source
2. Klik Muat Daftar Model Aman
3. Atur Batch rows per file, misalnya 500
4. Klik Mulai Export Semua Isi DB
5. Browser akan mengunduh banyak file XLSX terpisah
6. Jika perlu, klik Stop Export
7. Klik Download Manifest untuk menyimpan daftar file yang sudah jadi
```

Catatan: browser bisa menanyakan izin download banyak file. Izinkan download multiple files dari domain Vercel importer.


## v0.1.8 - Kategorisasi File XLSX Full Database

Mode full database export bertahap sekarang mengelompokkan file XLSX berdasarkan kategori model agar ratusan file tidak tercampur. Karena browser tidak dapat membuat folder lokal secara andal tanpa izin File System Access API, mekanisme yang dipakai adalah **prefix kategori pada nama file** dan **manifest berkategori**.

Contoh nama file:

```text
00_schema__ir.model.fields__part_0001__2026-06-04.xlsx
01_contacts_company__res.partner__part_0001__2026-06-04.xlsx
02_products_inventory__product.template__part_0001__2026-06-04.xlsx
03_accounting__account.account__part_0001__2026-06-04.xlsx
04_project_operations__project.task__part_0001__2026-06-04.xlsx
05_website_qweb__website.page__part_0001__2026-06-04.xlsx
```

Kategori default:

```text
00_schema
01_contacts_company
02_products_inventory
03_accounting
04_project_operations
05_website_qweb
06_sales_purchase
07_mail_discuss
08_marketing_events
09_lokalmart_custom
99_other
```

Frontend juga menampilkan checklist kategori setelah tombol **Muat Daftar Model Aman** diklik. Dengan begitu export bisa dijalankan hanya untuk kategori tertentu, misalnya hanya produk dan website. Manifest JSON menyimpan `category`, `category_label`, `model`, `filename`, `part`, `offset`, `rows`, dan `total`.
