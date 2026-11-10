# Panduan setup dan Postman Phase 3

Gunakan PostgreSQL development, Node 24, dan terminal dari apps/api. Jangan reset database atau memakai db push. Frontend, CRM, Inventory dan Sales belum dibuat.

## Setup dan bootstrap Admin

1. Pertahankan .env yang sudah ada. Cocokkan variabel baru dengan .env.example. AUTH_JWT_SECRET wajib 64 digit hex dari 32 byte acak, misalnya dihasilkan dengan `openssl rand -hex 32`. Tidak ada fallback secret. Jangan commit atau membagikan nilainya. Workspace implementasi sudah dilengkapi secret lokal bila sebelumnya belum ada, tanpa menampilkan nilainya.
2. Jalankan:

```sh
docker compose up -d --wait
npm run db:deploy
npm run db:status
npm run build
```

3. Siapkan Admin awal melalui stdin. Contoh berikut meminta input tersembunyi melalui terminal (Python 3 diperlukan untuk helper ini); tidak ada default password atau credential di argv:

```sh
python3 -c '
import getpass, json, sys
email = getpass.getpass("Email Admin (input tersembunyi): ")
name = getpass.getpass("Nama Admin (input tersembunyi): ")
password = getpass.getpass("Password Admin (12–128 karakter): ")
json.dump({"email": email, "name": name, "password": password}, sys.stdout)
' | npm run admin:bootstrap
```

Command membaca JSON strict `{email,name,password}` dan mencetak hanya status aman. Jika sudah diinisialisasi, tidak mengubah akun/password. Tidak mempromosikan user lama atau mengaktifkan ulang Admin nonaktif. Jika email bentrok dengan non-Admin, command gagal tanpa perubahan. Gunakan Admin yang sudah ada untuk manajemen selanjutnya. Jangan mencoba menghapus marker bootstrap untuk recovery.

4. Jalankan API:

```sh
npm run start:dev
```

API: http://127.0.0.1:4000/api/v1. Swagger: http://127.0.0.1:4000/api/docs. Health tetap public. Tidak perlu NODE_ENV=development untuk melewati guard katalog lagi; sekarang token dan role wajib. Bootstrap/tes tidak mengubah binding loopback atau men-deploy aplikasi.

## Environment Postman

Import OpenAPI melalui http://127.0.0.1:4000/api/docs-json. Buat environment **lokal** untuk pengujian. Jangan menaruh credential/token pada shared values, contoh response tersimpan, repository, collection export, atau console. Gunakan Postman Vault untuk password, misalnya `{{$vault:krivent-admin-password}}`; token hasil respons gunakan nilai environment lokal sementara dan hapus setelah tes.

| Variable               | Nilai                                   |
| ---------------------- | --------------------------------------- |
| baseUrl                | http://127.0.0.1:4000/api/v1            |
| email                  | Email Admin sendiri                     |
| accessToken            | Diisi dari response login, hanya lokal  |
| refreshToken           | Diisi dari response login, hanya lokal  |
| userId                 | ID user fixture yang dibuat melalui API |
| categoryId / productId | ID fixture katalog                      |

Atur collection Authorization → Bearer Token → `{{accessToken}}`. Override login/refresh/health ke No Auth. Body JSON memakai Content-Type application/json. Password dalam semua contoh harus diisi dari Vault/input sendiri; placeholder di bawah bukan credential bawaan.

## Login, profile, refresh dan logout

**POST {{baseUrl}}/auth/login**, No Auth:

```json
{
  "email": "{{email}}",
  "password": "{{$vault:krivent-admin-password}}"
}
```

Hasil 200, `data` mempunyai accessToken, refreshToken, tokenType=Bearer, expiresIn=900 secara default. Post-response script berikut tidak menulis token ke console:

```javascript
pm.test('Login berhasil', () => pm.response.to.have.status(200));
if (pm.response.code === 200) {
  const pair = pm.response.json().data;
  pm.environment.set('accessToken', pair.accessToken);
  pm.environment.set('refreshToken', pair.refreshToken);
}
```

**GET {{baseUrl}}/auth/me** atau **GET {{baseUrl}}/users/me**, Bearer: 200, hanya profil aman. Kedua route konsisten mengembalikan `{data:{id,email,name,role,isActive,createdAt,updatedAt}}`, tanpa passwordHash atau sid.

