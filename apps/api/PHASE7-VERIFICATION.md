# Phase 7 — Verifikasi aktual

Eksekusi 11 November 2026 pada repository lokal `apps/api`. Backend saja, berhenti pada Phase 7. Tidak commit, push, deploy aplikasi, reset, destructive db push, atau mengubah data bisnis existing melalui migrasi. Migrasi database lokal aditif diterapkan setelah SQL ditinjau.

## Baseline yang diverifikasi ulang

- `npm test`: 6 file, **98 passed, 0 failed, 0 skipped**.
- `npm run test:integration`: 7 file, **159 passed, 0 failed, 0 skipped**, PostgreSQL nyata.
- `npm run test:e2e`: 1 file, **10 passed, 0 failed, 0 skipped**, fondasi memakai database double.

Angka Phase 6 267 terkonfirmasi untuk suite yang dipertahankan. Unit dan integrasi dijalankan sebelum implementasi; e2e pertama yang diizinkan berjalan setelah perubahan awal middleware/deskripsi Swagger, sehingga bukan bukti checkout pristine terpisah untuk e2e. Seluruh tes lama juga lulus pada kode akhir.

## Hasil akhir

| Perintah aktual | Hasil |
| --- | --- |
| `npx prisma format` | Sukses, schema diformat |
| `npx prisma validate` | Sukses, schema valid, exit 0 |
| `npm run db:deploy` | Sukses menerapkan `20261111100000_reporting_audit` ke PostgreSQL lokal; 7 migrasi |
| `npm run db:status` | 7 migrasi; database up to date, exit 0 |
| `npx prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --exit-code` | No difference detected, exit 0 |
| `npm run build` | Prisma Client 7.10.1 generate dan Nest build sukses, exit 0 |
| `npm run lint` | Sukses, tidak ada diagnostik, exit 0 |
| `npm test` | **7 file, 113 passed, 0 failed, 0 skipped**, exit 0 |
| `npm run test:integration` | **8 file, 197 passed, 0 failed, 0 skipped**, exit 0 |
| `npm run test:e2e` | **1 file, 10 passed, 0 failed, 0 skipped**, exit 0 |
| `git diff --check` | Exit 0 |

**Total akhir: 320 passed, 0 failed, 0 skipped dalam 16 file.** Tambahan Phase 7: 15 unit dan 38 integration. Seluruh suite Phase 1–6 tetap dijalankan; tidak menurunkan assertion atau menambah skip.

Build diselesaikan sebelum integration karena bootstrap suite menggunakan `dist/admin-bootstrap.js`. Unit/lint dan pembacaan status/drift independen dapat berjalan bersamaan. Integrasi memakai helper existing `isolatedDatabase`: schema PostgreSQL acak khusus suite, migrasi lengkap, cleanup hanya schema tes. Tes fondasi database menggunakan rollback pada koneksi lokal. Pengujian DELETE/TRUNCATE audit dilakukan pada schema tes dan ditolak trigger; tidak menghapus audit aplikasi.

## Cakupan bukti

Unit mencakup penolakan datetime ambigu/invalid, batas presisi milidetik, rentang sama/terbalik, offset ekuivalen, batas pagination, filter inventory kontradiktif, query asing, rank/action invalid, dan allowlist metadata yang membuang nested secrets, credentials, headers serta free text.

Integration Phase 7 melalui HTTP dan PostgreSQL membuktikan:

- Dataset kosong: nol realisasi, list kosong/meta nol, conversionRate `0.00`.
- DRAFT, CONFIRMED dan CANCELLED tidak masuk realisasi. FULFILLED/COMPLETED dihitung sekali; nilai `0.10 + 0.20 = 0.30`.
- Total `9007199254740993.01 + 0.09 = 9007199254740993.10` tetap tepat pada report dan dashboard.
- from inklusif, to eksklusif, milidetik sebelum batas, offset WIB ekuivalen dan bucket UTC; createdAt berbeda dari fulfilledAt.
- Ranking produk berdasarkan quantity/value, tie UUID stabil, halaman di luar akhir, harga snapshot tetap setelah katalog berubah, produk archived tetap masuk histori realisasi.
- Performance creator dan staffId, scope current customer ownership, larangan staffId orang lain. Reassignment customer menghapus seluruh agregat dari Sales lama.
- Cohort konversi berdasarkan linked customer, archived lead, WON tanpa customer, rate 50.00/33.33; active leads/customer dashboard terpisah.
- Semua tujuh endpoint anonymous 401; Warehouse ditolak lima report sales/CRM/audit; Sales ditolak inventory/audit; Warehouse dashboard hanya field inventory.
- HTTP date/pagination/query injection invalid 400; daftar recent CRM tidak membocorkan lead orang lain.
- Receipt replay hanya satu audit; physical count dengan delta negatif tercatat; saldo/low-stock/movement aggregate benar.
- Audit harga, arsip produk satu kali, role/status user, stage lead, conversion idempotent, confirm/fulfill/complete/cancel.
- `X-Request-ID` mutasi sama dengan audit.requestId; deskripsi/free text tidak masuk metadata. Redaksi token/password tambahan diverifikasi unit helper.
- Failed fulfillment multi-item dan transisi gagal tidak menulis audit sukses/SALE ledger. Audit yang sudah diinsert lalu transaksi gagal ikut rollback. Audit writer yang gagal membatalkan perubahan harga bisnis.
- Prisma UPDATE/DELETE dan SQL TRUNCATE audit ditolak trigger; baris tetap ada. API PATCH/DELETE audit tidak tersedia (404).
- Swagger memuat seluruh route/query; schema respons lengkap ditambahkan untuk dashboard/report/audit. Hasil pagination SQL JSON diberi ORDER BY eksplisit.

