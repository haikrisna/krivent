# Phase 5 — Panduan Postman Inventory

Gunakan database development dan API `http://localhost:4000/api/v1`. Migrasikan dengan `npm run db:deploy`, build, lalu jalankan server. Buat Admin sesuai panduan Phase 3, kemudian user WAREHOUSE_STAFF dan SALES_STAFF melalui Admin. Login masing-masing dan simpan access token dalam environment Postman lokal; jangan export token/password.

Variabel: baseUrl, adminToken, warehouseToken, salesToken, productId, movementId, stockVersion, receiptKey, adjustmentKey. Gunakan Bearer Token pada request. Key dapat berupa UUID baru (`{{$guid}}`), tetapi simpan nilai sekali sebelum submission agar retry memakai key identik.

1. Admin/Warehouse membuat kategori Electronics dan produk `RTR-AX3000`, nama Router AX3000, costPrice `850000.00`, sellingPrice `1100000.00`, lowStockThreshold 10. Simpan ID. Stock tidak boleh dimasukkan ke Products POST/PATCH.
2. Warehouse menerima 24 router dari pemasok: POST `{{baseUrl}}/inventory/receipts`, header `Idempotency-Key: receipt-PO-2026-001` dan JSON:

```json
{
  "productId": "{{productId}}",
  "quantity": 24,
  "reason": "Terima 24 router AX3000, PO-2026-001, surat jalan SJ-001"
}
```

Harapkan 201, `{data:{id,productId,createdById,type:"PURCHASE",quantity:24,notes:...,beforeBalance:0,afterBalance:24,stockVersion:1,createdAt:...}}`. Simpan movementId dan versi. Kirim ulang persis: 201 dengan ID/result sama, saldo tetap 24. Ubah quantity menjadi 25 memakai key sama: 409. Key baru berarti penerimaan baru.

3. Sales membaca GET `/inventory/balances?productId={{productId}}`: saldo 24, stockVersion 1. Harga tidak disertakan. Sales POST receipt atau adjustment: 403. Tanpa token pada seluruh route: 401.
4. Stock opname menemukan 22 unit layak jual, dua rusak dipisahkan. Warehouse POST `/inventory/adjustments`, header `Idempotency-Key: opname-2026-11-001`:

```json
{
  "productId": "{{productId}}",
  "countedQuantity": 22,
  "expectedVersion": 1,
  "reason": "Stock opname: dua router rusak dipisahkan dari stok jual"
}
```

Harapkan 201, ADJUSTMENT, quantity -2, beforeBalance 24, afterBalance 22, stockVersion 2. Count absolut, bukan jumlah barang yang dikurangi. Replay key sama menghasilkan movement asli. Key baru dengan expectedVersion 1: 409. Baca ulang dan periksa count sebelum mencoba versi baru. Count negatif/fraction/string, reason kosong, actorId buatan: 400. Count sama dengan saldo: 409 tanpa jurnal. Count nol dengan versi terbaru diperbolehkan.

5. Histori: GET `/inventory/movements?productId={{productId}}&type=ADJUSTMENT&sortBy=createdAt&direction=desc&page=1&pageSize=20`. Tambahkan `actorId`, `search=rusak`, `from=2026-11-01T00:00:00Z`, `to=2026-11-30T23:59:59Z`. Gunakan Postman Params agar timezone/plus di-encode. GET `/inventory/movements/{{movementId}}` mengambil satu record. PATCH/DELETE URL tersebut 404; koreksi dilakukan adjustment baru, bukan mengedit jurnal.
6. Low stock: ubah threshold produk menjadi 25 lewat Products PATCH. GET `/inventory/balances?lowStock=true&productId={{productId}}` menampilkan produk saldo 22. Threshold default 0 hanya melaporkan produk habis. Archive produk sebagai Admin; receipt/adjustment baru 409, history tetap tersedia; balances default menyembunyikan arsip, `status=all` menampilkannya.
7. Race manual: baca versi terbaru, kirim dua adjustment berbeda dengan expectedVersion sama dan dua key baru melalui dua tab bersamaan. Tepat satu 201 dan satu 409. Kirim dua receipt dengan key sama bersamaan: keduanya 201 dengan movement ID sama. Dua receipt dengan key berbeda adalah dua penerimaan dan menambah saldo dua kali.

Snippet Postman Tests untuk receipt/replay (set expectedAfter sesuai skenario):

```javascript
pm.test('Created', () => pm.response.to.have.status(201));
const movement = pm.response.json().data;
pm.test('Delta consistent', () => pm.expect(movement.afterBalance).to.eql(movement.beforeBalance + movement.quantity));
pm.environment.set('movementId', movement.id);
pm.environment.set('stockVersion', movement.stockVersion);
```

Jika request timeout, retry memakai key dan payload asli. Jangan membuat key baru sampai hasil usaha awal diketahui. API memakai 400/401/403/404/409 dan error generik 500; tidak ada error yang mengembalikan SQL, hash request, password, atau token. Lihat `/api/docs` untuk kontrak lengkap dan [desain](phase5-inventory.md) untuk batasan baseline legacy, transaksi, dan fulfillment masa depan.
