# Verifikasi Phase 2 — 10 November 2026

## Hasil yang benar-benar dijalankan

Lingkungan: Node 24.22.2, NestJS 12.4.2, Prisma 7.10.1, PostgreSQL 17 Docker lokal (healthy), Vitest 4.1.12. Perintah dari apps/api.

| Pemeriksaan                                                                                   | Hasil akhir                                              |
| --------------------------------------------------------------------------------------------- | -------------------------------------------------------- |
| npm ls --depth=0                                                                              | Lolos; versi aktual diperiksa, tidak menambah dependensi |
| docker compose ps                                                                             | PostgreSQL healthy, bind 127.0.0.1:5432                  |
| npm run db:deploy                                                                             | Lolos; hanya menerapkan 20261110040000_category_active   |
| npm run db:status                                                                             | Lolos; 2 migrasi, database up to date                    |
| npx prisma validate                                                                           | Lolos                                                    |
| npx prisma format                                                                             | Lolos                                                    |
| npx prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --exit-code | Exit 0, No difference detected                           |
| npm run lint                                                                                  | Lolos, tanpa warning pada pemeriksaan akhir              |
| npm run build                                                                                 | Lolos; prisma generate dan nest build                    |
| npm test                                                                                      | 2 file, 19 tes lolos (environment + guard lokal)         |
| npm run test:e2e                                                                              | 1 file, 10 tes lolos                                     |
| npm run test:integration                                                                      | 2 file, 34 tes lolos; koneksi PostgreSQL nyata           |

Total akhir: **63 tes lolos**. Pemeriksaan drift Prisma tidak menggantikan pemeriksaan CHECK SQL yang tidak direpresentasikan DSL; tes integrasi lama tetap memverifikasi constraint harga/stok dan FK.

Percobaan awal npm run db:status gagal P1001 karena sandbox memblokir koneksi localhost; setelah izin akses lokal, status database terbaca. Tes HTTP awal gagal EPERM saat listen; eksekusi ulang dengan izin socket lolos. Docker ps juga awalnya ditolak sandbox dan berhasil setelah izin. Fetch dokumentasi awal gagal DNS dalam sandbox; retry berizin berhasil. Tidak ada kegagalan aplikasi yang disembunyikan sebagai hasil lolos.

Lint awal memberi satu warning pembanding Array.sort pada test; diperbaiki dan lint akhir bersih. Prettier awal tidak mengenali schema.prisma; TypeScript tetap diformat, schema akhirnya diformat dengan prisma format. Semua perintah build/test akhir di atas benar-benar dieksekusi; tidak hanya disarankan.

## Cakupan pengujian

- Create produk valid, uppercase SKU, stok awal nol, string uang dengan dua desimal.
- Harga presisi tinggi 1234567890123456.99 tersimpan dan dibaca lewat koneksi Prisma independen.
- Duplicate SKU concurrent create dan duplicate SKU update menghasilkan 409.
- Harga negatif/number/lebih dari dua pecahan/overflow/eksponen/newline/leading zero/null ditolak 400.
- Required field, whitespace, batas panjang nama, UUID salah, properti asing, stockQuantity/isActive/permissions ditolak 400.
- Kategori/produk tidak ditemukan 404; kategori arsip 409; partial update kosong ditolak.
- Update nama/harga/kategori tersimpan dan tidak mengubah saldo.
- Search case-insensitive, filter kategori/rentang harga, sorting, pagination dan total; allowlist query, halaman kosong.
- Archive idempotent, update arsip 409, SKU tetap unik, default list mengecualikan arsip dan detail tetap tersedia.
- Archive kategori dengan produk aktif 409; arsip kategori tidak memutus relasi produk arsip.
- Race category archive vs product create menghasilkan keadaan konsisten: tidak ada produk aktif di kategori arsip.
- Validasi/duplikasi/update/detail/list/archive kategori.
- Hard-delete route tidak ada, record tetap tersimpan.
- Swagger memuat request harga string dan response stok readOnly.
- Mode production menolak katalog 403; unit test memeriksa loopback IPv4/IPv6, peer remote, forwarded header palsu dan mode tidak dikenal.
- Tes fondasi lama: health 200/503, prefix, CORS, Swagger, validation pipe, CHECK database dan FK RESTRICT/composite FK.

