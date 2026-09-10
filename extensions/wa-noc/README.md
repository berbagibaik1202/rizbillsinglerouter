# RizkiTech WA NOC — MVP

Extension Manifest V3 untuk Chrome/Edge, menggunakan backend billing di workspace ini.
Backend extension dikunci ke `https://billing.rizki-tech.com`. API harus diterapkan pada origin tersebut sebelum extension dapat login.

## Menyiapkan backend

1. Sertakan perubahan `backend/server.js`, `backend/migrate.js`, `backend/mikrotik-api.js`, dan folder `backend/wa-extension/` dalam deployment billing biasa.
2. Jalankan `npm run db:migrate` di lingkungan backend tujuan dengan konfigurasi database yang benar. Startup backend yang ada juga menjalankan migrasi sebelum menerima koneksi.
3. Restart backend melalui mekanisme deployment yang biasa digunakan.
4. Pastikan konfigurasi MikroTik dan GenieACS di pengaturan billing sudah dapat digunakan.

Migrasi menambahkan `extension_sessions`, `extension_permissions`, `customer_whatsapp_links`,
`extension_audit_logs`, dan `extension_rate_limits` tanpa mengganti tabel pelanggan.
Belum ada migrasi yang dijalankan terhadap database produksi dari pekerjaan pengembangan ini.
Token extension berupa token acak; database hanya menyimpan hash. Token ini tidak dapat dipakai pada API billing umum.
Access token berlaku 15 menit, refresh token dirotasi dan sesi berakhir maksimal 7 hari sejak login.

## Permission

Akun `admin` mendapat `view`, `ping`, `reboot`, `wifi_write`, `map`, `history` secara default.
Role lainnya tidak mendapat akses otomatis. Permission diperiksa ulang pada setiap request.
Gunakan ID operator dari tabel `users` untuk memberikan izin granular melalui database:

```sql
INSERT INTO extension_permissions (user_id, permission, allowed)
VALUES ('ID-OPERATOR', 'view', 1), ('ID-OPERATOR', 'ping', 1), ('ID-OPERATOR', 'wifi_write', 1), ('ID-OPERATOR', 'history', 1)
ON DUPLICATE KEY UPDATE allowed = VALUES(allowed);
```

Untuk melarang restart, termasuk bagi admin:

```sql
INSERT INTO extension_permissions (user_id, permission, allowed)
VALUES ('ID-OPERATOR', 'reboot', 0)
ON DUPLICATE KEY UPDATE allowed = 0;
```

UI pengaturan permission dapat ditambahkan pada tahap berikutnya. `view` diperlukan untuk semua data pelanggan.
Pencabutan `view` langsung menolak API data dan refresh token. Logout menghapus sesi server.

## Build dan pasang extension

```sh
npm run test:wa-extension
npm run build:wa-extension
```

1. Buka `chrome://extensions` atau `edge://extensions`, aktifkan Developer mode.
2. Pilih **Load unpacked**, lalu folder `extensions/wa-noc/dist`.
3. Klik ikon extension untuk membuka login. Gunakan akun billing dengan permission di atas.
4. Buka atau reload WhatsApp Web. Tekan **Muat sesi** bila sidebar dibuka sebelum login.
5. Buka percakapan pelanggan. Jika header hanya menampilkan nama kontak, extension memuat pelanggan otomatis bila nama tersebut cocok tepat dengan satu pelanggan billing; nama yang ambigu atau tidak ditemukan tetap memerlukan pilihan manual.

