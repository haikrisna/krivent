# Phase 6 — Hasil verifikasi aktual

Tanggal eksekusi: 11 November 2026. Backend saja. Tidak melakukan commit, push, deployment, reset atau destructive db push.

## Hasil akhir

| Perintah | Hasil |
| --- | --- |
| `npx prisma format` | Berhasil |
| `npx prisma validate` | Schema valid |
| `npm run db:deploy` | Migrasi aditif 20261111090000_sales_orders diterapkan ke PostgreSQL lokal |
| `npm run db:status` | Enam migrasi, database up to date |
| `npx prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --exit-code` | No difference detected, exit 0 |
| `npm run build` | Prisma generate 7.10.1 dan Nest build berhasil, exit 0 |
| `npm run lint` | Tanpa error/warning, exit 0 |
| `npm test` | 6 file, 98 passed, 0 failed, 0 skipped |
| `npm run test:integration` | 7 file, 159 passed, 0 failed, 0 skipped |
| `npm run test:e2e` | 1 file, 10 passed, 0 failed, 0 skipped |
| `git diff --check` | Exit 0 |

**Total 267 passed, 0 failed, 0 skipped (14 file tes).** Seluruh suite Phase 1–5 dipertahankan. Dibanding laporan Phase 5: tambahan 10 unit dan 14 integration. Ini hasil seluruh suite pada kode akhir, bukan klaim line/branch coverage atau load testing. E2e fondasi tetap memakai database double; HTTP sales-orders diuji dengan PostgreSQL nyata dalam integration.

## Cakupan Phase 6

- Minimal order dan quantity positif integer, duplicate/empty items, injeksi total/unitPrice, patch terbatas, reason cancellation, query range/pagination.
- HTTP create, harga snapshot dari database, total Decimal server, perubahan harga katalog tidak mengubah order.
- Lifecycle DRAFT → CONFIRMED → FULFILLED → COMPLETED. Confirm tanpa deduction; fulfillment dengan ledger SALE negatif, saleItem reference, before/after/version; complete tanpa deduction.
- Pembatalan DRAFT dan CONFIRMED tanpa restock. Edit setelah konfirmasi, transisi salah dan cancel setelah fulfillment ditolak.
- Paralel fulfillment satu order/key sama memberikan respons sama, satu ledger. Key baru setelah fulfillment ditolak. Dua request satu order dengan key/actor berbeda diserialkan.
- Dua order bersaing atas stok 3, masing-masing quantity 2: satu 200, satu 409, saldo akhir 1.
- Order dua produk: item pertama dikurangi lalu item kedua kurang; transaksi rollback saldo pertama, seluruh SALE ledger, status dan receipt. Setelah replenishment, key sama dapat berhasil.
- Customer/Product archived ditolak pada create; product archived menolak confirm; customer archived menolak fulfillment tanpa mengonsumsi key.
- Sales customer milik orang lain 404, list tidak membocorkan jumlah/data. Warehouse tidak dapat create/confirm; sales tidak dapat fulfill. Anonymous list/create 401 dan guard global tetap aktif.
- Warehouse hanya mendapat operational projection. Replay fulfillment sesudah role admin berubah warehouse tidak mengembalikan harga. Create replay setelah ownership berpindah ditolak.
- Create paralel/key sama menghasilkan satu hasil; payload berbeda/key sama 409. Fulfillment retry setelah completion mengembalikan hasil sukses awal.
- Filter customer/status/date dan pagination menghasilkan reporting data; Swagger route fulfillment dan response 200 tersedia.

## Kegagalan sementara dan perbaikan

Build awal menemukan kurung penutup kurang dalam helper Swagger; diperbaiki sebelum build akhir. Lint awal menemukan import InventoryService pada integration tidak dipakai; dihapus. Unit tetap 98 lulus. Eksekusi migration/status/diff dalam sandbox awal gagal P1001 localhost:5432; diulang dengan izin akses socket lokal dan berhasil. Tidak mengubah kredensial atau menampilkan .env.

Integration pertama 154/154 dan e2e 10/10 lulus. Setelah menambah lima skenario keamanan/concurrency, build/lint/unit/Prisma validation dijalankan ulang, disusul integration 159/159, e2e 10/10 serta status/drift akhir. Tidak menjalankan build bersamaan dengan integration bootstrap yang memakai dist.

## Migrasi dan keamanan data

SQL dibaca/ditinjau sebelum deploy: menambahkan nilai enum CONFIRMED/FULFILLED; lima kolom nullable Sale; tabel order_receipts dan FK/index; partial unique index SALE per saleItemId. Tidak mengubah migrasi Phase 1–5 atau mengarang timestamp/snapshot data legacy. Tidak ada DROP database, reset atau penghapusan data aplikasi. Integration menggunakan helper existing yang membuat schema acak khusus tes, menjalankan seluruh migrasi dan membersihkan hanya schema tes tersebut.

FK, CHECK, immutable ledger dan deferred stock triggers Phase 5 tetap aktif dan tercakup regresi inventory. Prisma diff memeriksa bagian yang dapat direpresentasikan DSL; partial index dan trigger bukan bukti yang disediakan drift check. Keamanan fulfillment juga bergantung pada row lock order, lock produk terurut, status check setelah lock dan transaksi ReadCommitted, bukan hanya indeks.

## File berubah / baru

Existing berubah:

- README.md
- prisma/schema.prisma
- src/app.module.ts
- src/configure-app.ts
- src/inventory/inventory.service.ts

Baru (termasuk rancangan awal yang belum tracked):

- prisma/migrations/20261111090000_sales_orders/migration.sql
- src/sales-orders/sales-orders.module.ts
- src/sales-orders/sales-orders.controller.ts
- src/sales-orders/sales-orders.service.ts
- src/sales-orders/sales-orders.schemas.ts
- src/sales-orders/sales-orders.swagger.ts
- src/sales-orders/sales-orders.schemas.spec.ts
- test/sales-orders.integration-spec.ts
- docs/phase6-sales-orders.md
- docs/phase6-postman-guide.md
- PHASE6-VERIFICATION.md

## Batas dan risiko

Tidak ada kegagalan verifikasi tersisa. Tidak mengklaim verifikasi produksi, beban besar, coverage persentase, atau restore backup. Timeout/lock contention panjang bisa menghasilkan error generik; retry create/fulfill dengan key sama aman. Tidak ada reservasi dan konfirmasi bukan jaminan stok.

Migrasi partial unique SALE akan gagal bila database target memiliki duplikasi legacy; audit/reconcile sebelum rollout, jangan menghapus immutable ledger. Sale legacy tanpa customer/item tetap bisa dibaca Admin tetapi tidak dapat dikonfirmasi/fulfilled melalui jalur baru. Harga unit dan item tidak dapat diubah melalui API, termasuk draft; koreksi item memakai cancel/create baru. Customer nullable dipertahankan untuk data lama.

Database owner/superuser dapat memodifikasi order/item/receipt atau melepas trigger: gunakan role runtime terbatas dan jalur service. Tidak ada trigger baru yang mengunci seluruh riwayat state order terhadap raw SQL. Receipt tidak diberi TTL dan dapat tumbuh; jangan membersihkannya tanpa kebijakan deduplikasi baru. Offset pagination antar-request dapat bergeser. Nomor SO UUID bukan nomor faktur pajak. Belum ada retur, pembayaran, pengiriman, reservasi, multiwarehouse atau frontend.
