Lokalmart ChatGPT XLSX Standard v0.3.3
Update dari v0.3.2 berdasarkan hasil import, error log, dan patch Odoo Online/Vercel Importer.

A. Aturan dasar tetap dari v0.3.2
- Sheet data memakai nama technical model: product.template, res.partner, project.task, ir.model.fields.
- Kolom wajib setiap sheet data: __action, _external_id, _model.
- Many2one data row: field_name_external_id.
- Many2many data row: field_name_external_ids, isi dipisah koma.
- Foto produk: image_url atau sheet photo_import_queue.
- Multi-sheet wajib punya 00_import_order bila urutan relasi penting.
- Row kosong tidak perlu dibuat.
- Custom field Odoo Online wajib memakai nama x_.

B. Aturan import order
- Wajib sediakan 00_import_order untuk workbook multi-sheet.
- Urutan aman umum:
  1. ir.model
  2. ir.model.fields
  3. ir.model.access
  4. master data induk, misalnya x_lm_koloni, res.partner, product.category
  5. product.template
  6. custom data relasional, misalnya x_lm_paspor_produk, x_lm_batch_produk, x_lm_trace_event
  7. project.project, project.task
  8. slide.channel, slide.slide
  9. photo_import_queue
- Jangan mencampur patch QWeb/website.page dengan import data inti bila belum diuji.

C. Aturan ir.model
- Semua custom model Odoo Online harus memakai prefix x_, contoh x_lm_koloni.
- Jangan membuat ulang model inti Odoo bila cukup extend model asli.
- Gunakan model asli untuk data inti:
  - res.partner untuk UMKM/vendor/customer/driver/surveyor.
  - product.template untuk produk jualan.
  - product.category untuk kategori.
  - project.project dan project.task untuk pekerjaan lapangan.
  - slide.channel dan slide.slide untuk eLearning.
  - website.page hanya untuk halaman setelah ir.ui.view siap.

D. Aturan ir.model.fields
- Semua custom field Odoo Online harus memakai prefix x_.
- Jangan membuat custom field char yang berakhiran _id bila bukan Many2one, karena bisa membingungkan importer.
  Contoh aman: x_lm_lokal_code, bukan x_lm_lokal_id bila hanya kode teks.
- Field Many2one custom harus dibuat dengan ttype=many2one dan relation berisi technical model tujuan.
- Untuk field Many2one custom, isi kedua kolom berikut bila tersedia:
  - on_delete = restrict
  - ondelete = restrict
- Pelajaran dari error Odoo:
  Many2one yang required=True tetapi ondelete terbaca set null akan gagal.
  Maka untuk Odoo Online/Vercel Importer, custom Many2one sebaiknya dibuat required=False pada tahap pembuatan field.
- Relasi tetap diisi pada data row melalui field_name_external_id walaupun field-nya required=False.
- Jika importer tidak membaca on_delete, tambahkan juga ondelete.
- Jika field relasi gagal dibuat, data row berikutnya akan memberi warning:
  "Kolom field_name_external_id dilewati karena field field_name tidak ada".
  Solusi: buat patch khusus ir.model.fields untuk field relasi yang gagal.

E. Aturan ir.model.access / ACL
- Setiap custom model x_* yang akan diisi record wajib punya ACL sebelum sheet datanya diimport.
- Buat sheet ir.model.access setelah ir.model.fields dan sebelum data custom model.
- Minimal untuk internal user gunakan group base.group_user.
- Kolom yang disarankan:
  __action, _external_id, _model, name, model_id_external_id, group_id_external_id, perm_read, perm_write, perm_create, perm_unlink.
- Jika tidak ada ACL, Odoo akan menolak dengan error:
  "You are not allowed to create ... No group currently allows this operation."

F. Aturan data row dan external ID
- Semua record harus punya _external_id yang stabil dan unik.
- Gunakan namespace konsisten, contoh:
  lokalmart.koloni_pilangsari
  lokalmart.partner_sore_kitchen
  lokalmart.product_seblak_sore_kitchen
- Untuk upsert berulang, external ID tidak boleh berubah.
- External ID relasi harus sudah ada dari sheet sebelumnya atau import sebelumnya.
- Jangan membuat duplikat data dengan external ID baru kecuali memang ingin membuat record baru.

G. Aturan Many2one dan Many2many pada data sheet
- Many2one selalu pakai field teknis tanpa _id tambahan selain nama field aslinya, lalu tambah _external_id.
  Contoh:
  x_koloni_id -> x_koloni_id_external_id
  categ_id -> categ_id_external_id
  project_id -> project_id_external_id
