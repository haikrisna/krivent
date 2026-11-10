# Phase 5 — Inventory Management

## Audit dan keputusan desain

Audit membaca schema Prisma, semua migrasi, catalog service/schema, guard autentikasi dan role, test, docs/architecture.md dan docs/phase4-crm.md. Baseline nyata: 73 unit, 98 integration PostgreSQL, 10 e2e = 181 lulus. Angka tersebut diverifikasi sebelum perubahan; suite e2e lama memakai database double, bukan PostgreSQL.

Product.stockQuantity tetap satu-satunya saldo otoritatif untuk gudang tunggal. Tidak menambah tabel balance atau warehouse. Ledger StockMovement menyimpan bukti perubahan, bukan saldo kedua yang dapat diedit. Saldo awal produk baru nol; Products POST/PATCH strict menolak stockQuantity/stockVersion. LowStockThreshold boleh dikonfigurasi Admin/Warehouse melalui Products, bilangan bulat 0–2147483647, default 0. Mengubah threshold tidak mengubah versi stok. Low stock berarti saldo <= threshold; gunakan GET balances?lowStock=true.

Receipt = barang benar-benar diterima, quantity positif, reason wajib 3–2000 karakter setelah trim. Simpan sebagai type PURCHASE agar kompatibel enum lama. Adjustment = hasil hitung fisik absolut `countedQuantity >= 0`, dengan `expectedVersion` wajib. Delta dihitung server. Contoh: 24 router tercatat, hitung fisik 22, movement -2. Count nol mengosongkan stok; count sama mengembalikan 409 tanpa mutasi/ledger. API tidak menerima deduction bebas. Permintaan pengurangan melebihi stok akan memerlukan count negatif dan ditolak 400; SQL CHECK juga melarang saldo negatif. Fulfillment/Sales Order belum dibuat.

Setiap movement baru mencatat actor dari session, timestamp database, reason pada field `notes` yang sudah ada, delta `quantity`, beforeBalance, afterBalance, stockVersion. Tidak menerima actor/timestamp/delta dari body. Respons allowlist menyembunyikan requestHash/idempotencyKey dan kredensial; balances tidak menyertakan harga. Ketiga role boleh membaca ledger beserta actor ID/reason; jangan masukkan data sensitif dalam alasan. ADMIN dan WAREHOUSE_STAFF boleh menulis; SALES_STAFF mendapat 403; anonymous 401 melalui guard global yang sudah ada.

## Transaksi dan konkurensi

Urutan dalam transaksi ReadCommitted:

1. Validasi input dan key. Fingerprint SHA-256 dari kind dan payload tervalidasi dengan urutan key deterministik.
2. Ambil transaction-scoped advisory lock atas hash(actorId:key). Semua pemakaian key oleh actor sama diserialkan, termasuk untuk produk berbeda. Collision hash hanya menyebabkan penantian tambahan, tidak mencampur hasil karena lookup memakai key asli.
3. Cari unique(actorId,key). Payload/kind identik mengembalikan movement asli, tetap 201, tanpa perubahan stok. Payload berbeda 409. Replay dilakukan sebelum pemeriksaan state/versi produk, sehingga receipt yang sudah berhasil tetap dapat diputar ulang setelah produk diarsipkan.
4. SELECT Product FOR UPDATE; cek ada/aktif setelah lock. Receipt menghitung dari saldo terbaru; adjustment memerlukan versi tepat sama. Batas integer dan nonzero delta diperiksa.
5. Update saldo dan increment versi, lalu insert ledger. Commit bersama. FK/CHECK/unique/trigger gagal → semua rollback, termasuk key.

