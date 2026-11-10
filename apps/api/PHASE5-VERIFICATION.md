# Phase 5 — Hasil verifikasi aktual

Tanggal: 10 November 2026. Workspace `apps/api`. Backend saja. Tidak ada commit, push, deployment, Sales Order, frontend, microservice, atau layanan eksternal baru.

## Baseline independen

Repository, docs/architecture.md dan docs/phase4-crm.md diperiksa sebelum perubahan. Test Phase 4 tidak diasumsikan lulus berdasarkan laporan saja.

| Command | Files | Passed | Failed | Skipped |
| --- | ---: | ---: | ---: | ---: |
| npm test | 4 | 73 | 0 | 0 |
| npm run test:integration | 5 | 98 | 0 | 0 |
| npm run test:e2e | 1 | 10 | 0 | 0 |
| Total | 10 | 181 | 0 | 0 |

Eksekusi pertama dalam sandbox: unit 73 lulus; integration 9 failed/89 skipped karena PostgreSQL/socket EPERM dan empat suite gagal setup; e2e 10 failed karena listen EPERM. Command `npm run test:integration && npm run test:e2e` diulang dengan izin koneksi lokal dan memberikan baseline tabel di atas. Ini kegagalan lingkungan, bukan tes yang dihapus atau dibuat skip.

## Verifikasi akhir

Perintah dari direktori apps/api; build diselesaikan sebelum integration. Seluruh command berikut exit 0 pada hasil akhir:

| Command persis | Hasil akhir |
| --- | --- |
| `npx prisma format` | Schema diformat |
| `npx prisma validate` | Schema valid |
| `npm run db:deploy` | Migrasi 20261110140000_inventory diterapkan pada PostgreSQL development lokal |
| `npm run db:status` | Lima migrasi; database up to date |
| `npx prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --exit-code` | No difference detected |
| `npm run lint` | Tanpa warning/error |
| `npm run build` | Prisma generate 7.10.1 dan Nest build berhasil |
| `npm test` | 5 file, 88 passed, 0 failed, 0 skipped |
| `npm run test:integration` | 6 file, 145 passed, 0 failed, 0 skipped |
| `npm run test:e2e` | 1 file, 10 passed, 0 failed, 0 skipped |
| `git diff --check -- .` | Bersih |

**Total: 243 passed, 0 failed, 0 skipped, 12 file tes.** Baseline 181 tetap utuh. Tambahan 15 unit inventory dan 47 integration inventory. Tidak mengubah atau menghapus tes CRM/auth/catalog lama. Perbandingan ini adalah cakupan skenario dan jumlah tes; tidak mengklaim persentase line/branch coverage karena coverage instrumentation tidak dijalankan dan Phase 4 tidak menyediakan persentase pembanding.

Perintah verifikasi lokal dijalankan beberapa kali secara terpisah/berantai, termasuk `npm run db:deploy && npm run db:status && npm run test:integration` dan verifikasi akhir `npm run test:integration && npm run test:e2e`. PostgreSQL/HTTP tests memerlukan izin socket di luar sandbox. Database integration fondasi lama memakai public schema dan fixture rollback; lima suite lain termasuk inventory memakai schema acak krivent_test_* dan seluruh migrasi, kemudian hanya membersihkan schema tes. E2e fondasi memakai database double; HTTP inventory nyata tercakup integration, bukan diklaim sebagai database-backed e2e fondasi.

Format sumber baru dijalankan melalui `npx prettier --write 'src/inventory/*.ts' test/inventory.integration-spec.ts src/catalog/catalog.schemas.ts src/catalog/catalog.swagger.ts src/app.module.ts`, lalu formatter pada file yang berubah lagi. Build menghasilkan src/generated/prisma dan dist yang di-ignore. Tidak ada dependency baru atau perubahan lockfile.

## Kegagalan antara dan perbaikannya

- Fetch Nest markdown lewat web gagal unsupported content-type. `curl -fsSL https://docs.nestjs.com/reliability/idempotency.md` semula gagal DNS dalam sandbox, lalu berhasil dengan izin. Paket first-party dievaluasi sebelum memilih idempotensi ledger yang commit bersama transaksi bisnis.
- Build/lint pertama memberi dua warning comparator sort pada tes baru; comparator numerik ditambahkan, lint akhir bersih.
- Putaran integration pertama setelah implementasi: 119 passed/23 failed/0 skipped. Tujuh kegagalan fondasi karena public schema belum dimigrasikan; 16 inventory karena hasil advisory lock bertipe PostgreSQL void tidak dapat dideserialisasi Prisma. Query lock diperbaiki dengan cast text dan migrasi lokal diterapkan. Fixture receipt juga diperketat dengan expect(201) agar setup tidak menyembunyikan kegagalan.
- Putaran berikutnya: 140 passed/2 failed, seluruh 44 tes inventory saat itu lulus. Dua bootstrap test gagal saat build lain sedang meregenerasi dist yang dijalankan suite tersebut. Sesudah build selesai dan tiga tes tambahan ditambahkan, pengulangan berurutan memberikan 145/145 integration dan 10/10 e2e. Tidak mengubah bootstrap implementation/test untuk menyembunyikan kegagalan.

## Bukti integritas dan cakupan

