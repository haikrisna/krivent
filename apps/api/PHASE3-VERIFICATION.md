# Verifikasi Phase 3 — 10 November 2026

## Hasil akhir yang benar-benar dieksekusi

Runtime Node 24.22.2, NestJS core/common 12.4.2, Prisma 7.10.1, PostgreSQL 17 Docker lokal, Vitest 4.1.12. Semua perintah dijalankan dari apps/api.

| Pemeriksaan                                                                                   | Hasil aktual                                                                                                                     |
| --------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| npm ls --depth=0                                                                              | Lolos; versi aktual diperiksa                                                                                                    |
| npm install @nestjs/authentication@0.1.5 @nestjs/throttler argon2                             | Lolos; 8 paket ditambahkan, audit instalasi melaporkan 0 vulnerabilities                                                         |
| docker compose ps                                                                             | PostgreSQL healthy, port loopback 5432                                                                                           |
| npm run db:deploy                                                                             | Lolos; menerapkan hanya 20261110060000_identity_sessions                                                                         |
| npm run db:status                                                                             | Lolos; 3 migrasi, database up to date                                                                                            |
| npx prisma format                                                                             | Lolos                                                                                                                            |
| npx prisma validate                                                                           | Lolos                                                                                                                            |
| npx prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --exit-code | Exit 0, No difference detected                                                                                                   |
| npm run lint                                                                                  | Lolos, tanpa warning pada pemeriksaan akhir                                                                                      |
| npm run build                                                                                 | Lolos; Prisma generate + Nest build                                                                                              |
| npm test                                                                                      | 3 file, 31 tes lolos                                                                                                             |
| npm run test:e2e                                                                              | 1 file, 10 tes lolos                                                                                                             |
| npm run test:integration                                                                      | 4 file, 81 tes lolos                                                                                                             |
| Smoke proses dist/main.js pada port loopback sementara                                        | Health 200, katalog anonim 401, Bearer OpenAPI ada, Cache-Control=no-store                                                       |
| Smoke startup AUTH_JWT_SECRET kosong                                                          | Ditolak, exit nonzero                                                                                                            |
| Query read-only metadata PostgreSQL                                                           | 3 migrasi selesai; normalized email index ada; empat CHECK bisnis lama yang diperiksa masih ada; 0 schema krivent_test_* tersisa |

**Total akhir: 122 tes lolos, tidak ada tes gagal/skip pada eksekusi akhir.** Build diperlukan sebelum integration suite karena tes bootstrap menjalankan dist/admin-bootstrap.js yang sama dengan operator. Smoke menonaktifkan Observe pada proses uji saja dan menghentikan proses itu setelah pemeriksaan; tidak mengubah key Observe .env atau deployment.

Dependensi tambahan langsung hanya @nestjs/authentication 0.1.5, @nestjs/throttler 6.7.1 dan argon2 0.45.2. Paket authentication/authorization first-party ditinjau terlebih dahulu. Tidak memasang Passport, JWT library lain, Redis atau microservice. Audit npm saat instalasi bukan klaim penetration test atau jaminan keamanan menyeluruh.

## Percobaan gagal dan perbaikannya

- Build awal gagal pada pelebaran tipe literal options Argon2 dan deep import SchemaObject yang tidak diekspor Swagger. Diperbaiki dengan opsi literal as const dan import publik @nestjs/swagger; build berikutnya lolos.
- Integrasi awal dalam sandbox gagal karena koneksi/socket localhost EPERM. Dijalankan ulang dengan izin akses lokal, tidak mengganti test menjadi mock.
- Suite keamanan awal gagal pada harness: storage throttler diregistrasi dengan getStorageToken(), bukan class token. Sesudah diperbaiki ditemukan reset map saja masih menyisakan histori hit. Harness kini memakai lifecycle reset storage penuh antar-skenario. Limiter aplikasi tetap aktif, dan tes 429 menjalankan guard/storage sebenarnya.
- npm view awal dalam sandbox tidak mendapat akses registry; inspeksi/instalasi paket dilakukan dengan izin jaringan. Instalasi memberi warning allowScripts untuk beberapa paket (termasuk Argon2); hashing native, build dan seluruh tes Argon2 benar-benar berhasil dieksekusi.

Tidak mengklaim percobaan gagal tersebut sebagai lolos. Hasil tabel adalah eksekusi akhir setelah perbaikan.

## Cakupan tes

31 unit test: validasi environment lama dan konfigurasi auth/expiry/secret, inheritance/override RolesGuard, pembedaan 401/403, hashing Argon2id, salt berbeda, password salah, dummy hash/legacy malformed, password dengan spasi tidak di-trim.

10 tes HTTP fondasi lama: health 200/503, prefix, Swagger, CORS, validasi schema/unknown fields. Kontrak Terminus dipertahankan oleh global filter.