Fixture katalog memiliki UUID/nama unik dan dibersihkan hanya berdasarkan ID kategori milik suite. Tidak ada truncate, reset, db push atau penghapusan data bisnis. Migrasi awal tidak diedit; migrasi baru hanya ADD COLUMN categories.is_active NOT NULL DEFAULT true.

## Semua file sumber/dokumen yang ditambah atau diubah

| File                                                           | Perubahan dan alasan                                                            |
| -------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| README.md                                                      | Status Phase 2, navigasi dokumen, batas keamanan lokal, struktur dan aturan SKU |
| docs/business-requirements.md                                  | Aktor, use case, lifecycle lead/order, ownership, invariants stok, batas MVP    |
| docs/architecture.md                                           | Audit aktual, ERD eksisting/target, batas modul dan alasan keputusan teknis     |
| docs/phase2-manual-testing.md                                  | Curl berurutan yang dapat diimpor Postman, contoh respons, checklist manual     |
| PHASE2-VERIFICATION.md                                         | Hasil aktual, batas verifikasi dan manifest file ini                            |
| prisma/schema.prisma                                           | Category.isActive, default true                                                 |
| prisma/migrations/20261110040000_category_active/migration.sql | Migrasi aditif tanpa menulis ulang model lama                                   |
| src/app.module.ts                                              | Registrasi CatalogModule                                                        |
| src/configure-app.ts                                           | Deskripsi Swagger Phase 2; kontrak health dipertahankan                         |
| src/catalog/catalog.module.ts                                  | Komposisi controller/service/guard dan PrismaModule                             |
| src/catalog/catalog.schemas.ts                                 | DTO schema Zod, tipe inferred, strict input, uang, query dan batas pagination   |
| src/catalog/catalog.service.ts                                 | Aturan bisnis, arsip, transaksi serializable/retry dan list snapshot            |
| src/catalog/category.controller.ts                             | Kontrak HTTP kategori                                                           |
| src/catalog/product.controller.ts                              | Kontrak HTTP produk dan presenter harga toFixed(2)                              |
| src/catalog/catalog.swagger.ts                                 | Request/response schema, contoh, query dan status HTTP                          |
| src/catalog/catalog-error.filter.ts                            | Error katalog seragam dan penyamaran detail Prisma                              |
| src/catalog/local-development.guard.ts                         | Pembatasan development + peer socket loopback                                   |
| src/catalog/local-development.guard.spec.ts                    | Pengujian batas akses lokal dan spoofing header                                 |
| test/catalog.integration-spec.ts                               | HTTP nyata, persistensi, validasi, konflik, arsip dan konkurensi                |

Generated Prisma client, dist dan tsbuildinfo diperbarui oleh generate/build sebagai artefak lokal yang sudah diabaikan Git. package.json/package-lock, konfigurasi Compose, .env, migrasi awal, modul health dan tes lama tidak diubah. Tidak melakukan commit/push/deploy/frontend.

## Batas dan pekerjaan manual tersisa

Contoh curl disediakan namun tidak dieksekusi sebagai sesi manual terpisah; pengujian otomatis mengakses route yang sama. Restart API/container dan pemeriksaan visual Swagger/Postman belum dilakukan. Persistensi dibuktikan dengan commit lalu read dari koneksi independen, bukan klaim restart volume. Tidak menjalankan test coverage atau load test.

Authentication/RBAC tetap fase berikutnya. Seluruh endpoint katalog sementara tidak memakai login, hanya local-development guard; respons lokal mencakup costPrice. Jangan expose lewat proxy/tunnel. Constraint SKU lama tetap case-sensitive, input baru uppercase; normalisasi data legacy membutuhkan audit benturan sebelum migrasi selanjutnya. Arsip terminal tanpa restore pada API Phase 2. Saldo stok tidak dimodifikasi katalog. CRM/Sales/Inventory/reporting/audit hanya desain, belum API bisnis.

Checklist manual lengkap: docs/phase2-manual-testing.md. Pekerjaan berhenti pada Phase 2.
