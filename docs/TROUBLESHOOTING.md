# Troubleshooting

## Foto tidak berjalan

Penyebab umum:

- `product.template` belum berhasil created/updated.
- Sheet `photo_import_queue` tidak ada.
- `record_external_id` berisi external ID antrean foto, bukan external ID produk.
- URL foto tidak publik.

## Error Changing the type of a field is not yet supported

Artinya field custom sudah ada di Odoo dengan tipe berbeda. Solusi:

- Lewati field tersebut.
- Buat nama field baru, misalnya `x_lm_delivery_label`.
- Atau hapus field lama manual di Odoo Studio jika aman.

## External ID relasi tidak ditemukan

Pastikan record induk sudah diimport lebih dulu dan urutan `00_import_order` benar.


## Error boolean pada Mode Super Cepat

Error:

```text
AttributeError: 'bool' object has no attribute 'lower'
```

Penyebab:
Mode Super Cepat memakai `load()` Odoo. Converter boolean Odoo mengharapkan string seperti `TRUE` atau `FALSE`, tetapi menerima boolean JavaScript `true/false`.

Solusi di v1.0.1:
Importer Studio otomatis mengubah boolean JS menjadi teks `TRUE` / `FALSE` saat mode Super Cepat.

Aturan XLSX:
ChatGPT tetap harus menulis boolean sebagai teks `TRUE` / `FALSE`, terutama untuk kolom seperti `sale_ok`, `purchase_ok`, `website_published`, `required`, `readonly`, `store`, `index`, dan `copied`.
