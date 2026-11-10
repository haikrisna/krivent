# Hasil verifikasi Phase 1

Tanggal: 10 November 2026. Lingkungan: macOS ARM64, Node 24.22.2, npm 11.19.1,
Docker Engine 29.9.3, Compose 5.7.0. NestJS terpasang 12.4.2, TypeScript 6.0.3.
Prisma CLI/client/adapter-pg memakai rilis stabil 7.10.1, bukan tag latest yang menunjuk 8 RC.

| Pemeriksaan                                     | Hasil aktual                                                                    |
| ----------------------------------------------- | ------------------------------------------------------------------------------- |
| Inspeksi repository dan versi sebelum edit      | Selesai; starter ESM, Express, Vitest, Observe                                  |
| npm install                                     | Berhasil                                                                        |
| npm ci dari lockfile akhir                      | Berhasil, 445 paket terpasang                                                   |
| npm audit (melalui instalasi akhir)             | 0 vulnerabilities                                                               |
| docker compose up -d --wait                     | PostgreSQL 17 healthy, named volume krivent_postgres_data                       |
| prisma format / validate / generate             | Berhasil                                                                        |
| db:migrate                                      | 20261110031230_init berhasil diterapkan, termasuk CHECK constraints             |
| db:deploy                                       | Berhasil; tidak ada migrasi tertunda                                            |
| db:status                                       | Database schema is up to date                                                   |
| npm run lint                                    | Berhasil                                                                        |
| npm run build                                   | Berhasil, termasuk generate Prisma                                              |
| npm test                                        | 10/10 lulus                                                                     |
| npm run test:e2e                                | 10/10 lulus dengan database double                                              |
| npm run test:integration                        | 9/9 lulus terhadap PostgreSQL nyata                                             |
| Smoke test hasil build                          | Berjalan pada loopback port sementara 4001                                      |
| GET /api/v1/health                              | 200 dengan database up                                                          |
| PostgreSQL dihentikan saat API aktif            | 503, pesan Database unavailable tanpa detail koneksi                            |
| PostgreSQL dihidupkan kembali                   | Health pulih menjadi 200                                                        |
| Swagger UI dan OpenAPI JSON                     | 200; dokumen memuat /api/v1/health                                              |
| Health pada proses yang sudah memakai port 4000 | 200                                                                             |
| .gitignore                                      | .env/generated client/node_modules/dist diabaikan; .env.example tidak diabaikan |

Tes integrasi mencakup tujuh tabel, koneksi database nyata melalui HTTP, presisi uang
Decimal(18,2), SKU unik, CHECK harga/stok, RESTRICT foreign key, dan composite foreign key
agar mutasi stok tidak merujuk item penjualan produk lain. Fixture dibatalkan melalui rollback.
Tes HTTP mencakup database up/down, penyamaran pesan error, Swagger, prefix, CORS, dan
schema validation (termasuk properti asing) melalui controller khusus test.

## Kendala yang ditangani dan batasan tersisa

- Sandbox awalnya menolak koneksi database dan listen socket; migrasi serta tes jaringan
  diulang dengan izin lokal dan berhasil. Ini bukan kegagalan aplikasi.
- Uji awal menemukan refinement URL melempar error untuk input tidak valid. Sudah diperbaiki
  dengan URL.canParse dan seluruh unit test diulang berhasil.
- Lima temuan audit awal berasal dari alat deployment starter @nestjs/mau.
  Dependensi dan script deploy yang tidak digunakan dihapus; audit akhir bersih.
- npm masih menampilkan pemberitahuan install scripts yang belum diizinkan untuk
  Prisma/engines, fsevents, dan @scarf/scarf. Tidak ada izin script tambahan yang diberikan;
  generate Prisma, build, migrasi, dan tes tetap berhasil pada lingkungan ini.
- Startup hasil build pada port 4000 mendapat EADDRINUSE karena proses Node pengguna
  sudah berjalan di port tersebut. Proses itu dipertahankan; health-nya diverifikasi 200.
  Smoke test terisolasi menggunakan PORT=4001 dan Observe dimatikan hanya untuk proses test.
  Default konfigurasi tetap 4000. Proses sementara dihentikan setelah verifikasi.
- PostgreSQL dikembalikan ke kondisi berjalan/healthy setelah uji kegagalan.
- Repository saat ini terdeteksi Git sebagai bagian dari working tree induk di direktori home,
  bukan repository terisolasi di apps/api. Tidak mengubah Git root, melakukan commit, push,
  atau deployment. Pemeriksaan Git akhir dibatasi ke direktori aplikasi.
- Belum ada CRUD, autentikasi, sales workflow, sinkronisasi saldo/jurnal, atau frontend,
  sesuai batas Phase 1. Tidak ada blocker kode Phase 1 yang diketahui.
