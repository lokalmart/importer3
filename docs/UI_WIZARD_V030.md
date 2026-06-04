# Lokalmart Odoo Migration Console v0.3.1

Versi ini menambahkan UI wizard di atas engine v0.2.0 tanpa menghapus endpoint yang sudah berjalan.

## Menu utama

1. **Beranda**
   - Test Source dan Target.
   - Default hard-coded: `https://edu-lokalmart.odoo.com`, DB `edu-lokalmart`, user `sadjax@gmail.com`.
   - Password/API key tetap diisi manual dan tidak disimpan.

2. **Import XLSX**
   - Upload file XLSX dari ChatGPT.
   - Preview lokal membaca nama sheet, `_model`, jumlah row, dan `00_import_order`.
   - Import berjalan per sheet agar error satu sheet tidak menghentikan semuanya.
   - Sheet data sebaiknya memakai nama technical model Odoo, misalnya `product.template`, `res.partner`, `ir.model.fields`.
   - Foto diproses setelah data lewat `image_url` atau `photo_import_queue`.

3. **Export Database**
   - Pilih preset: schema, master, project, accounting, website, full.
   - Format export:
     - banyak XLSX terpisah per model/part,
     - 1 XLSX multi-sheet,
     - ZIP package.
   - Full database semua model aman memakai discovery `ir.model`.
   - Export lanjut walau satu model error.
   - Model/row kosong dilewati secara default.

4. **Pindah Database**
   - Export batch dari source lalu import batch ke target.
   - Relasi tetap memakai External ID.
   - Cocok untuk pindah bertahap ke database Odoo lain.

5. **Log & Riwayat**
   - Semua response API disimpan di localStorage browser.
   - Log job import/export/migrate bisa diunduh sebagai JSON.

## Standar XLSX ChatGPT

Setiap sheet data harus mengikuti aturan:

- Sheet name = technical model Odoo bila memungkinkan.
- Kolom wajib: `__action`, `_external_id`, `_model`.
- Many2one: `field_name_external_id`.
- Many2many: `field_name_external_ids`.
- Foto produk: `image_url` atau sheet `photo_import_queue`.
- Multi-sheet harus menyertakan `00_import_order` untuk urutan import.
- Custom field Odoo Online wajib menggunakan prefix `x_`.

## Anti-timeout

- Export split/migration memakai request kecil per batch.
- Default batch 50 row.
- Jika error/timeout, UI akan mencoba batch lebih kecil sampai 5 row.
- Jika tetap gagal, model ditandai `error lanjut` dan proses berjalan ke model berikutnya.


## v0.3.2 - Fast import mode

- Import rows memakai cache metadata fields_get per batch.
- Resolve External ID dan display name memakai cache per request sehingga relasi berulang seperti kategori/vendor tidak dicari berulang-ulang.
- Opsi default `Mode cepat: skip update existing` membuat importer tidak melakukan write ulang pada record yang External ID-nya sudah ada.
- Opsi `Skip field custom yang sudah ada` membuat `ir.model.fields` tidak di-update ulang, karena update field custom sangat lambat di Odoo.
- Context import menonaktifkan tracking/chatter untuk mengurangi overhead mail.thread.