- Many2many pakai _external_ids dan isi beberapa external ID dipisahkan koma.
- Jangan isi ID database numerik kecuali benar-benar diperlukan; utamakan external ID.

H. Aturan unsupported field / warning
- Jika log menyebut "Kolom X dilewati karena field tidak ada", hapus kolom itu dari sheet atau buat field-nya terlebih dahulu.
- product.category pada Odoo tertentu tidak punya field sequence; jika muncul warning, hapus kolom sequence dari product.category.
- Jangan memaksa kolom yang tidak ada karena memperlambat import dan membuat warning berulang.

I. Aturan website.page, ir.ui.view, dan QWeb
- website.page tidak boleh diimport sendirian bila belum ada view.
- Untuk membuat halaman website, urutan wajib:
  1. ir.ui.view
  2. website.page
  3. website.menu bila perlu
- ir.ui.view harus berisi arch_db dengan XML/QWeb valid.
- website.page harus mengarah ke view lewat view_id_external_id.
- Error "Missing view architecture" berarti website.page dibuat tanpa ir.ui.view/arch_db yang valid.
- QWeb patch sebaiknya dibuat file terpisah dari data produk/UMKM.
- Gunakan patch QWeb terpisah per kelompok halaman:
  - PATCH_QWEB_01_SCAN untuk /scan, /paspor-produk, /lokal-id.
  - PATCH_QWEB_02_MARKETING untuk /local-rewards, /umkm, /koloni.
  - PATCH_QWEB_03_PORTAL untuk /my/lokalmart dan halaman portal.
- Jika patch QWeb gagal, data utama tidak ikut terganggu.

J. Aturan XML/QWeb valid untuk Odoo
- HTML di QWeb harus valid sebagai XML.
- Boolean attribute HTML5 wajib ditulis lengkap:
  - disabled="disabled"
  - selected="selected"
  - checked="checked"
  - open="open"
  - readonly="readonly"
  - required="required"
- Jangan memakai boolean attribute mentah seperti disabled, checked, selected, open.
- JavaScript di dalam <script> harus dibungkus CDATA.
- Karakter khusus harus di-escape:
  - & menjadi &amp;
  - < di teks jangan mentah
  - > bila perlu dihindari pada teks sensitif
- Hindari hidden control character dari hasil copy-paste.
- Untuk QWeb yang kompleks, buat patch kecil dulu dan uji satu halaman sebelum banyak halaman.

K. Aturan patch XLSX
- Patch adalah workbook kecil untuk memperbaiki bagian tertentu tanpa mengimport ulang semua data utama.
- Patch relasi biasanya berisi:
  00_import_order
  ir.model
  ir.model.fields
  ir.model.access
  sheet data custom yang perlu diisi ulang relasinya
- Patch QWeb biasanya berisi:
  00_import_order
  ir.ui.view
  website.page
  website.menu
  VALIDATION
- Gunakan __action=upsert dan external ID yang sama agar patch memperbarui record lama, bukan membuat duplikat.
- Jangan import ulang file lama jika sudah ada patch yang lebih aman.

L. Aturan performa importer Vercel
- Kurangi warning karena warning banyak membuat proses import lambat.
- Hindari sheet besar campur dengan view/QWeb yang rawan error.
- Pecah import menjadi:
  1. Struktur/model/field
  2. ACL
  3. Master data
  4. Data relasional
  5. QWeb/view
  6. Foto/image queue
- Untuk timeout, importer sebaiknya memproses batch kecil dan resume, tetapi file XLSX tetap harus bersih dari kolom tidak valid.

M. Aturan foto dan image
- Untuk produk, gunakan image_url jika importer mendukung pengambilan gambar dari URL.
- Jika memakai queue, gunakan sheet photo_import_queue.
- Jangan memasukkan file gambar besar langsung ke XLSX jika importer tidak dirancang untuk itu.
- Pastikan _external_id produk tujuan ada sebelum photo_import_queue diproses.

N. Aturan validasi sebelum file diberikan
- Pastikan tidak ada row kosong.
- Pastikan semua sheet data punya __action, _external_id, _model.
- Pastikan semua custom field dan custom model memakai prefix x_.
- Pastikan semua many2one data memakai *_external_id.
- Pastikan semua relation model di ir.model.fields sudah ada.
- Pastikan semua required custom many2one tidak menyebabkan konflik ondelete.
- Pastikan semua custom model yang punya record sudah punya ACL.
- Pastikan website.page tidak ada di import utama kecuali ir.ui.view sudah tersedia.
- Pastikan tidak ada kolom yang sudah diketahui tidak ada di target model.
- Pastikan QWeb arch_db valid XML.
