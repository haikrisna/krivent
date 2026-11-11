# Phase 7 — Panduan Postman

Gunakan PostgreSQL lokal existing yang sudah dimigrasi: `npm run db:deploy`, `npm run build`, `npm run start:dev`. Jangan reset database. Base environment: `baseUrl=http://localhost:4000/api/v1`, `adminToken`, `salesToken`, `otherSalesToken`, `warehouseToken`, dan UUID fixture `productId`, `customerId`, `leadId`, `userId`, `orderId`. Login mengikuti panduan Phase 3, bukan credential default. Bearer Auth untuk request; jangan simpan token nyata ke source control.

## Dashboard dan report

1. `GET {{baseUrl}}/dashboard/summary?from=2026-10-01T00:00:00Z&to=2026-11-01T00:00:00Z` sebagai Admin. Respons `data` memuat activeCustomers, activeLeads, pipeline, ordersByStatus, realizedSales, lowStockProducts, recentActivity dan recentInventoryEvents. Sales tidak mendapat dua field inventory; Warehouse hanya mendapat dua field itu.
2. `GET {{baseUrl}}/reports/sales?from=2026-10-01T00:00:00Z&to=2026-11-01T00:00:00Z&page=1&pageSize=20`. Data per hari UTC: `{date:"2026-10-10",orderCount:2,realizedSales:"0.30"}` jika fixture sesuai. Nilai contoh bukan isi database bawaan.
3. `GET {{baseUrl}}/reports/top-products?rankBy=value&pageSize=10` atau rankBy=quantity. `{productId,sku,name,quantity:"3",value:"4500000.30"}`; hanya item order FULFILLED/COMPLETED dengan fulfilledAt valid. Harga terbaru katalog tidak mengubah value.
4. `GET {{baseUrl}}/reports/sales-performance?staffId={{userId}}&page=1&pageSize=20`. Admin dapat memfilter siapa pun; Sales hanya staffId sendiri dan scope customer sendiri. Atribusi adalah createdById, bukan assignment baru. `{staffId,name,orderCount,realizedSales}`.
5. `GET {{baseUrl}}/reports/lead-conversion?from=2026-10-01T00:00:00Z&to=2026-11-01T00:00:00Z`. Data stage/count dan summary leadCount, convertedCount, conversionRate persen string. Dua lead, satu linked customer → `"50.00"`; WON tanpa customer belum converted. Ini cohort createdAt, bukan waktu event konversi.
6. `GET {{baseUrl}}/reports/inventory?view=balances&lowStock=true&pageSize=20` sebagai Admin/Warehouse. Summary seluruh produk aktif (atau productId), data hanya low stock. `GET {{baseUrl}}/reports/inventory?view=movements&productId={{productId}}&type=PURCHASE&from=2026-10-01T00:00:00Z&to=2026-11-01T00:00:00Z` mengembalikan ledger dan agregat movement; saldo summary tetap keadaan sekarang.
7. `GET {{baseUrl}}/audit-logs?resourceType=SALE&resourceId={{orderId}}&pageSize=20` sebagai Admin. Tambahkan action=ORDER_FULFILLED atau actorId bila perlu. Hanya event setelah Phase 7 diterapkan yang tersedia.

Semua report list mempunyai meta page/pageSize/total/totalPages. Page di luar akhir mengembalikan data kosong. Tidak ada parameter sortBy bebas; lihat urutan/tie-breaking di [definisi report](phase7-dashboard-reporting-audit.md). Dashboard adalah objek tunggal tanpa meta.

Tanggal memakai `[from,to)`, to eksklusif. Untuk WIB isikan Params Postman: from `2026-10-01T00:00:00+07:00`, to `2026-11-01T00:00:00+07:00`; Postman harus URL-encode `+` menjadi `%2B`. Bucket laporan tetap UTC. Tanggal lokal tanpa offset atau `2026-10-01` saja 400. Tanpa tanggal berarti seluruh histori; sebaiknya pilih periode untuk data besar.

## Membuktikan realisasi dan audit

Buat fixture melalui API existing dengan role yang sesuai (panduan Phase 4–6). Tidak perlu SQL update data produksi.

