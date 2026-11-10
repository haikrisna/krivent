# Krivent — kebutuhan bisnis

> Baseline desain Phase 2. Implementasi autentikasi dan matriks izin terkini mengikuti [Phase 3](phase3-authentication.md), termasuk izin Warehouse membuat/mengubah katalog.
> PT Nusa Digital Distribusi adalah distributor elektronik B2B fiktif. Tujuannya menghubungkan prospek, pelanggan, penjualan, dan pemenuhan barang dengan jejak yang dapat ditelusuri. Dokumen ini membedakan rancangan target dari implementasi Phase 2.

## Aktor dan use case

| Aktor           | Tanggung jawab target                                                                | Pembatasan                                                                        |
| --------------- | ------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------- |
| Admin           | Kelola pengguna, peran, katalog; lihat laporan dan audit; koreksi stok beralasan     | Tidak boleh menghapus riwayat atau melewati aturan stok                           |
| Sales staff     | Kelola lead miliknya, aktivitas, follow-up, konversi pelanggan, draft/order miliknya | Tidak boleh menentukan permissions, mengubah harga pokok, atau menulis saldo stok |
| Warehouse staff | Baca katalog/order siap dipenuhi; catat penerimaan dan fulfillment                   | Tidak mengedit harga atau kepemilikan lead/order                                  |

Rangkaian utama: sales merekam lead → kualifikasi → konversi menjadi customer → susun order → gudang penuhi → laporan. Admin menyiapkan kategori dan produk sebelum order dibuat. Identitas aktor selalu berasal dari session/token server pada fase autentikasi, bukan createdById/role dari body.

## Lead (rencana, belum ada tabel/API)

| Dari                        | Ke        | Syarat                                                             |
| --------------------------- | --------- | ------------------------------------------------------------------ |
| NEW                         | CONTACTED | Kontak awal dan aktivitas tercatat                                 |
| CONTACTED                   | QUALIFIED | Kontak, perusahaan, kebutuhan, dan potensi pembelian terverifikasi |
| NEW / CONTACTED / QUALIFIED | LOST      | Alasan kehilangan wajib                                            |
| QUALIFIED                   | CONVERTED | Customer dibuat/ditautkan dalam transaksi; konversi sekali saja    |

CONVERTED dan LOST terminal pada MVP; reopening merupakan pengembangan berikutnya. Lead memiliki owner sales. Activity merekam interaksi; FollowUp memiliki tenggat, assignee, dan status OPEN/DONE/CANCELLED. Konversi tidak menghapus lead. Customer dapat dibaca lintas sales untuk mencegah duplikasi; perubahan customer dibatasi owner/admin. Aturan deduplikasi perusahaan ditetapkan saat CRM dibuat.

## Sales order (rencana yang menghormati schema saat ini)

MVP menggunakan entitas Sale sebagai sales order, dengan status yang sudah ada:

| Dari  | Ke        | Syarat dan efek                                                                                                                                   |
| ----- | --------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| DRAFT | DRAFT     | Owner/admin dapat mengubah item; qty integer positif, produk dan kategori aktif                                                                   |
| DRAFT | COMPLETED | Aksi fulfillment gudang/admin; customer wajib untuk alur B2B, item tidak kosong, stok cukup; harga diambil server, item/total/saldo/jurnal atomik |
| DRAFT | CANCELLED | Owner/admin, alasan wajib; belum ada efek stok                                                                                                    |

COMPLETED dan CANCELLED terminal; pembatalan transaksi selesai kelak memakai dokumen return/reversal, bukan menghapus/mengedit histori. Schema sekarang memperbolehkan customer nullable; service Sales kelak mewajibkannya sebelum completion, tanpa mengubah data lama. Invoice unik dibuat server. Harga item adalah snapshot harga jual tervalidasi server; total adalah penjumlahan Decimal harga × qty. Perubahan harga katalog tidak mengubah invoice lama. Tidak ada reservasi maupun partial fulfillment pada MVP: draft tidak menjamin stok.

CONFIRMED → PICKING → PARTIALLY_FULFILLED → FULFILLED merupakan opsi masa depan, membutuhkan keputusan reservasi, ledger dan migrasi status terpisah. Tidak ditambahkan diam-diam di Phase 2.

## Inventory (rencana)