ReadCommitted sengaja dipilih: request yang menunggu lock membaca hasil commit terbaru, sehingga receipt paralel tidak kehilangan increment. Dua adjustment memakai versi sama: satu 201, satu 409. Setelah 409, baca ulang dan rekonsiliasi hitung fisik; jangan otomatis mengganti expectedVersion tanpa pemeriksaan. Versi mencegah kasus ABA: saldo 10 → 12 → 10 tetap berbeda versi. Receipt dan adjustment bersama hanya sukses keduanya jika adjustment lebih dahulu atau memakai versi baru; receipt lebih dahulu membuat count lama ditolak. Arsip menulis baris produk yang sama sehingga berurutan dengan mutasi.

PostgreSQL CHECK saldo >= 0 tetap berlaku. CHECK snapshot mewajibkan after=before+delta dengan cast bigint untuk menghindari overflow evaluasi. Unique(productId,stockVersion) mencegah dua ledger untuk satu versi. Deferred constraint trigger pada Product UPDATE mewajibkan kenaikan versi satu dan ledger yang cocok dengan OLD/NEW saat COMMIT; UPDATE biasa ke metadata tidak memerlukan ledger. Trigger insert ledger mewajibkan snapshot baru dan kecocokan versi/saldo produk. Trigger immutable menolak UPDATE/DELETE ledger, termasuk SQL langsung. Perubahan historis harus memakai movement koreksi baru dengan alasan.

InventoryService.change dapat menerima Prisma.TransactionClient internal sehingga transaksi domain pemanggil dapat mencakup perubahan inventory dan operasi lain tanpa commit terpisah. Pemanggil internal harus memakai ReadCommitted dan urutan lock yang sama. Untuk fulfillment mendatang, tambahkan operasi deduction bersyarat dengan ledger SALE/referensi SaleItem dalam transaksi order yang sama; jangan menyalahgunakan endpoint adjustment. Untuk banyak produk, lock dengan urutan ID konsisten. Tidak ada implementasi order pada fase ini.

## Idempotensi

Header `Idempotency-Key` wajib: 8–128 karakter `[A-Za-z0-9._:-]`. Satu key untuk satu usaha bisnis, dipakai ulang pada retry; key baru adalah usaha baru dan dapat menggandakan receipt. Scoped actor, bukan session: retry setelah login ulang tetap aman. Retry paralel menunggu transaksi pertama, lalu replay; hasil sukses permanen selama ledger dipertahankan. Tidak ada TTL/cleanup yang membuka peluang replay ulang. Hanya keberhasilan disimpan; validasi, stale count, rollback, dan kegagalan database tidak mengonsumsi key. Urutan properti JSON/whitespace reason yang dinormalisasi tidak mengubah fingerprint. Perubahan isi reason dianggap payload berbeda.