81 tes integrasi:

- 9 database fondasi: tabel lama, exact Decimal round-trip, unique SKU, CHECK harga/stok, FK RESTRICT/composite FK; transaksi fixture rollback.
- 25 regresi katalog: create/update, duplicate/concurrent SKU, harga/input invalid, category missing/archived, pagination/filter/sort, archive behavior, race kategori dan produk, Swagger, stok tidak dapat diubah, persistensi melalui koneksi independen. Login Admin nyata menggantikan akses anonim Phase 2; boundary terakhir kini memeriksa 401 anonim dan Admin valid di luar development.
- 42 identity/security: login sukses, generic invalid/unknown/disabled, JWT malformed/tampered/expired/wrong issuer/audience/algorithm/no exp/future/unknown session, safe me, hash-only refresh persistence, rotation/replay/concurrent refresh, expired refresh/session, logout dan race logout-refresh, seluruh role matrix, Users create/list/detail/update/uniqueness, legacy normalized email, mass assignment/escalation, header/claim role tidak dipercaya, disable/reactivate, role/password change revocation, Admin terakhir/self-demotion/self-deactivation, dua Admin saling menonaktifkan, bootstrap idempotent, DTO invalid, real rate limit 429/Retry-After dan OpenAPI.
- 5 command bootstrap: proses CLI sungguhan membaca stdin, Admin Argon2id pertama, pengulangan tanpa overwrite, dua proses concurrent hanya satu Admin, email collision tidak mempromosikan non-Admin, existing disabled Admin tidak diaktifkan, input invalid tidak membuat akun atau mencetak password. Beberapa kondisi berada dalam satu test case.

Tes katalog/identity/bootstrap masing-masing membuat schema acak, menjalankan migrasi tersimpan dan membersihkan schema miliknya saja. Tidak ada truncate/reset/db push/drop database development, tidak menghapus user bisnis, dan tidak membuat Admin pada schema public saat verifikasi. Metadata read-only sesudah suite membuktikan 0 schema uji tertinggal.

## Daftar seluruh file sumber/dokumen berubah

