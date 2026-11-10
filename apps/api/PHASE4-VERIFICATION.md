# Phase 4 — hasil verifikasi aktual

Tanggal: 10 November 2026. Workspace: apps/api. Tidak ada commit, push, deployment, atau perubahan remote.

## Baseline independen sebelum implementasi

| Suite | File | Tes lulus |
| --- | ---: | ---: |
| npm test | 3 | 31 |
| npm run test:e2e | 1 | 10 |
| npm run test:integration | 4 | 81 |
| Total baseline Phase 1–3 | 8 | 122 |

Baseline pertama e2e dalam sandbox gagal 10 tes dengan `listen EPERM 127.0.0.1`; command berantai berhenti sebelum integration. Sesudah izin eksekusi lokal diberikan, e2e 10/10 dan integration 81/81 lulus. Tidak mengubah tes lama agar lulus.

## Verifikasi akhir

| Command yang dijalankan | Hasil |
| --- | --- |
| npx prisma format | Berhasil; schema diformat |
| npx prisma validate | Berhasil, schema valid |
| npx prisma generate | Berhasil, Prisma client 7.10.1 |
| npm run lint | Exit 0, tanpa warning pada putaran akhir |
| npm run build | Exit 0, generate client dan Nest build |
| npm test | 4 file, **73 passed**, 0 failed |
| npm run test:integration | 5 file, **98 passed**, 0 failed |
| npm run test:e2e | 1 file, **10 passed**, 0 failed |
| npx prisma migrate status | 4 migrations, database up to date |
| git diff --check | Exit 0 |

**Total akhir: 181 passed, 0 failed, 10 file tes.** Tambahan Phase 4: 42 unit (36 kombinasi stage + 6 schema cases), 17 integration; total 59 tambahan. Semua 122 tes baseline tetap dijalankan dan lulus, termasuk Auth, refresh rotation, RBAC, Catalog, bootstrap dan fondasi HTTP.

Tes integrasi memakai PostgreSQL nyata pada schema acak `krivent_test_*`, menerapkan seluruh migration menggunakan helper existing, lalu membersihkan hanya schema tes tersebut. Izin eksekusi di luar sandbox diperlukan untuk koneksi database lokal dan port HTTP loopback. Tidak ada migrate reset/db push atau pembersihan data development.

## Migrasi dan SQL

- Ditinjau `prisma/schema.prisma` serta tiga migrasi Phase 1–3 sebelum perubahan.
- Percobaan `npx prisma migrate diff --from-migrations prisma/migrations --to-schema prisma/schema.prisma --script` gagal karena shadowDatabaseUrl tidak dikonfigurasi. Tidak membuat shadow database atau mengubah konfigurasi.
- Mengambil schema baseline dengan `git show HEAD:apps/api/prisma/schema.prisma` ke `/private/tmp/krivent-phase3.prisma`.
- Menghasilkan SQL dengan `npx prisma migrate diff --from-schema /private/tmp/krivent-phase3.prisma --to-schema prisma/schema.prisma --script`, kemudian menambahkan SQL CHECK XOR parent dan lost reason.
- Membaca seluruh migration.sql dan memeriksa keyword destruktif. `ON DELETE RESTRICT / ON UPDATE CASCADE` adalah aturan FK, bukan penghapusan atau penulisan ulang data. SQL hanya CREATE TYPE/TABLE/INDEX dan ALTER TABLE ADD COLUMN/CONSTRAINT.
- Memvalidasi hostname DATABASE_URL secara terprogram harus localhost/127.0.0.1/::1 dan NODE_ENV bukan production, tanpa mencetak credential.
- Menjalankan `npx prisma migrate deploy`: `20261110120000_crm` berhasil diterapkan pada database development lokal `krivent`, schema public. Tiga migrasi lama dipertahankan.
- Hasil akhir `npx prisma migrate status`: database up to date.

## Kegagalan sementara yang diperbaiki

