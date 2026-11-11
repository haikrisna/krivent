# Phase 6 — Sales Order Management dan Fulfillment

Implementasi mengikuti desain berikut. Endpoint tersedia di `/api/v1/sales-orders`; hasil eksekusi verifikasi dicatat terpisah di PHASE6-VERIFICATION.md.

## Temuan repository

Schema sudah memiliki Sale, SaleItem, SaleStatus, dan StockMovement.saleItemId dengan foreign key gabungan ke item dan produk. Sebelum Phase 6, SaleStatus hanya DRAFT, COMPLETED, CANCELLED. Sale.customerId masih nullable untuk kompatibilitas data lama. Harga item dan total menggunakan Decimal(18,2). Modul sales-orders ditambahkan pada Phase 6.

InventoryService.change menyediakan receipt dan physical-count adjustment, termasuk transaksi internal opsional. Phase 6 menambahkan InventoryService.deduct untuk deduction penjualan. Semua perubahan stok harus menaikkan stockVersion dan menyimpan ledger dengan snapshot serta key/hash; constraint trigger deferred memvalidasinya saat commit. Ledger tidak dapat diubah/dihapus. Karena itu fulfillment harus menjadi operasi InventoryService baru, bukan SQL stok di SalesOrderService atau penyalahgunaan adjustment.

CRM membatasi SALES_STAFF melalui Customer.ownerId; creator order bukan pengganti kepemilikan CRM. Guard role hanya memeriksa izin endpoint: service tetap wajib membatasi objek dan query.

## State machine 

| Dari | Ke | Pelaku | Efek stok |
| --- | --- | --- | --- |
| DRAFT | CONFIRMED | Admin atau sales pemilik customer | Tidak ada |
| CONFIRMED | FULFILLED | Admin atau warehouse | Deduction atomik |
| FULFILLED | COMPLETED | Admin atau sales pemilik customer | Tidak ada |
| DRAFT / CONFIRMED | CANCELLED | Admin atau sales pemilik customer | Tidak ada |

Transisi lain menghasilkan 409. Tidak ada reservasi MVP: dua order dapat dikonfirmasi ketika stok hanya cukup untuk satu order. Fulfillment pertama yang berhasil mendapat stok; order lain tetap CONFIRMED dan menerima 409 insufficient stock. FULFILLED/COMPLETED tidak dapat dibatalkan. Pengembalian barang membutuhkan workflow retur terpisah; tidak ada restock otomatis.

PATCH hanya untuk notes pada DRAFT. Item dan customer tidak dapat diganti; bila salah, batalkan draft dan buat order baru. Kebijakan ini menjaga snapshot harga tetap immutable sejak pembuatan.

## ERD dan migrasi 

Pertahankan User → Sale, Customer → Sale → SaleItem → Product, dan SaleItem → StockMovement. Tambahkan enum CONFIRMED/FULFILLED tanpa mengubah arti status lama. Tambahkan confirmedAt, fulfilledAt, completedAt, cancelledAt dan cancellationReason nullable; jangan mengarang tanggal historis. Tambahkan receipt idempotensi order dengan actorId, operation, key, requestHash, orderId dan response JSON, unique(actorId,operation,key). Receipt dan mutasi domain harus commit bersama. Respons receipt harus tetap disaring menurut izin terkini pada replay.

API baru mewajibkan customer, minimal satu item, productId unik, quantity integer positif, batas item dan total. Customer/Product harus aktif. Ambil sellingPrice database, salin sebagai unitPrice Decimal, hitung total dengan operasi Decimal; jangan memakai Number atau menerima harga/total dari klien. Total harus muat Decimal(18,2).

## RBAC 

| Operasi | ADMIN | SALES_STAFF | WAREHOUSE_STAFF |
| --- | --- | --- | --- |
| Create / patch / confirm / cancel / complete | Semua | Customer miliknya | 403 |
| List / detail | Semua | Customer miliknya | CONFIRMED/FULFILLED/COMPLETED, proyeksi operasional |
| Fulfill | Semua | 403 | CONFIRMED |

Anonymous 401, role terlarang 403. Objek di luar scope menghasilkan 404 agar keberadaannya tidak bocor, mengikuti pola CRM. Filter scope harus diterapkan sebelum count dan pagination. Warehouse hanya membutuhkan order ID, status, item ID, SKU/nama/quantity dan timestamp; jangan sertakan total, harga, notes CRM, kontak customer atau data user. Ownership menggunakan pemilik customer terkini, termasuk pada replay; pindah ownership memindahkan akses order.

## Transaksi dan idempotensi

Create mengunci advisory actor/operation/key, memeriksa receipt, mengunci customer dan produk untuk mencegah archive bersamaan, memvalidasi keaktifan/ownership, lalu menyimpan Sale, SaleItem dan receipt. Gunakan urutan produk ID yang konsisten. Replay payload berbeda adalah 409. Key wajib memakai format Phase 5; namespace operation terpisah dari inventory.