| File                                                             | Perubahan                                                                |
| ---------------------------------------------------------------- | ------------------------------------------------------------------------ |
| package.json                                                     | Tiga dependency langsung dan command admin:bootstrap                     |
| package-lock.json                                                | Lock dependency yang terpasang                                           |
| .env.example                                                     | Konfigurasi auth tanpa nilai secret/password nyata                       |
| prisma/schema.prisma                                             | UserRole, User.role, AuthSession, RefreshToken, AdminBootstrap           |
| prisma/migrations/20261110060000_identity_sessions/migration.sql | Migrasi aditif, preflight collision dan expression unique email index    |
| src/app.module.ts                                                | Auth/Users module dan perlindungan telemetry credential                  |
| src/configure-app.ts                                             | Bearer Swagger, shared error filter, no-store headers                    |
| src/config/environment.ts                                        | Startup validation secret/issuer/audience/TTL/rate limit                 |
| src/config/environment.spec.ts                                   | Regresi konfigurasi dan kasus auth invalid                               |
| src/prisma/prisma.service.ts                                     | Menghormati schema URL pada adapter dan raw SQL search_path              |
| src/health/health.controller.ts                                  | Explicit @Public                                                         |
| src/auth/auth.module.ts                                          | First-party global authentication, rate limiter dan urutan RBAC          |
| src/auth/auth.controller.ts                                      | Login/refresh/logout/me                                                  |
| src/auth/auth.schemas.ts                                         | Strict login/opaque refresh DTO                                          |
| src/auth/auth.service.ts                                         | Argon2 verification, atomic family rotation/replay/logout                |
| src/auth/jwt.options.ts                                          | Satu sumber signing/verifying JWT config                                 |
| src/auth/jwt-auth.provider.ts                                    | JWT validation dan lookup user/session aktif                             |
| src/auth/roles.decorator.ts                                      | Metadata role reusable                                                   |
| src/auth/roles.guard.ts                                          | Authorization 401/403                                                    |
| src/auth/rbac.module.ts                                          | Guard global setelah authentication                                      |
| src/auth/roles.guard.spec.ts                                     | Role boundary dan override/inheritance                                   |
| src/users/users.module.ts                                        | Domain Users                                                             |
| src/users/users.controller.ts                                    | Me dan Admin management endpoints                                        |
| src/users/users.schemas.ts                                       | Normalisasi email, password policy, DTO strict dan pagination            |
| src/users/users.service.ts                                       | User writes, revoke session, lock Admin dan bootstrap                    |
| src/users/user.select.ts                                         | Explicit safe projection/presenter user                                  |
| src/users/identity.swagger.ts                                    | Request/response schemas, examples, status dan query                     |
| src/security/password.module.ts                                  | Provider hashing bersama                                                 |
| src/security/password.service.ts                                 | Argon2id dan dummy credential check                                      |
| src/security/password.service.spec.ts                            | Pengujian hashing nyata                                                  |
| src/common/api-error.filter.ts                                   | Error API generik, Prisma mapping, health compatibility                  |
| src/catalog/catalog-error.filter.ts                              | Compatibility re-export ke shared filter                                 |
| src/catalog/catalog.module.ts                                    | Lepas temporary local guard                                              |
| src/catalog/category.controller.ts                               | Bearer dan read/write/archive role checks                                |
| src/catalog/product.controller.ts                                | Bearer dan read/write/archive role checks                                |
| src/catalog/catalog.swagger.ts                                   | Authentication/permission docs dan 401/403                               |
| src/catalog/local-development.guard.ts                           | Dihapus; diganti authentication/RBAC                                     |
| src/catalog/local-development.guard.spec.ts                      | Dihapus; diganti tes role boundary dan HTTP auth                         |
| src/admin-bootstrap.ts                                           | CLI stdin tanpa default credential atau output secret                    |
| test/setup.ts                                                    | Ephemeral test-only JWT secret, bukan fallback aplikasi                  |
| test/support/isolated-database.ts                                | Schema uji acak dan migrasi/cleanup terarah                              |
| test/catalog.integration-spec.ts                                 | Pertahankan kasus bisnis, tambah login Admin nyata dan schema isolation  |
| test/auth.integration-spec.ts                                    | Security/Users/RBAC/replay/concurrency tests                             |
| test/bootstrap.integration-spec.ts                               | Jalankan command bootstrap sebagai child process nyata                   |
| vitest.config.ts                                                 | Setup env test                                                           |
| vitest.config.e2e.ts                                             | Setup env test                                                           |
| vitest.config.integration.ts                                     | Setup env test                                                           |
| README.md                                                        | Status, setup dan navigasi Phase 3                                       |
| docs/business-requirements.md                                    | Tandai baseline Phase 2 dan tautan matriks terkini                       |
| docs/architecture.md                                             | Tandai baseline Phase 2 dan tautan arsitektur identity                   |
| docs/phase2-manual-testing.md                                    | Contoh katalog kini memakai Bearer Admin                                 |
| docs/phase3-authentication.md                                    | Audit, ERD, matriks, lifecycle, mentoring, tradeoff dan browser security |
| docs/phase3-postman-guide.md                                     | Setup/bootstrap dan skenario Postman/curl/manual                         |
| PHASE3-VERIFICATION.md                                           | Laporan hasil dan manifest ini                                           |

.env lokal (ignored Git) dilengkapi JWT secret acak jika sebelumnya belum ada; nilai tidak dicetak atau dimasukkan .env.example. Generated client, dist dan tsbuildinfo diperbarui sebagai artefak ignored. Dua migrasi lama, CatalogService/schema bisnis, Compose, health service, test/app.e2e-spec.ts dan test/database.integration-spec.ts dipertahankan. Tidak melakukan push, deploy, commit, frontend, CRM, Inventory, Sales atau dashboard.

## Batas dan manual verification tersisa

- Belum menjalankan Postman UI, helper input interaktif Python, browser Next.js, atau restart container untuk memverifikasi volume. Pengujian otomatis menjalankan HTTP dan CLI, sementara smoke menjalankan AppModule hasil build.
- Ekspor Observe nyata tidak diuji; konfigurasi capture/redaction dilindungi dan smoke menonaktifkan Observe pada proses uji saja. Tidak ada credential yang sengaja dicetak.
- Limiter in-memory per proses; shared limiter/proxy/BFF rate strategy perlu keputusan sebelum multi-instance/deployment. Tidak menambahkan Redis.
- Strict refresh replay mencabut family bahkan untuk dua refresh sah bersamaan: frontend harus single-flight. Tidak ada grace window.
- Session/token expired belum dibersihkan oleh job otomatis. Used hash harus disimpan sampai absolute family expiry untuk mendeteksi replay.
- Belum MFA, forgot-password/reset, email verification, audit log persisten, breach-password screening, atau UI. Ini batas fase, bukan fitur yang diklaim selesai.
- Tidak membuat akun Admin development dengan password buatan agent; operator menyiapkan credential sendiri melalui command bootstrap. Data lama tidak otomatis mendapat Admin dan hash non-Argon2id lama perlu penggantian password terkontrol.

Panduan manual lengkap dan checklist: docs/phase3-postman-guide.md. Jalankan build, bootstrap menggunakan input sendiri, start:dev, login, uji /me, matriks role, refresh/replay dan logout. Pekerjaan berhenti pada Phase 3.