- HTTP baseline gagal karena sandbox EPERM; dijalankan ulang dengan izin dan lulus.
- Build awal menemukan sintaks contoh Swagger yang salah; diperbaiki sebelum pengujian CRM.
- Lint awal memberi warning spread object redundant dan comparator sort; keduanya diperbaiki.
- Putaran pertama CRM: 73 unit, 96 integration, 10 e2e lulus. Dua integration test tambahan kemudian mengungkap filter tidak relevan belum ditolak: 97 passed / 1 failed (customer `stage=NEW` menghasilkan 200). Service diperbaiki; putaran akhir 98/98 integration lulus. Tidak melemahkan ekspektasi tes.
- Fetch dokumentasi Nest markdown melalui web tool gagal karena unsupported content-type. Implementasi menggunakan pola StandardSchemaValidationPipe/CurrentUser yang sudah ada dan diverifikasi melalui build serta HTTP tests.

## Cakupan bukti

- Lead create/update/detail/search/stage/owner/source/pagination serta allowlist sort.
- Seluruh 36 pasangan transisi tahap diuji; loss reason, immutable terminal, premature conversion diuji via HTTP.
- Konversi bersamaan lead sama mengembalikan id customer sama; dua lead dengan nama ternormalisasi sama menghasilkan satu 200 dan satu 409; tidak membuat Sale.
- Customer legacy dengan field asli dipertahankan, assignment Admin dan duplicate check legacy.
- Role matrix anonymous/warehouse untuk empat resource; sales lain mendapat 404/list kosong; reassignment sales ditolak.
- Activity actor berasal dari session; parent XOR, missing references, injection, archived history dan SQL CHECK diuji.
- Follow-up overdue/upcoming, status/assignee filter, completion/cancellation, terminal conflict, transfer pending tasks dan unauthorized completion.
- Customer activity, follow-up, update, archive; validasi UUID/body/query; HTTP status; kontrak Swagger body strict, query dan Bearer security.

## File berubah/ditambahkan

Existing:
- README.md
- prisma/schema.prisma
- src/app.module.ts
- src/configure-app.ts

Baru:
- prisma/migrations/20261110120000_crm/migration.sql
- src/crm/crm.module.ts
- src/crm/crm.controller.ts
- src/crm/crm.service.ts
- src/crm/crm.schemas.ts
- src/crm/crm.swagger.ts
- src/crm/crm.schemas.spec.ts
- test/crm.integration-spec.ts
- docs/phase4-crm.md
- docs/phase4-postman-guide.md
- PHASE4-VERIFICATION.md

Generated Prisma client dan dist merupakan build artifacts yang di-ignore, bukan sumber untuk commit.

## Batas dan risiko tersisa

- Tidak ada blocker teramati pada verifikasi akhir. Hasil ini menguji lingkungan lokal, bukan beban/produksi.
- Deduplikasi legacy memindai nama/email customer O(n) dalam transaksi. Volume besar membutuhkan audit/backfill normalisasi dan query/index khusus. Duplicate legacy yang sudah ada tetap utuh dan dapat menghalangi update; penyelesaiannya harus terpisah dan ditinjau.
- Unique nullable menjaga data baru melalui service; raw SQL yang mengabaikan dedupKey/normalizedEmail dapat melewati kebijakan deduplikasi legacy. Semua jalur aplikasi CRM menggunakan transaksi service.
- Pencarian contains case-insensitive tidak memakai trigram; offset pagination dan batas retry serialisasi sesuai skala fase ini, belum dibuktikan dengan load test.
- Tidak ada reopen/restore, notifikasi, auto-reschedule, auto-merge customer, atau cleanup activity. Histori tersimpan; Admin perlu status=all untuk parent arsip.
- Constraint graph lifecycle dan kebijakan active sales owner ditegakkan service transaksi; enum/FK/CHECK/unique ditegakkan database. Perubahan role/status user existing tidak menghapus assignment historis. Admin dapat memindahkan objek aktif bila owner dinonaktifkan.
- Migration ALTER TABLE/index dapat memerlukan lock pada database besar; hanya lokal development diterapkan. Tidak memigrasikan remote.

Penjelasan bisnis, RBAC, ERD, tradeoff serta alur controller → guard → service → Prisma tersedia dalam docs/phase4-crm.md. Urutan request tersedia dalam docs/phase4-postman-guide.md.
