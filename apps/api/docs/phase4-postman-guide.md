# Phase 4 — panduan Postman

Gunakan environment `baseUrl=http://localhost:3000/api/v1`, `accessToken`, `salesId`, `leadId`, `customerId`, `followUpId`. Gunakan token hasil login Phase 3; jangan memasukkan credential asli ke collection yang dibagikan. Set Authorization Bearer `{{accessToken}}`. Swagger berada di `/api/docs`.

1. Login `POST {{baseUrl}}/auth/login` dengan email/password sales yang dibuat Admin. Simpan `data.accessToken`. Jalankan juga dengan Admin, sales kedua, dan Warehouse untuk menguji batas akses.
2. Buat lead `POST {{baseUrl}}/leads` (201):

```json
{"companyName":"PT Mitra Elektronik","contactName":"Budi Santoso","email":"Budi@Mitra.example","phone":"+62215550100","source":"REFERRAL","notes":"Membutuhkan 50 laptop untuk kantor cabang"}
```

Simpan `data.id` sebagai leadId. Admin wajib menambah `ownerId: {{salesId}}`; sales default dirinya. Email hasil respons lowercase.

3. Cari `GET {{baseUrl}}/leads?search=mitra&stage=NEW&source=REFERRAL&page=1&pageSize=20&sortBy=companyName&direction=asc`. Periksa data/meta. Sales kedua mendapat list kosong dan detail lead tersebut 404.
4. Update `PATCH {{baseUrl}}/leads/{{leadId}}` dengan `{"notes":"Kebutuhan 50 laptop, target pengadaan Desember"}` (200).
5. Catat panggilan `POST {{baseUrl}}/activities` (201):

```json
{"leadId":"{{leadId}}","type":"CALL","note":"Budi mengonfirmasi kebutuhan dan jadwal pengadaan","occurredAt":"2026-11-10T08:00:00+07:00"}
```

6. Buat tugas `POST {{baseUrl}}/follow-ups` (201):

```json
{"leadId":"{{leadId}}","note":"Kirim proposal laptop bisnis","dueAt":"2026-11-12T10:00:00+07:00"}
```

Simpan followUpId. `GET /follow-ups?timing=upcoming&taskStatus=PENDING&sortBy=dueAt` menggunakan jam server; ubah tenggat sesuai tanggal pengujian. `timing=overdue` untuk tugas terlambat. `assigneeId` opsional tetapi harus owner parent.

7. Maju dengan empat request terpisah `POST {{baseUrl}}/leads/{{leadId}}/stage`, body berturut-turut `{"stage":"CONTACTED"}`, `{"stage":"QUALIFIED"}`, `{"stage":"PROPOSAL"}`, `{"stage":"WON"}` (200). Skip dari NEW ke QUALIFIED harus 409. Untuk skenario kalah, buat lead terpisah lalu `{"stage":"LOST","reason":"Anggaran ditunda"}`; tanpa reason 400, reopen 409.
8. `POST {{baseUrl}}/leads/{{leadId}}/convert` tanpa body (200). Simpan customerId. Ulangi: id sama; tidak ada Sales Order. Buat lead lain bernama perusahaan sama, majukan sampai WON, konversi harus 409 tanpa detail customer lain.
9. `GET {{baseUrl}}/customers/{{customerId}}`; `PATCH` path sama dengan `{"address":"Jl. Merdeka 10, Jakarta"}`. Buat activity baru menggunakan customerId sebagai pengganti leadId. Jangan mengirim keduanya. History asal: `GET /activities?leadId={{leadId}}`; history customer: `GET /activities?customerId={{customerId}}`.
10. `PATCH {{baseUrl}}/follow-ups/{{followUpId}}/status` body `{"status":"COMPLETED"}` (200). Ulang atau ubah ke CANCELLED sesudahnya: 409. Sales kedua: 404. Untuk cancel, buat task PENDING baru lalu `{"status":"CANCELLED"}`.
11. Uji penugasan pada lead NEW terpisah: sales mengubah ownerId ke sales kedua -> 403; Admin -> 200. Task PENDING ikut owner baru. Owner lama kehilangan akses.
12. `POST {{baseUrl}}/customers/{{customerId}}/archive` (200). Detail biasa -> 404, list default tidak memuat customer. Admin `GET /customers/{{customerId}}?status=all` -> 200; sales `?status=all` -> 403. Activity tetap tersimpan, Admin dapat `GET /activities?customerId={{customerId}}&status=all`.

Uji negatif tambahan: token kosong 401; Warehouse semua resource CRM 403; UUID invalid 400; parent tidak ada 404; activity tanpa parent/kedua parent 400; actorId/role pada body 400; owner Warehouse atau nonaktif 400; pageSize=101 400. Semua error berbentuk `{statusCode,message}`.

Customer manual: `POST /customers` dengan `{"name":"PT Pelanggan Baru","contactName":"Siti","email":"siti@pelanggan.example"}` (201). Nama/email duplikat termasuk arsip -> 409. Data customer lama tanpa owner hanya terlihat Admin; assign menggunakan `PATCH /customers/:id` dan ownerId sales aktif.