Paket first-party diperiksa di [dokumentasi NestJS idempotency](https://docs.nestjs.com/reliability/idempotency). Store generiknya tidak menerima transaksi bisnis. Karena stok dan receipt deduplikasi harus commit bersama, implementasi ini memakai unique ledger dan advisory lock PostgreSQL tanpa library baru. Kehilangan koneksi setelah commit dapat ditangani retry dengan key sama. Lock/query mengikuti timeout PrismaService 3 detik dan transaksi 10 detik; contention panjang bisa menghasilkan error database generik, klien tetap retry dengan key yang sama. Tidak ada retry otomatis terhadap count stale.

## Kontrak API

Semua route di `/api/v1`, Bearer authentication wajib. Respons tunggal `{data:movement}`, list `{data:[],meta:{page,pageSize,total,totalPages}}`. Tidak ada PATCH/DELETE movement.

| Method | Path | Status |
| --- | --- | --- |
| POST | /inventory/receipts | 201, termasuk replay |
| POST | /inventory/adjustments | 201, termasuk replay |
| GET | /inventory/balances | 200 |
| GET | /inventory/movements | 200 |
| GET | /inventory/movements/:id | 200 |

Error mengikuti ApiErrorFilter: 400 input/query/key invalid; 401 authentication; 403 role; 404 produk/movement tidak ada; 409 archived/stale/no-op/overflow/key reuse; 500 kegagalan internal generik. Swagger memuat schema, contoh, header wajib, filter dan status. Endpoint mengikuti proposal karena sesuai konvensi resource controller yang ada.

Pagination 1-based, page <=100000, pageSize 1–100, default 20. `direction=asc|desc`, default desc. Semua list mendukung productId, search, sortBy. Balances search SKU/name; status active(default)/archived/all; lowStock=true/false; sortBy name(default)/sku/stockQuantity/createdAt. Movements search reason/SKU/name; actorId; type OPENING/PURCHASE/SALE/RETURN/ADJUSTMENT; from/to timestamp ISO dengan timezone, inclusive; sortBy createdAt(default)/quantity/stockVersion. UUID dan query asing ditolak. from <= to. Secondary sort id asc; count/data memakai RepeatableRead snapshot yang sama. Pagination antar-request dapat bergeser; null snapshot historis mengikuti null ordering PostgreSQL. History mencakup produk arsip.

## Migrasi dan data lama

Migrasi aditif `20261110140000_inventory`: Product stock_version default 0, low_stock_threshold default 0; ledger menambah before/after/version/key/hash nullable; indeks unik nullable dan indeks type/date/id; CHECK serta tiga fungsi/trigger. Tidak mengubah migrasi fase lama. SQL ditinjau sebelum deploy lokal; tidak menjalankan reset, destructive db push, atau penghapusan data aplikasi. Seluruh produk, customer, CRM dan auth sessions dipertahankan.

Saldo produk lama menjadi baseline versi 0. Kolom snapshot ledger lama tetap NULL; migrasi tidak mengarang opening entry/actor/timestamp. CHECK menerima bentuk legacy semua-null, tetapi trigger insert mewajibkan snapshot bagi baris baru. Jurnal pascamigrasi menjelaskan perubahan dari baseline, bukan bukti bahwa jumlah seluruh ledger legacy sama dengan saldo. Sebelum migrasi produksi, audit jumlah ledger per produk terhadap saldo; selidiki selisih, jangan otomatis overwrite saldo. Snapshot lama sengaja tidak dibackfill karena urutan histori dan actor tidak dapat diasumsikan. Semua constraint nonnegative lama tetap berlaku.

Risiko: ALTER TABLE dan CREATE INDEX mengambil lock; CHECK memindai ledger. Jadwalkan maintenance sesuai ukuran tabel. Penulis stok versi aplikasi lama/raw SQL tanpa ledger akan gagal setelah migrasi; koordinasikan penghentian writer lama saat rollout. Trigger immutable juga mencegah cascade perubahan ID referensi; ID bisnis dianggap tetap. Backup dan uji restore sebelum rollout produksi; pekerjaan ini hanya menerapkan migrasi pada database development lokal. Prisma diff memeriksa bentuk schema yang didukung DSL; trigger/CHECK dibuktikan lewat tes PostgreSQL, bukan diff saja.

Role pemilik tabel/superuser masih bisa menonaktifkan trigger atau mengubah DDL. INSERT Product langsung dengan saldo nonzero juga dapat melewati jalur katalog; koneksi runtime harus dibatasi dan semua penulisan bisnis melalui service. Aplikasi tidak menyediakan jalur tersebut. Jangan memberi kredensial database ke klien. Tidak ada perlindungan manipulasi oleh administrator database atau pencatatan nomor PO unik global; dua actor/key baru dapat mencatat barang sama. Peninjauan operasional tetap diperlukan.

## Cakupan mendatang

Multi-warehouse, reservasi, transfer, batch/serial elektronik, damaged/quarantine bucket, purchase orders, Sales Order fulfillment, cursor pagination, export dan rekonsiliasi baseline adalah future scope. Barang rusak saat ini harus dijelaskan dalam alasan adjustment; tidak ada status lokasi barang tambahan. Tidak ada frontend, dashboard, microservice atau layanan eksternal baru.