Password tidak disimpan. Token berada di `chrome.storage.session`, hanya dapat diakses oleh konteks extension tepercaya;
content script menerima data hasil API tanpa token. Browser yang ditutup memerlukan login ulang.
Ini mengikuti [pemisahan akses storage Chrome](https://developer.chrome.com/docs/extensions/reference/api/storage).

## Cakupan yang tersedia

- Sidebar terisolasi dengan Shadow DOM, dapat ditutup/dibuka, pencarian dan pemilihan pelanggan.
- Normalisasi nomor Indonesia/internasional, pencocokan `customers.phone`, mapping nomor tambahan, penolakan hasil ambigu.
- Informasi paket dan PPPoE, IP, uptime, traffic download/upload, ping dari router pelanggan.
- Tab Billing menampilkan paket, harga paket, status pelanggan, dan hingga 12 invoice terbaru dengan status jatuh tempo yang dihitung saat dibaca.
- ACS online/stale/offline berdasarkan last inform, model, serial, RX power, SSID tanpa password WiFi.
- Operator berizin `wifi_write` dapat mengirim perubahan SSID dan password WiFi dengan konfirmasi; password tidak ditampilkan atau ditulis ke log extension/backend.
- Panel OLT/ONU menampilkan status, serial, RX, dan jalur PON dari cache OLT terbaru bila pelanggan telah memiliki mapping OLT lengkap.
- Restart ONU dengan konfirmasi nama/ID/perangkat, permission, rate limit dan audit sebelum dispatch.
- History tindakan extension. Task restart ditampilkan `QUEUED`, bukan klaim ONU sudah berhasil restart.
- Partial failure: provider gagal ditampilkan `UNAVAILABLE`, tidak dianggap pelanggan offline.

## API

Semua path berikut berada di `/api/wa-extension`.

| Method | Path | Akses |
| --- | --- | --- |
| POST | `/auth/login` | Username/password billing |
| POST | `/auth/refresh` | Refresh token |
| GET | `/auth/me` | Access token extension |
| POST | `/auth/logout` | Access token extension |
| GET | `/customers?q=...` | view |
| GET | `/customer/by-phone/:phone` | view |
| GET | `/customer/:id/overview` | view |
| GET | `/customer/:id/billing` | view |
| GET | `/customer/:id/network` | view |
| GET | `/customer/:id/traffic` | view |
| GET | `/customer/:id/acs` | view |
| GET | `/customer/:id/wifi` | view |
| POST | `/customer/:id/wifi` | view + wifi_write; `{ "ssid": "opsional", "key": "opsional", "confirm": true }` |
| GET | `/customer/:id/olt` | view |
| GET | `/customer/:id/history` | view + history |
| POST | `/customer/:id/link` | view + map; `{ "phone": "628...", "confirm": true }` |
| POST | `/customer/:id/ping` | view + ping |
| POST | `/customer/:id/reboot` | view + reboot; `{ "confirm": true }` |

`overview` memuat informasi pelanggan/paket dengan cepat; frontend memuat network/traffic/ACS terpisah.
Semua endpoint terautentikasi menggunakan `Authorization: Bearer <accessToken>`, bukan token pada query string.
Provider mengembalikan status terstruktur; error autentikasi memakai HTTP 401/403, konflik nomor 409, rate limit 429.

## Konfigurasi operasional

| Environment variable | Default |
| --- | --- |
| `WA_NOC_ACS_ONLINE_MINUTES` | 10 |
| `WA_NOC_ACS_STALE_MINUTES` | 30 |
| `WA_NOC_PING_LIMIT` | 10 per menit per operator |
| `WA_NOC_REBOOT_LIMIT` | 3 per 10 menit per pelanggan |
| `WA_NOC_WIFI_LIMIT` | 3 per jam per pelanggan |

Rate limit menggunakan fixed windows di MySQL dan berlaku lintas proses backend.
Read limit: 240 request/menit/operator; login: 10 request/menit/IP; refresh: 30 request/menit/IP.
Audit `PENDING` ditulis sebelum tindakan. Timeout/error tindakan menjadi `UNKNOWN` karena tugas bisa saja sudah diterima perangkat.
Jangan menganggap `UNKNOWN` berarti aman mengulangi restart; periksa perangkat/history terlebih dahulu.

## Batas tahap ini dan validasi

- Transport MVP memakai REST polling (traffic tiap 5 detik) dengan cache/coalescing 3 detik di backend. WebSocket/Redis collector lintas proses belum dibuat. Polling berhenti saat panel ditutup, berganti pelanggan, atau tab browser tidak terlihat.
- Integrasi MikroTik mengikuti satu konfigurasi router yang sudah digunakan billing. Multi-router/RADIUS belum ditambahkan pada extension. Mapping OLT opsional pelanggan disimpan sebagai `oltDeviceId`, `oltFrame`, `oltSlot`, `oltPort`, dan `oltOnuId`; isi kelima field tersebut bersama-sama melalui form pelanggan untuk mengaktifkan panel OLT/ONU. Data panel berasal dari `olt_ont_cache` backend, sehingga OLT perlu disinkronkan terlebih dahulu. Jika mapping atau cache belum ada, panel menampilkan `UNLINKED` atau `UNAVAILABLE`, bukan status perangkat yang ditebak.
- ACS last inform bukan bukti langsung konektivitas ONU dari OLT. RX ditampilkan sebagai nilai, tanpa threshold vendor yang belum dikonfigurasi.
- Adapter WhatsApp hanya membaca header percakapan aktif, tidak membaca isi pesan atau internal WhatsApp API. Nomor pada header dicocokkan langsung; bila header hanya nama kontak, extension hanya memilih otomatis untuk satu kecocokan nama yang tepat. Perubahan DOM atau konteks ambigu memerlukan pencarian manual. Tidak ada pengiriman pesan otomatis.
- Lookup menormalisasi kolom telepon lama saat membaca; performa pada database pelanggan besar belum diukur.
- Fitur fase 2–4 yang belum termasuk: enable/disable WiFi, isolir, grafik/pemakaian data, diagnosis, balasan WhatsApp, tiket, outage, dan AI.
- Unit/integration test memakai database dan provider tiruan, sehingga tidak menjalankan tindakan perangkat nyata. Pengujian MySQL, login WhatsApp nyata, serta ping/reboot ONU nyata tetap diperlukan di lingkungan uji sebelum dipakai operasional.

Smoke test operasional: login admin; login operator tanpa izin (harus ditolak); buka nomor dikenali/tidak dikenali;
berpindah chat saat data sedang dimuat (pelanggan lama harus hilang); tutup panel (traffic berhenti);
matikan akses ACS (network tetap tersedia); batalkan restart (tidak ada task); konfirmasi restart pada ONU uji
(audit `QUEUED`); cabut permission (API langsung menolak).

Uji UI otomatis opsional tersedia di `tests/wa-extension/browser-smoke.mjs`. Uji ini menjalankan halaman tiruan
di browser headless dan menyuntikkan bundle content script dengan transport API tiruan; bukan login WhatsApp
atau pengujian permission browser extension sungguhan. Install Playwright terpisah bila diperlukan, lalu set
`WA_NOC_PLAYWRIGHT_MODULE` ke URL file modul Playwright dan `WA_NOC_BROWSER` ke executable Chrome/Edge.
Jalankan `node tests/wa-extension/browser-smoke.mjs` dari root proyek setelah build extension.
Output screenshot berada di `.tmp-wa-noc-validation/sidebar.png`.
