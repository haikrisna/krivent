# Pengujian manual katalog (baseline Phase 2)

> Setelah Phase 3, siapkan login Admin dan ACCESS_TOKEN melalui [panduan Phase 3](phase3-postman-guide.md). Aturan bisnis di bawah tetap berlaku, tetapi semua request katalog memerlukan Bearer token.

## Persiapan

Dari apps/api, gunakan Node 24, .env lokal yang sudah ada, dan database development. Jangan timpa .env atau memakai reset/db push.

```sh
docker compose up -d --wait
npm run db:deploy
npm run build
npm run start:dev
```

Pastikan NODE_ENV=development (default jika belum diset). API bind 127.0.0.1. Endpoint katalog kini memakai autentikasi dan RBAC. Admin dapat menjalankan seluruh skenario katalog ini, termasuk di mode test/production; aplikasi tetap bind loopback. Swagger: http://localhost:4000/api/docs. Postman dapat mengimpor http://localhost:4000/api/docs-json atau setiap perintah curl berikut melalui Import → Raw text. Semua harga adalah string, bukan JSON number.

## Skenario berurutan dengan curl

Perintah berikut memakai shell POSIX, curl dan Node (tanpa jq). Jalankan dalam satu terminal. Nama/SKU memakai timestamp agar tidak bentrok dengan percobaan sebelumnya.

```sh
: "${ACCESS_TOKEN:?Siapkan access token Admin terlebih dahulu}"
BASE=http://127.0.0.1:4000/api/v1
RUN=$(date +%s)

curl -i -H "Authorization: Bearer $ACCESS_TOKEN" "$BASE/health"
# 200, database up

CATEGORY=$(curl --fail-with-body -H "Authorization: Bearer $ACCESS_TOKEN" -sS -X POST "$BASE/categories" \
  -H 'Content-Type: application/json' \
  -d "{\"name\":\"Laptop-$RUN\",\"description\":\"Perangkat bisnis\"}")
printf '%s\n' "$CATEGORY"
CAT_ID=$(printf '%s' "$CATEGORY" | node -pe 'JSON.parse(require("node:fs").readFileSync(0,"utf8")).data.id')
# POST 201, {data:{id,name,description,isActive:true,createdAt,updatedAt}}

PRODUCT=$(curl --fail-with-body -H "Authorization: Bearer $ACCESS_TOKEN" -sS -X POST "$BASE/products" \
  -H 'Content-Type: application/json' \
  -d "{\"categoryId\":\"$CAT_ID\",\"sku\":\"nb-len-$RUN\",\"name\":\"ThinkPad E14\",\"costPrice\":\"10000000.01\",\"sellingPrice\":\"12500000.99\"}")
printf '%s\n' "$PRODUCT"
PRODUCT_ID=$(printf '%s' "$PRODUCT" | node -pe 'JSON.parse(require("node:fs").readFileSync(0,"utf8")).data.id')
# POST 201, uppercase SKU, stockQuantity=0, harga tetap string dua desimal

curl -i -H "Authorization: Bearer $ACCESS_TOKEN" "$BASE/categories/$CAT_ID"
curl -i -H "Authorization: Bearer $ACCESS_TOKEN" "$BASE/products/$PRODUCT_ID"
# 200

curl -i -H "Authorization: Bearer $ACCESS_TOKEN" -X POST "$BASE/products" -H 'Content-Type: application/json' \
  -d "{\"categoryId\":\"$CAT_ID\",\"sku\":\"NB-LEN-$RUN\",\"name\":\"Duplicate\",\"costPrice\":\"1\",\"sellingPrice\":\"2\"}"
# 409, SKU sudah ada

curl -i -H "Authorization: Bearer $ACCESS_TOKEN" -X PATCH "$BASE/products/$PRODUCT_ID" \
  -H 'Content-Type: application/json' -d '{"sellingPrice":"13000000.50","name":"ThinkPad E14 Gen 2"}'
# 200, harga baru tersimpan, stockQuantity tetap 0

curl -i -H "Authorization: Bearer $ACCESS_TOKEN" -X PATCH "$BASE/categories/$CAT_ID" \
  -H 'Content-Type: application/json' -d '{"description":null}'
# 200, deskripsi dikosongkan

curl -i -H "Authorization: Bearer $ACCESS_TOKEN" --get "$BASE/products" \
  --data-urlencode "categoryId=$CAT_ID" --data-urlencode 'search=thinkpad' \
  --data-urlencode 'minPrice=10000000.00' --data-urlencode 'maxPrice=15000000.00' \
  --data-urlencode 'sortBy=sellingPrice' --data-urlencode 'direction=desc' \
  --data-urlencode 'page=1' --data-urlencode 'pageSize=10'
# 200, data satu produk, meta.total=1, totalPages=1

curl -i -H "Authorization: Bearer $ACCESS_TOKEN" -X PATCH "$BASE/products/$PRODUCT_ID" \
  -H 'Content-Type: application/json' -d '{"sellingPrice":"-1"}'
curl -i -H "Authorization: Bearer $ACCESS_TOKEN" -X PATCH "$BASE/products/$PRODUCT_ID" \
  -H 'Content-Type: application/json' -d '{"sellingPrice":13000000.50}'
curl -i -H "Authorization: Bearer $ACCESS_TOKEN" -X PATCH "$BASE/products/$PRODUCT_ID" \
  -H 'Content-Type: application/json' -d '{"stockQuantity":100}'
curl -i -H "Authorization: Bearer $ACCESS_TOKEN" -X PATCH "$BASE/products/$PRODUCT_ID" \
  -H 'Content-Type: application/json' -d '{}'
# Semua 400, tidak ada perubahan parsial

curl -i -H "Authorization: Bearer $ACCESS_TOKEN" -X PATCH "$BASE/products/$PRODUCT_ID" \
  -H 'Content-Type: application/json' -d '{"categoryId":"11111111-1111-4111-8111-111111111111"}'
# 404 jika UUID tersebut tidak ada di database
curl -i -H "Authorization: Bearer $ACCESS_TOKEN" "$BASE/products/invalid-id"
# 400
curl -i -H "Authorization: Bearer $ACCESS_TOKEN" "$BASE/products?pageSize=101"
# 400

curl -i -H "Authorization: Bearer $ACCESS_TOKEN" -X POST "$BASE/categories/$CAT_ID/archive"
# 409: masih mempunyai produk aktif
curl -i -H "Authorization: Bearer $ACCESS_TOKEN" -X POST "$BASE/products/$PRODUCT_ID/archive"
curl -i -H "Authorization: Bearer $ACCESS_TOKEN" -X POST "$BASE/products/$PRODUCT_ID/archive"
# Keduanya 200, isActive=false, tidak dihapus
curl -i -H "Authorization: Bearer $ACCESS_TOKEN" -X PATCH "$BASE/products/$PRODUCT_ID" \
  -H 'Content-Type: application/json' -d '{"name":"Cannot edit"}'
# 409
curl -i -H "Authorization: Bearer $ACCESS_TOKEN" "$BASE/products?categoryId=$CAT_ID"
# 200, data=[], meta.total=0
curl -i -H "Authorization: Bearer $ACCESS_TOKEN" "$BASE/products?categoryId=$CAT_ID&status=archived"
curl -i -H "Authorization: Bearer $ACCESS_TOKEN" "$BASE/products/$PRODUCT_ID"
# 200, detail arsip tetap ada
curl -i -H "Authorization: Bearer $ACCESS_TOKEN" -X POST "$BASE/categories/$CAT_ID/archive"
# 200, kategori nonaktif dan relasi tetap ada
curl -i -H "Authorization: Bearer $ACCESS_TOKEN" -X DELETE "$BASE/products/$PRODUCT_ID"
# 404: hard-delete tidak disediakan
```