**POST {{baseUrl}}/auth/refresh**, No Auth:

```json
{ "refreshToken": "{{refreshToken}}" }
```

Hasil 200: pasangan baru. Gunakan script login di atas dengan label tes diubah menjadi Refresh berhasil untuk **mengganti kedua token**. Jangan tetap memakai refresh token lama. Access token lama belum otomatis dicabut oleh rotasi normal, tetapi berumur pendek dan terikat session sama.

Uji replay secara sengaja: simpan token lama hanya sebagai nilai lokal `previousRefreshToken`, refresh sekali, lalu kirim token lama. Harus 401. GET me memakai access token baru juga 401 dan refresh successor 401: seluruh family sudah dicabut. Login ulang sebelum melanjutkan. Dua refresh paralel memakai token sama juga mencabut family; Next.js kelak harus single-flight.

**POST {{baseUrl}}/auth/logout**, Bearer, tanpa body: 204 kosong. GET me dan refresh token session tersebut harus 401. Session lain yang dibuat melalui login terpisah tetap valid. Hapus environment lokal:

```javascript
if (pm.response.code === 204) {
  pm.environment.unset('accessToken');
  pm.environment.unset('refreshToken');
  pm.environment.unset('previousRefreshToken');
}
```

Tanpa token/expired token → 401. Role tidak cukup → 403. Login email tidak ada/password salah/akun nonaktif → body identik `{statusCode:401,message:"Invalid email or password"}`. Response sensitif, termasuk error, mempunyai Cache-Control: no-store. Default login maksimal 5 request/menit per peer, refresh 30/menit; 429 menyertakan Retry-After. Tunggu window berikutnya jika skenario manual mencapai batas.

## Users — login sebagai Admin

**POST {{baseUrl}}/users**:

```json
{
  "email": "staff-{{$timestamp}}@example.test",
  "name": "Sales Test",
  "password": "{{$vault:krivent-test-staff-password}}",
  "role": "SALES_STAFF"
}
```

Hasil 201. Role opsional, default SALES_STAFF; password minimal 12 karakter. Simpan ID dari `data.id` ke userId. Tidak ada endpoint register public.

| Request                        | Body/query                                                      | Hasil                                            |
| ------------------------------ | --------------------------------------------------------------- | ------------------------------------------------ |
| GET /users                     | ?page=1&pageSize=10&role=SALES_STAFF&status=active&search=staff | 200, data + meta pagination                      |
| GET /users/{{userId}}          | —                                                               | 200 profil aman                                  |
| PATCH /users/{{userId}}        | `{"name":"Sales Updated"}`                                      | 200                                              |
| PATCH /users/{{userId}}        | `{"email":"changed@example.test"}`                              | 200 dan revoke semua session target              |
| PATCH /users/{{userId}}        | password baru dari Vault                                        | 200 dan revoke semua session target              |
| PATCH /users/{{userId}}/role   | `{"role":"WAREHOUSE_STAFF"}`                                    | 200 dan revoke session jika role berubah         |
| PATCH /users/{{userId}}/status | `{"isActive":false}`                                            | 200, target tidak dapat login/memakai token lama |
| PATCH /users/{{userId}}/status | `{"isActive":true}`                                             | 200, token lama tetap revoked; login ulang       |

Jangan mengubah email/password Admin yang dipakai untuk skenario lain sebelum selesai karena session Admin tersebut ikut dicabut. Self-demotion/self-deactivation ditolak 409, termasuk saat ada Admin lain. Admin aktif terakhir juga tidak dapat dihilangkan aksesnya. Tes Admin terakhir/concurrent sebaiknya melalui automated suite terisolasi, bukan menonaktifkan akun development sungguhan.

Tes negatif: email duplikat dengan kapital/spasi berbeda 409; invalid email/password pendek/field role dalam PATCH biasa/passwordHash/permissions/isActive saat create → 400. UUID invalid 400, ID tak ditemukan 404. Sales/Warehouse memanggil list/detail/manage user lain → 403. Menambahkan header X-Role: ADMIN tidak mengubah izin.

## Catalog terlindungi

Gunakan contoh Phase 2 dengan Bearer Admin; aturan validasi, Decimal, filter, pagination dan arsip tetap berlaku.

**POST {{baseUrl}}/categories**:

