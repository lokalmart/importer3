# Panduan Standar XLSX ChatGPT untuk Lokalmart Odoo Migration Builder v0.1.2

Dokumen ini adalah aturan baku ketika ChatGPT membuat file XLSX untuk diimport melalui Vercel **Lokalmart Odoo Migration Builder**. Tujuannya agar ChatGPT tidak membuat format baru yang gagal import.

## Prinsip utama

1. Semua record yang bisa di-update ulang wajib punya `_external_id`.
2. Jangan memakai Database ID Odoo lama sebagai relasi utama.
3. Relasi many2one wajib memakai `nama_field_external_id`.
4. Relasi many2many wajib memakai `nama_field_external_ids` dengan isi dipisah koma.
5. Foto produk dari URL wajib memakai kolom `image_url`.
6. Import data dan import foto dipisah: import record dulu, lalu klik **Import Foto dari URL**.
7. Sheet catatan harus diawali `00_`, `99_`, atau `_`, misalnya `00_README`.

## Sheet yang disarankan

Urutan workbook:

1. `00_README`
2. `ir.model`
3. `ir.model.fields`
4. `ir.model.fields.selection`
5. `res.partner.category`
6. `res.partner`
7. `product.category`
8. `product.public.category`
9. `product.attribute`
10. `product.attribute.value`
11. `product.template`
12. `product.supplierinfo`
13. `project.project`
14. `project.task.type`
15. `project.task`
16. `website.page`
17. `ir.ui.view`
18. `photo_import_queue` atau `_photo_import_queue`
19. `99_IMPORT_CHECKLIST`

## Kolom wajib umum

Gunakan kolom ini di hampir semua sheet model:

| Kolom | Isi |
|---|---|
| `__action` | `upsert`, `skip`, atau `delete_optional` |
| `_external_id` | ID stabil seperti `lokalmart.prod_aglaonema_red_001` |
| `_old_db_id` | opsional, hanya referensi database lama |
| `name` | nama record, bila model membutuhkan nama |
| `import_note` | catatan manusia, otomatis dilewati importer |

## Format External ID

Gunakan pola:

```text
lokalmart.<model_ringkas>_<slug>_<nomor>
```

Contoh:

```text
lokalmart.partner_koperasi_lokal_kejaksan
lokalmart.cat_tanaman_hias
lokalmart.pubcat_tanaman_hias
lokalmart.prod_aglaonema_red_001
lokalmart.field_product_template_x_lm_status_validasi
```

## Relasi many2one

Jika field Odoo bernama `categ_id`, kolom XLSX harus bernama:

```text
categ_id_external_id
```

Contoh:

| _external_id | name | categ_id_external_id |
|---|---|---|
| lokalmart.prod_aglaonema_red_001 | Aglaonema Red | lokalmart.cat_tanaman_hias |

## Relasi many2many

Jika field Odoo bernama `public_categ_ids`, kolom XLSX harus bernama:

```text
public_categ_ids_external_ids
```

Isi dipisah koma:

```text
lokalmart.pubcat_tanaman_hias,lokalmart.pubcat_home_decor
```

## Custom fields

Sheet: `ir.model.fields`

Kolom minimal:

| __action | _external_id | model | name | field_description | ttype | state | required | readonly | index | relation | selection_values |
|---|---|---|---|---|---|---|---|---|---|---|---|
| upsert | lokalmart.field_product_template_x_lm_status_validasi | product.template | x_lm_status_validasi | Status Validasi | selection | manual | FALSE | FALSE | FALSE |  | draft:Draft;ready:Ready;rejected:Ditolak |

Aturan:

- Nama custom field harus diawali `x_`.
- `state` harus `manual`.
- Untuk many2one/many2many, isi `relation` dengan model tujuan, misalnya `res.partner`.
- Selection bisa dibuat melalui `selection_values` atau sheet `ir.model.fields.selection`.

## Field selection

Sheet: `ir.model.fields.selection`