Fulfill memakai ReadCommitted: advisory key → row lock Sale → customer untuk pemeriksaan scope bila perlu → produk terurut. Setelah lock, baca ulang status dan saldo terbaru. InventoryService.deduct menerima transaksi yang sama, menolak saldo kurang, menaikkan versi, dan mencatat movement SALE negatif dengan saleItemId. Gunakan key ledger internal deterministik per item yang tidak bertabrakan dengan receipt inventory. Simpan status FULFILLED, timestamp, dan receipt sebelum commit. Kegagalan satu item membatalkan semuanya. Request fulfillment lain dengan key baru mendapat 409 setelah melihat status FULFILLED; retry key asli mengembalikan receipt asli tanpa deduction. Receipt sukses tidak kedaluwarsa. Replay tetap wajib melalui autentikasi dan scope terkini.

Lock order juga diperlukan untuk confirm, patch, complete, cancel agar cancel/fulfill atau patch/confirm tidak melewati pemeriksaan status bersamaan. Database constraint tambahan perlu ditinjau terhadap data Sale legacy sebelum diterapkan; jangan memaksa bentuk baru pada baris lama tanpa audit.

## Penjelasan untuk junior

Controller menerima HTTP dan validasi bentuk input. Guard memeriksa login dan role. Service memeriksa aturan bisnis serta ownership. Prisma menjalankan query dalam transaksi; PostgreSQL menjalankan lock, constraint dan commit.

Transaksi seperti satu paket pekerjaan: potong dua produk dan ubah status harus berhasil bersama. Bila produk kedua kurang, potongan produk pertama ikut dibatalkan. Row lock seperti antrean satu kasir untuk produk yang sama: request kedua menunggu lalu membaca saldo terbaru, sehingga dua pembeli tidak sama-sama menghabiskan lima unit terakhir.

Idempotency-Key adalah nomor usaha bisnis. Bila koneksi putus sesudah commit, kirim ulang nomor yang sama untuk memperoleh bukti sukses lama. Nomor baru berarti usaha baru. Snapshot harga seperti harga tercetak pada nota: katalog naik dari 100.00 ke 120.00 besok, nota hari ini tetap 100.00.

## Kontrak operasional

Create menggunakan POST (201 termasuk replay). GET list/detail, PATCH draft, POST confirm/fulfill/complete/cancel menggunakan 200. Semua body strict: unknown fields ditolak. Create/fulfill memerlukan Idempotency-Key. Error `{statusCode,message}`: 400 validasi/key, 401 login, 403 role, 404 objek di luar scope/tidak ada, 409 state/arsip/stok/key conflict. Tidak ada DELETE.

List: page 1–100000, pageSize 1–100 default 20, status, customerId, search (invoiceNumber), from/to ISO timezone inclusive terhadap createdAt, sortBy createdAt/updatedAt/invoiceNumber dan direction asc/desc. Snapshot count/list memakai RepeatableRead. Warehouse tidak dapat sort/filter berdasarkan harga. Decimal JSON mengikuti Prisma string (misalnya "150", bukan selalu "150.00"). invoiceNumber memakai SO-UUID, bukan nomor faktur pajak berurutan.

Migrasi 20261111090000_sales_orders bersifat aditif. Customer nullable dan status/data historis tetap dipertahankan; timestamp lama tidak di-backfill. Partial unique index memastikan satu SALE per saleItemId. Indeks ini di luar representasi Prisma DSL sehingga diuji melalui jalur PostgreSQL; database dengan duplikasi SALE legacy akan menolak migrasi dan perlu rekonsiliasi manual sebelum rollout. Jangan menghapus ledger untuk meloloskan migrasi.

Key ledger internal `sale/<item UUID>` mengandung slash yang tidak valid untuk header inventory publik, mencegah collision dengan receipt manual. Receipt replay menyimpan hasil pertama; authorization terkini diperiksa kembali dan proyeksi warehouse menghapus harga bila role actor berubah. Tidak ada TTL. Transisi tanpa key (confirm/complete/cancel) yang diulang menghasilkan 409, tidak mengulangi efek.

Tidak menambahkan dependency. Mekanisme idempotensi transaksi PostgreSQL Phase 5 dipakai kembali: receipt dan business writes harus berada dalam transaksi yang sama, bukan cache di luar transaksi. Lock customer menserialkan reassignment/archive dengan mutasi order. Semua produk dikunci berurutan untuk mengurangi deadlock. Timeout contention masih dapat memberi 500 generik; klien dapat retry create/fulfill dengan key yang sama. Tidak ada retry otomatis yang mengubah keputusan bisnis.

Constraint snapshot, immutable ledger dan stockVersion Phase 5 tetap aktif. Service adalah batas perubahan order; raw SQL oleh pemilik database masih dapat mengubah order/item/receipt. Tidak mengklaim pencegahan manipulasi DBA. Harga snapshot tidak memiliki endpoint edit. Tidak ada reservasi, payment, shipping, retur, frontend, atau deployment.