| Jenis yang sudah ada | Delta                      | Makna                                                     |
| -------------------- | -------------------------- | --------------------------------------------------------- |
| OPENING              | positif                    | Saldo awal; satu proses terkontrol per produk             |
| PURCHASE             | positif                    | Penerimaan pemasok                                        |
| SALE                 | negatif                    | Pengeluaran fulfillment, wajib sale item produk yang sama |
| RETURN               | positif                    | Barang kembali dari pelanggan; bukan retur ke pemasok     |
| ADJUSTMENT           | positif/negatif, bukan nol | Koreksi dengan alasan dan actor berwenang                 |

Saldo integer tidak negatif. Jurnal append-only; saldo = jumlah delta sejak opening. Seluruh perubahan saldo dan penambahan jurnal berada dalam satu transaksi. Untuk pengeluaran, gunakan update bersyarat `stockQuantity >= requested` dengan decrement atomik dan cek jumlah row, bukan read-then-write tanpa proteksi. Lock produk dalam urutan ID konsisten untuk order multi-item; rollback seluruh order saat satu item gagal. Idempotensi fulfillment mencegah request ulang mengurangi stok dua kali. Transisi status harus bersyarat pada status lama dan berada dalam transaksi yang sama. Koreksi menggunakan mutasi kompensasi. Aturan ini belum diimplementasikan; schema saja belum menjaga kesamaan saldo-jurnal.

## Katalog Phase 2 (diimplementasikan)

- Kategori bernama unik secara case-sensitive (mengikuti constraint lama), trim input, deskripsi opsional.
- Produk wajib kategori aktif, SKU unik global, nama, costPrice dan sellingPrice. SKU input ASCII dinormalisasi uppercase. Data lama tidak ditulis ulang; SKU lama lowercase masih memiliki semantik unique PostgreSQL case-sensitive. Migrasi normalisasi seluruh data memerlukan audit benturan terpisah sebelum penguatan case-insensitive global.
- Harga IDR string desimal >= 0, maksimal 16 digit integral dan 2 pecahan. Nol diperbolehkan untuk sample/promosi; harga jual di bawah biaya juga diperbolehkan karena kebijakan margin belum ditentukan. Ini keputusan bisnis, bukan kesalahan perhitungan.
- Produk baru bersaldo nol. Body create/update strict, tidak menerima stockQuantity, isActive, actor atau permissions. Archive memakai aksi eksplisit; tidak tersedia delete atau restore.
- Arsip produk terminal pada API ini; detail tetap 200 untuk penelusuran, update 409, SKU tetap dipesan. Arsip tidak mengubah saldo, termasuk jika ada stok tersisa; stok fisik kelak ditangani Inventory, laporan stok harus mencakup produk arsip.
- Arsip kategori ditolak 409 jika masih mempunyai produk aktif; produk arsip tetap terhubung. Membuat/memindahkan produk ke kategori arsip ditolak. Arsip berulang idempotent.
- List default hanya aktif; `status=archived|all` eksplisit. Pencarian case-insensitive nama/SKU, kategori dan rentang harga jual, sort allowlist, pagination 1-based maksimal 100 per halaman. Urutan sekunder ID menghindari urutan acak untuk nilai sort yang sama.

## Kepemilikan dan keamanan

Katalog merupakan master data bersama. Target: admin menulis, sales membaca produk aktif tanpa harga pokok, gudang membaca informasi produk/stok yang dibutuhkan. Field-level visibility dan RBAC merupakan pekerjaan fase autentikasi; endpoint lokal saat ini menampilkan costPrice. Semua endpoint katalog sekarang memerlukan NODE_ENV=development dan socket loopback langsung. Server bootstrap bind 127.0.0.1. Header X-Forwarded-For tidak dipercaya. Jangan meneruskan port ini lewat proxy/tunnel; proxy loopback dapat membuat pemanggil remote terlihat lokal. Ini batas lingkungan pengembangan, bukan pengganti autentikasi. Mode test/production ditolak 403; integration suite secara eksplisit memakai development untuk menguji endpoint.

## Batas MVP dan pengembangan

Phase 2 hanya desain dan Category/Product. Login, RBAC, Users API, CRM, Inventory, Sales, reporting dan audit logging belum dibuat. Target MVP berikutnya: satu perusahaan, satu gudang, satu mata uang IDR, qty unit bulat, transaksi sederhana, tanpa reservasi/pajak/diskon/kredit/pembayaran/pengiriman parsial.

Berikutnya: autentikasi/RBAC terlebih dahulu; lalu CRM, Inventory, Sales, dashboard, audit. Multi-gudang, lot/serial elektronik, purchasing formal, return supplier, approval margin, pajak, pembayaran, multi-currency dan integrasi eksternal memerlukan desain tambahan. Tidak ada kebutuhan microservice, Redis, Kafka atau frontend pada fase ini.