| __action | _external_id | field_id_external_id | value | name | sequence |
|---|---|---|---|---|---:|
| upsert | lokalmart.sel_product_template_x_lm_status_validasi_draft | lokalmart.field_product_template_x_lm_status_validasi | draft | Draft | 10 |
| upsert | lokalmart.sel_product_template_x_lm_status_validasi_ready | lokalmart.field_product_template_x_lm_status_validasi | ready | Ready | 20 |

Alias lama `field_external_id` masih dibaca, tetapi standar baru adalah `field_id_external_id`.

## Produk dengan foto URL

Sheet: `product.template`

Kolom minimal untuk produk:

| __action | _external_id | name | type | sale_ok | purchase_ok | list_price | standard_price | categ_id_external_id | public_categ_ids_external_ids | image_url | import_note |
|---|---|---|---|---|---|---:|---:|---|---|---|---|
| upsert | lokalmart.prod_aglaonema_red_001 | Aglaonema Red | consu | TRUE | TRUE | 75000 | 45000 | lokalmart.cat_tanaman_hias | lokalmart.pubcat_tanaman_hias | https://example.com/aglaonema-red.jpg | Foto diimpor setelah record produk dibuat |

Catatan penting:

- `image_url` **tidak ditulis langsung saat Import ke Target**.
- Setelah produk sukses dibuat, klik tombol **Import Foto dari URL** di Vercel.
- Importer akan download gambar, convert ke base64, lalu menulis ke `product.template.image_1920`.
- URL foto harus publik, langsung bisa diakses, dan mengarah ke gambar JPG/PNG/WebP/GIF.
- Ukuran disarankan di bawah 5 MB per gambar.

## Sheet khusus antrean foto

Jika ingin memisahkan data produk dan foto, buat sheet:

```text
photo_import_queue
```

Kolom:

| model | record_external_id | image_url | image_field | image_alt | image_note |
|---|---|---|---|---|---|
| product.template | lokalmart.prod_aglaonema_red_001 | https://example.com/aglaonema-red.jpg | image_1920 | Aglaonema Red | Foto utama produk |

`image_field` boleh dikosongkan. Default:

- `product.template` → `image_1920`
- `product.product` → `image_variant_1920` jika tersedia, jika tidak `image_1920`

## Alias lama yang masih diterima

Importer v0.1.2 tetap menerima alias lama:

| Alias lama | Standar baru |
|---|---|
| `external_id` | `_external_id` |
| `parent_external_id` | `parent_id_external_id` |
| `categ_external_id` | `categ_id_external_id` |
| `public_categ_external_ids` | `public_categ_ids_external_ids` |
| `category_external_ids` | `category_id_external_ids` |
| `attribute_external_id` | `attribute_id_external_id` |
| `product_tmpl_external_id` | `product_tmpl_id_external_id` |
| `partner_external_id` | `partner_id_external_id` |
| `field_external_id` | `field_id_external_id` |
| `photo_url`, `image_1920_url`, `product_image_url`, `main_image_url` | `image_url` |

Walaupun alias diterima, ChatGPT harus selalu membuat file baru memakai standar baru.

## Urutan tombol di Vercel

Untuk file produk + foto:

1. **Preview Import**
2. **Import ke Target**
3. Cek log: produk/category/field tidak error
4. **Import Foto dari URL**
5. Cek produk di Odoo: foto masuk ke produk

Untuk schema + data:

1. Import `ir.model`
2. Import `ir.model.fields`
3. Import `ir.model.fields.selection`
4. Scan/gap report
5. Import master data
6. Import produk/proyek/website
7. Import foto URL

## Prompt standar untuk ChatGPT

Saat meminta ChatGPT membuat XLSX, gunakan instruksi ini:

```text
Buat file XLSX untuk Lokalmart Odoo Migration Builder v0.1.2. Wajib ikuti docs/XLSX_TEMPLATE_GUIDE_CHATGPT.md:
- semua record pakai _external_id
- relasi many2one pakai *_external_id
- relasi many2many pakai *_external_ids
- custom field wajib x_ dan state manual
- foto produk pakai kolom image_url
- jangan membuat format sheet/kolom baru di luar standar
- sertakan sheet 00_README dan 99_IMPORT_CHECKLIST
```