Ini bukan klaim coverage persentase atau hasil load test. E2e 10 tes tetap database double; 197 integration adalah suite PostgreSQL nyata, termasuk concurrency/constraint regresi inventory dan sales sebelumnya.

## Kegagalan sementara dan penyelesaian

1. Integration dalam sandbox pertama: **9 failed, 150 skipped** karena koneksi localhost PostgreSQL ditolak (`EPERM`). Enam suite gagal di beforeAll. Diulang dengan izin akses socket lokal; baseline 159/159 lulus. Tidak mengubah credential atau menampilkan `.env`.
2. E2e dalam sandbox pertama: **10 failed** karena listen HTTP localhost `EPERM`. Diulang dengan izin socket lokal; 10/10 lulus, termasuk run akhir.
3. Build awal Phase 7 gagal satu error TypeScript: tipe nilai metadata nullable tidak sesuai `InputJsonValue`. Diperbaiki menjadi map nilai JSON nullable yang sesuai Prisma. Build akhir lulus.
4. Run integration Phase 7 pertama: **194/194 lulus** (35 tambahan). Setelah pengetatan order JSON, schema Swagger, dan tiga skenario tambahan, run akhir **197/197 lulus**. Unit akhir 113/113 dan e2e 10/10.

Tidak ada kegagalan verifikasi tersisa. Perintah yang memerlukan jaringan/socket lokal dijalankan dengan eskalasi izin setelah sandbox menolak atau saat memakai akses PostgreSQL lokal yang sudah diketahui memerlukannya.

## Tinjauan migrasi dan file

SQL ditinjau sebelum deploy: CREATE tabel audit_logs; tiga indeks audit; dua indeks sales; function reject_audit_mutation; trigger UPDATE/DELETE dan TRUNCATE. Tidak ada backfill, DROP/ALTER data bisnis, perubahan enum atau migrasi lama. Actor/resource ID audit sengaja tanpa FK untuk referensi historis yang bertahan.

Prisma diff hanya membuktikan drift yang direpresentasikan DSL, tidak membuktikan function/trigger; tes imutabilitas memeriksa trigger nyata. Tidak mengedit migrasi setelah penerapan.

File baru: `src/reporting/` (module, controllers, service, schemas, schema tests, Swagger decorators dan response schemas), `src/audit/audit.ts`, `test/reporting.integration-spec.ts`, migrasi Phase 7, `docs/phase7-dashboard-reporting-audit.md`, `docs/phase7-postman-guide.md`, dan dokumen ini.

File existing berubah: Prisma schema; AppModule; configureApp (correlation ID/Swagger description); catalog product controller/service (actor/audit); users, CRM, inventory dan sales-orders service (audit dalam tx); README.

## Batas verifikasi dan risiko tersisa

- Tidak mengakses data produksi/Observe atau mengklaim perilaku produksi. Fitur baru diuji lokal, bukan diagnosis insiden produksi.
- Legacy COMPLETED tanpa fulfilledAt dikecualikan; tidak mengarang tanggal realisasi atau event audit historis.
- Performance memakai createdById, karena model belum punya assigned staff; ownership saat ini menentukan visibilitas histori. Conversion adalah creation cohort as of now.
- Tidak ada audit untuk raw SQL di luar service; database owner/superuser dapat melepas trigger. Runtime role terbatas dan backup harus dikelola saat deployment terpisah.
- Audit retention tanpa TTL; belum ada kebijakan arsip/purge formal. Tidak ada external tamper-proof storage/hash chain.
- Rentang agregasi tidak dibatasi jumlah hari; COUNT/SUM dan offset besar bisa mahal. Tidak melakukan EXPLAIN produksi/load test. Low-stock membandingkan dua kolom; tidak ada klaim indeks menghindari semua scan.
- Offset pagination antar-request bisa bergeser; count memakai integer PostgreSQL, batas sekitar 2,1 miliar. Monetary/quantity aggregates tetap string presisi.
- Panduan Postman ditulis; tidak mengklaim seluruh langkah Postman dijalankan manual. Tidak membuat frontend, commit, push, atau deployment aplikasi.