Contoh respons detail produk (UUID/timestamp mengikuti data aktual):

```json
{
  "data": {
    "id": "a1b2c3d4-1111-4111-8111-123456789abc",
    "categoryId": "b1b2c3d4-1111-4111-8111-123456789abc",
    "sku": "NB-LEN-001",
    "name": "ThinkPad E14",
    "description": null,
    "costPrice": "10000000.01",
    "sellingPrice": "12500000.99",
    "stockQuantity": 0,
    "isActive": true,
    "createdAt": "2026-11-10T04:00:00.000Z",
    "updatedAt": "2026-11-10T04:00:00.000Z"
  }
}
```

Konflik: `{"statusCode":409,"message":"Unique value already exists"}`. Invalidasi menggunakan statusCode=400 dan message validasi. Status sukses: create 201; list/detail/update/archive 200. UUID valid yang tidak ditemukan 404; tanpa token 401 atau role tidak cukup 403. Koneksi database bermasalah dapat menghasilkan 503 untuk kode yang dikenali atau 500 generik untuk error tak dikenal; tidak mengekspos detail query.

## Checklist manual

- [ ] Kategori dan produk dapat dibuat; field wajib/whitespace/harga negatif/pecahan >2 digit ditolak.
- [ ] SKU huruf kecil menjadi uppercase; duplikat create/update 409.
- [ ] CategoryId tidak ada 404; kategori arsip 409.
- [ ] Harga hasil GET persis dan bertipe string; request dengan harga number ditolak 400.
- [ ] Search case-insensitive, kategori, rentang harga, sort dan meta pagination sesuai dataset.
- [ ] Body stockQuantity/isActive/permissions dan sort field tidak dikenal ditolak 400.
- [ ] Arsip kategori dengan produk aktif 409; setelah produk diarsipkan menjadi 200.
- [ ] Produk arsip hilang dari list default, muncul di status=archived/all; detail tetap ada; update 409.
- [ ] Restart API lalu GET ID yang sama: data masih tersimpan. Untuk membuktikan volume, restart container tanpa menghapus volume, lalu GET ulang.
- [ ] Swagger menampilkan body dan contoh response, harga string, serta seluruh query/error.
- [ ] Tanpa token katalog 401, Sales dilarang menulis dan Warehouse dilarang archive (403). Admin dengan token valid tetap dapat mengakses, tanpa bypass NODE_ENV.
- [ ] npm run db:status, lint, build, test, test:e2e, test:integration berhasil di lingkungan lokal.

Contoh curl ini meninggalkan data uji berstatus arsip untuk ditelusuri; tidak menghapus data bisnis. Automated integration suite Phase 3 memakai schema acak sendiri dan membersihkan schema uji tersebut.
