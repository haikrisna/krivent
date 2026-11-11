# Phase 6 — Panduan Postman

Gunakan `baseUrl=http://localhost:3000/api/v1`, Bearer access token dari login Phase 3. Pilih customer aktif milik sales yang login dan product aktif dari katalog. Jangan mengirim harga, total, actor, timestamp atau status pada create.

1. Admin/Warehouse mencatat receipt inventory seperti Phase 5, misalnya 10 unit router. Simpan productId.
2. Sales/Admin `POST {{baseUrl}}/sales-orders`, header `Idempotency-Key: order-create-001`, body:

```json
{"customerId":"<UUID customer>","notes":"Referensi PO pelanggan 001","items":[{"productId":"<UUID router>","quantity":2}]}
```

Respons 201 berisi `data.id`, `invoiceNumber`, `status=DRAFT`, total server dan snapshot unitPrice string. Simpan orderId. Ulangi body/key sama: respons asli dan tidak ada order baru. Body berbeda/key sama: 409. Gunakan key baru untuk pesanan bisnis baru.

3. Sales `PATCH {{baseUrl}}/sales-orders/{{orderId}}` dengan `{"notes":"Referensi PO pelanggan 002"}` → 200. Customer/items tidak dapat diubah. Salah item: cancel draft lalu buat baru.
4. Sales `POST .../{{orderId}}/confirm`, body `{}` → 200 CONFIRMED. Saldo inventory belum berubah. PATCH sesudah ini → 409.
5. Warehouse/Admin `POST .../{{orderId}}/fulfill`, body `{}`, header `Idempotency-Key: order-fulfill-001` → 200 FULFILLED. Saldo berkurang 2; ledger SALE terkait item mencatat quantity -2 dan snapshot before/after/version. Simpan key untuk retry jika timeout. Ulangi key sama → respons asli; key baru pada order fulfilled → 409. Warehouse menerima data operasional tanpa harga/customer/notes.
6. Sales/Admin `POST .../{{orderId}}/complete`, body `{}` → 200 COMPLETED, tanpa perubahan stok.
7. Untuk pembatalan, buat order baru DRAFT atau CONFIRMED lalu `POST .../{{orderId}}/cancel` dengan `{"reason":"Pelanggan membatalkan PO"}` → 200 CANCELLED tanpa ledger/restock. Pembatalan FULFILLED/COMPLETED → 409; retur belum tersedia.

List: `GET {{baseUrl}}/sales-orders?status=CONFIRMED&page=1&pageSize=20&sortBy=createdAt&direction=desc&from=2026-01-01T00:00:00Z&to=2027-01-01T00:00:00Z`. Opsional customerId dan search nomor order. Respons `{data:[],meta:{page,pageSize,total,totalPages}}`. Detail `GET .../{{orderId}}`. Sales lain mendapat 404 dan list tidak memuat order tersebut. Warehouse hanya melihat CONFIRMED/FULFILLED/COMPLETED.

Uji negatif: tanpa token 401, warehouse create 403, sales fulfill 403, quantity nol/pecahan dan harga client 400, customer/product archived 409. Konfirmasi dua order masing-masing quantity 4 dengan saldo 5: fulfillment satu sukses, satu 409; saldo akhir 1. Order gagal tetap CONFIRMED dan bisa dicoba lagi dengan key sama setelah receipt replenishment. Tidak ada reservasi.

Swagger di `/api/docs`. Semua request memakai Content-Type application/json. Jangan mencatat password/token pada notes bisnis.