```json
{ "name": "Laptop-{{$timestamp}}", "description": "Perangkat bisnis" }
```

Simpan categoryId, lalu **POST {{baseUrl}}/products**:

```json
{
  "categoryId": "{{categoryId}}",
  "sku": "TEST-LAPTOP-{{$timestamp}}",
  "name": "ThinkPad Test",
  "costPrice": "10000000.01",
  "sellingPrice": "12500000.99"
}
```

Simpan productId. Harga tetap string, stok awal nol. PATCH tidak boleh menerima stockQuantity. POST /products/{{productId}}/archive hanya Admin; kategori tidak bisa diarsipkan selama mempunyai produk aktif.

Ulangi login menggunakan akun role lain yang dibuat Admin (simpan token Admin secara lokal bila perlu):

| Aksi                          | Admin                        | Sales | Warehouse |
| ----------------------------- | ---------------------------- | ----- | --------- |
| GET categories/products       | 200                          | 200   | 200       |
| POST categories/products      | 201                          | 403   | 201       |
| PATCH categories/products     | 200                          | 403   | 200       |
| POST product/category archive | 200 (atau 409 aturan bisnis) | 403   | 403       |
| GET users                     | 200                          | 403   | 403       |

## Contoh curl untuk request terlindungi

Set ACCESS_TOKEN secara lokal dari login, tanpa menaruh nilai nyata dalam history atau source. Contoh ini hanya untuk loopback; jangan menyalin output credential ke log.

```sh
BASE=http://127.0.0.1:4000/api/v1
curl -i "$BASE/health"
curl -i "$BASE/products"
# 200 public health; 401 products tanpa token

curl -i "$BASE/users/me" -H "Authorization: Bearer $ACCESS_TOKEN"
curl -i "$BASE/products?page=1&pageSize=10&status=active" \
  -H "Authorization: Bearer $ACCESS_TOKEN"
curl -i -X POST "$BASE/categories" \
  -H "Authorization: Bearer $ACCESS_TOKEN" \
  -H 'Content-Type: application/json' -d '{"name":"Laptop curl test"}'
curl -i -X POST "$BASE/auth/logout" -H "Authorization: Bearer $ACCESS_TOKEN"
# 204, setelahnya token tersebut 401
```

Login dan refresh paling mudah diuji melalui Postman Vault agar password/token tidak menjadi literal argv curl. Untuk otomasi, kirim body credential melalui stdin (`--data-binary @-`) dari secret manager dan jangan mencetak respons token ke log CI.

## Checklist dan perintah verifikasi

- [ ] Bootstrap pertama membuat satu Admin; pengulangan tidak mengganti credential.
- [ ] Health tanpa token 200; Catalog/Users tanpa token 401.
- [ ] Login benar 200, salah/nonexistent/disabled generik 401.
- [ ] Me tidak mempunyai password/token hash atau field session internal.
- [ ] Refresh mengganti token; replay token lama mencabut seluruh session.
- [ ] Logout mencabut session saat ini, bukan device lain.
- [ ] Matriks role sesuai tabel, termasuk Warehouse tidak boleh archive.
- [ ] Users strict DTO, email normalized unique dan aturan Admin terakhir bekerja.
- [ ] Perubahan password/email/role/status mencabut session target.
- [ ] Swagger memuat Bearer auth; tombol Authorize memakai access token saja.
- [ ] Response auth/error no-store; login berulang mencapai 429.
- [ ] Restart API tidak menghapus session (tersimpan di PostgreSQL); ini checklist manual terpisah.

```sh
npm run lint
npm run build
npm test
npm run test:e2e
npm run test:integration
npm run db:status
```

Build diperlukan sebelum integration suite karena tes bootstrap menjalankan artefak CLI yang sama dengan operator. Suite identity/catalog/bootstrap membuat schema `krivent_test_<random hex>`, menerapkan migrasi tersimpan, dan hanya menghapus schema uji itu setelah selesai. Tes fondasi database lama memakai rollback di database lokal yang sudah dimigrasi. Jangan arahkan suite ke database produksi. Tidak ada reset/truncate database development.

Rekomendasi penyimpanan token browser Next.js, CSRF, dan tradeoff: [desain Phase 3](phase3-authentication.md). Hasil yang benar-benar dieksekusi: [verifikasi Phase 3](../PHASE3-VERIFICATION.md).