- Receipt positif, snapshot delta/before/after/version/actor/timestamp, overflow integer, product tidak ada/arsip.
- Count absolut naik/turun/nol; count sama 409; versi stale termasuk ABA; negative count 400. Karena API adjustment memakai desired count, permintaan pengurangan melebihi saldo dinyatakan count negatif dan ditolak; tidak ada endpoint deduction/Sales yang diam-diam dibuat.
- Delapan receipt paralel tanpa lost increments; dua deduction lewat count dari versi sama menghasilkan satu 201/satu 409; receipt berurutan dengan archive.
- FK ledger gagal setelah update Product membatalkan saldo/versi; outer business transaction gagal juga membatalkan movement serta key. Tidak ada orphan entry.
- PostgreSQL CHECK menolak saldo/threshold negatif dan snapshot invalid. Deferred constraint trigger menolak update raw saldo tanpa kenaikan versi dan tanpa ledger yang tepat saat commit.
- Double submit paralel, replay setelah perubahan berikutnya/arsip, adjustment replay sebelum stale validation, scope actor, beda payload/produk/kind 409 dan key reusable setelah kegagalan.
- History read-only pada API; trigger PostgreSQL menolak update/delete. Tidak tersedia route edit/delete untuk Admin sekalipun.
- Admin/Warehouse read/write; Sales read-only; anonymous 401; body ketat menolak actor/quantity injection; invalid number, UUID, reason, key, date, pagination dan sort.
- History product/type/actor/date/search, ordering/page totals/empty pages; balance search/status/low-stock threshold; stockVersion/stockQuantity ditolak Products PATCH; harga/hash/key tidak bocor pada inventory.
- Swagger mempublikasikan mandatory header, strict body, expectedVersion, response snapshot dan filter actor. Seluruh regresi CRM/auth/catalog/bootstrap/fondasi tetap dijalankan.

## Migrasi dan keselamatan data

SQL aditif ditulis dan ditinjau sebelum `db:deploy`: dua kolom Product, lima kolom nullable ledger, CHECK, dua indeks unik nullable, indeks type/date/id dan trigger/fungsi. Tidak mengubah migrasi lama, tidak menjalankan migrate reset, db push, DROP data aplikasi, atau menulis ulang saldo lama. Pembersihan schema pengujian dilakukan helper existing dan hanya untuk schema UUID milik tes.

Stock lama tetap sebagai baseline versi 0. Ledger lama tidak diberi actor/snapshot palsu. Customer, session dan CRM tidak mendapat DDL/perubahan data. Tidak ada backfill saldo otomatis. Prisma diff membuktikan kolom/index yang didukung DSL sesuai; CHECK/trigger tidak direpresentasikan lengkap di DSL dan diuji melalui PostgreSQL nyata. Untuk deployment produksi kelak, audit baseline, backup, maintenance lock ALTER/CREATE INDEX, dan koordinasi writer lama diperlukan; tidak melakukan deployment produksi di pekerjaan ini.

## File berubah dan baru

Existing (6):

- README.md
- prisma/schema.prisma
- src/app.module.ts
- src/configure-app.ts
- src/catalog/catalog.schemas.ts
- src/catalog/catalog.swagger.ts

Baru (11):

- prisma/migrations/20261110140000_inventory/migration.sql
- src/inventory/inventory.module.ts
- src/inventory/inventory.controller.ts
- src/inventory/inventory.service.ts
- src/inventory/inventory.schemas.ts
- src/inventory/inventory.swagger.ts
- src/inventory/inventory.schemas.spec.ts
- test/inventory.integration-spec.ts
- docs/phase5-inventory.md
- docs/phase5-postman-guide.md
- PHASE5-VERIFICATION.md

## Batasan dan risiko tersisa

Tidak ada kegagalan pengujian tersisa. Hasil ini bukan load test atau bukti perilaku produksi.

- Legacy ledger belum direkonsiliasi; saldo saat migrasi adalah baseline, bukan jumlah histori yang diasumsikan cocok. Snapshot lama tetap null.
- Key permanen mencegah duplicate retry; key baru atau actor berbeda tetap dapat mencatat dokumen pemasok yang sama. Tidak ada purchase-order business uniqueness pada fase ini.
- Contention melebihi timeout koneksi/query/transaction dapat menghasilkan error generik; retry key sama aman. Tidak ada SLA throughput yang sudah dibuktikan.
- PostgreSQL owner/superuser dapat melepas trigger/DDL; raw Product INSERT dengan saldo awal nonzero berada di luar API katalog. Gunakan kredensial runtime terbatas dan service untuk semua writer bisnis.
- Actor ID dan reason tersedia bagi semua role inventory. Reason sebaiknya hanya memuat referensi operasional, bukan rahasia/PII. InventoryService dikecualikan dari instrumentasi method Observe seperti service sensitif existing; HTTP capture tetap false.
- Search substring, field-to-field low-stock filter dan offset pagination dapat membutuhkan optimasi setelah pengukuran. Tidak menambah trigram/Redis atau cursor tanpa kebutuhan terukur.
- Multi-warehouse, reservation, serial/batch, quarantine, Sales Order fulfillment dan rekonsiliasi baseline tetap future scope.

Desain dan keputusan concurrency dalam Bahasa Indonesia: docs/phase5-inventory.md. Alur contoh distributor elektronik: docs/phase5-postman-guide.md.