1. Buat order baru DRAFT dengan customer milik Sales dan produk aktif. GET dashboard: orderedValue DRAFT bertambah, realizedSales belum bertambah.
2. Confirm: `POST {{baseUrl}}/sales-orders/{{orderId}}/confirm`, body `{}`. Audit ORDER_CONFIRM tersedia Admin; realizedSales belum berubah.
3. Pastikan stok cukup, kemudian fulfill dengan Admin/Warehouse: `POST .../fulfill`, header `Idempotency-Key` UUID baru, body `{}`. Audit ORDER_FULFILLED dan ledger SALE muncul. Realisasi masuk pada fulfilledAt.
4. Replay fulfillment dengan key sama: respons sukses sama, tidak ada event audit atau deduction ganda. Complete sebagai Sales owner: `POST .../complete`, body `{}`. Audit ORDER_COMPLETE muncul, realizedSales tetap satu kali.
5. Order DRAFT lain dapat dicancel dengan body `{"reason":"Customer cancellation"}`; audit ORDER_CANCEL muncul, nilai tidak direalisasikan.
6. Receipt: POST `/inventory/receipts` sebagai Warehouse, Idempotency-Key baru, body `{"productId":"{{productId}}","quantity":10,"reason":"Terima pembelian"}`. Audit INVENTORY_RECEIVED mereferensikan ID movement respons.
7. Adjustment: baca versi saldo, POST `/inventory/adjustments`, key baru, body `{"productId":"{{productId}}","countedQuantity":4,"expectedVersion":1,"reason":"Stock opname"}` (ganti versi aktual). Audit INVENTORY_ADJUSTED menyimpan delta dan saldo sebelum/sesudah.
8. PATCH `/products/{{productId}}` dengan `{"sellingPrice":"1500000.10"}` → PRODUCT_PRICE_CHANGED bila harga berubah. Admin POST `/products/{{productId}}/archive` → PRODUCT_ARCHIVED sekali. Jangan mengarsipkan fixture yang masih dibutuhkan untuk langkah sebelumnya.
9. PATCH `/users/{{userId}}/role` body `{"role":"WAREHOUSE_STAFF"}` dan `/status` body `{"isActive":false}` sebagai Admin; audit masing-masing muncul. Gunakan user fixture, bukan akun Admin terakhir/akun yang sedang dipakai.
10. Jalankan lead melalui CONTACTED→QUALIFIED→PROPOSAL→WON (`POST /leads/{{leadId}}/stage`, body `{"stage":"CONTACTED"}` dst), kemudian `/convert` body `{}`. Audit stage dan conversion tersedia; replay conversion tidak menggandakan audit.

Untuk rollback, siapkan order dua item dan salah satu tidak cukup stok. Confirm lalu fulfill → 409; tidak boleh ada ORDER_FULFILLED untuk order tersebut dan tidak boleh ada deduction parsial. Tes otomatis mencakup transaksi yang auditnya sudah ditulis lalu gagal, serta audit writer gagal sehingga perubahan bisnis rollback.

Response mutasi memuat `X-Request-ID` UUID server; cocokkan dengan audit.requestId. Metadata tidak menyimpan reason/notes/description atau token. Audit log tidak mencatat percobaan gagal sebagai sukses. Tidak ada endpoint edit/hapus audit; PATCH/DELETE `/audit-logs/:id` mengembalikan 404.

## Pengujian akses dan error

- Tanpa token, seluruh tujuh endpoint → 401.
- Warehouse ke sales/top-products/performance/lead-conversion/audit → 403.
- Sales ke reports/inventory atau audit → 403.
- Sales A dan B mempunyai customer/order/lead berbeda: masing-masing hanya melihat data dan agregat miliknya. Admin melihat keduanya. Perpindahan ownership mengubah visibilitas histori.
- Sales dengan staffId orang lain → 403; ownerId tidak didukung dan ditolak 400.
- page=0, pageSize=101, from>=to, tanggal invalid, unknown query → 400.
- from/to/type pada inventory balances, atau lowStock pada movements → 400.
- Dataset kosong: list [], total 0, totalPages 0; dashboard realized `"0.00"`, conversionRate `"0.00"`.

Contoh assertion Postman untuk list report:

```javascript
pm.test('OK dan paginated', function () {
  pm.response.to.have.status(200);
  const body = pm.response.json();
  pm.expect(body.data).to.be.an('array');
  pm.expect(body.meta.pageSize).to.be.at.most(100);
});
```

Swagger tersedia di `http://localhost:4000/api/docs`, dengan request query dan response schema. Hasil verifikasi otomatis ada di [PHASE7-VERIFICATION.md](../PHASE7-VERIFICATION.md); panduan ini bukan klaim bahwa seluruh langkah Postman telah dijalankan manual.
