PRD — RizkiTech WA NOC Extension

Versi: 1.0
Tanggal: 9 September 2026
Jenis: Browser Extension + Backend Integration
Target: ISP / RT-RW Net / Network Operation / Customer Service
Platform awal: Google Chrome / Microsoft Edge
Integrasi utama: WhatsApp Web, Billing ISP, MikroTik, RADIUS, GenieACS, OLT

1. Ringkasan Produk

RizkiTech WA NOC Extension adalah browser extension yang menambahkan panel informasi pelanggan dan fungsi Network Operation Center langsung pada halaman WhatsApp Web.

Tujuan utamanya adalah memungkinkan Customer Service, teknisi, dan administrator ISP melakukan pengecekan pelanggan tanpa berpindah-pindah antara WhatsApp, aplikasi billing, MikroTik, GenieACS, dan sistem monitoring jaringan.

Ketika operator membuka percakapan pelanggan di WhatsApp Web, extension mendeteksi nomor WhatsApp yang sedang aktif kemudian mencocokkannya dengan database pelanggan.

Setelah pelanggan ditemukan, sebuah sidebar ditampilkan di sisi kanan WhatsApp Web.

┌────────────────────────── WHATSAPP WEB ──────────────────────┬─────────────────────┐
│                                                             │ RIZKITECH NOC        │
│                                                             │                     │
│                   PERCAKAPAN PELANGGAN                      │ Nana Permana         │
│                                                             │ 🟢 ONLINE            │
│                                                             │                     │
│ Customer: Internet lambat                                   │ Paket: 30 Mbps       │
│                                                             │ IP: 10.10.20.15      │
│ CS: Kami cek terlebih dahulu Kak.                           │ RX: -19.8 dBm        │
│                                                             │ ACS: Online          │
│                                                             │                     │
│                                                             │ ↓ 18.2 Mbps          │
│                                                             │ ↑ 3.4 Mbps           │
│                                                             │                     │
│                                                             │ [DIAGNOSA]           │
│                                                             │ [RESTART ONU]        │
└─────────────────────────────────────────────────────────────┴─────────────────────┘

Extension berfungsi sebagai frontend tambahan, sedangkan seluruh komunikasi dengan perangkat jaringan dilakukan melalui backend ISP.

2. Latar Belakang

Customer Service ISP umumnya harus menggunakan beberapa sistem sekaligus ketika menerima laporan pelanggan.

Contohnya:

WhatsApp
    ↓
Billing
    ↓
MikroTik
    ↓
RADIUS
    ↓
GenieACS
    ↓
OLT

Ketika pelanggan mengatakan:

"Internet saya lambat."

CS harus mencari pelanggan di billing, memeriksa PPPoE, melakukan ping, mengecek traffic, memeriksa ONU, melihat optical RX dan memeriksa status ACS.

Proses tersebut membutuhkan waktu dan kemampuan teknis.

RizkiTech WA NOC Extension mengubah proses tersebut menjadi:

Pelanggan WhatsApp
        ↓
Buka Chat
        ↓
Pelanggan otomatis ditemukan
        ↓
Sidebar NOC muncul
        ↓
Status jaringan langsung terlihat
3. Tujuan Produk

Tujuan utama produk adalah mengubah WhatsApp Web menjadi Customer Service + Mini NOC Workspace.

Sistem harus memungkinkan operator:

mengenali pelanggan dari nomor WhatsApp;
melihat status internet;
melihat PPPoE aktif/nonaktif;
melihat traffic realtime;
melihat paket pelanggan;
melakukan ping;
melihat informasi ONU;
melihat status GenieACS;
melihat SSID WiFi;
melihat optical RX;
melihat OLT/PON/ONU;
melakukan restart ONU;
melakukan perubahan konfigurasi WiFi;
melihat billing/tagihan;
melakukan diagnosa otomatis;
membuat saran balasan kepada pelanggan.
4. Arsitektur Sistem

Arsitektur harus menggunakan model:

┌─────────────────────┐
│   WhatsApp Web      │
│                     │
│ Browser Extension   │
└──────────┬──────────┘
           │
           │ HTTPS / WebSocket
           ▼
┌─────────────────────────────┐
│ RizkiTech Billing Backend   │
│                             │
│ WA Extension API Gateway    │
└───────┬──────┬──────┬──────┘
        │      │      │
        ▼      ▼      ▼
      MySQL  Redis  RADIUS
        │
        ├───────────────┐
        │               │
        ▼               ▼
    MikroTik         GenieACS
                        │
                        ▼
                       ONU

        ┌───────────────────┐
        │ OLT Integration   │
        │ API/SSH/SNMP      │
        └───────────────────┘

Browser extension dilarang berkomunikasi langsung dengan MikroTik, database, GenieACS maupun OLT.

Semua komunikasi harus:

Extension
   ↓
Billing Backend
   ↓
Network Device

Hal ini untuk menghindari credential perangkat jaringan tersimpan pada browser operator.

5. Teknologi

Sesuai dengan ekosistem billing yang sudah digunakan, implementasi awal direkomendasikan menggunakan:

Browser Extension
React
TypeScript
Vite
Manifest V3
WebSocket
REST API
Backend
Node.js
Express
ES Modules
Database
MySQL
Realtime / Cache
Redis
WebSocket

Redis direkomendasikan tetapi tidak wajib pada MVP.

Network Integration
MikroTik RouterOS API
RADIUS
GenieACS NBI
OLT API
SNMP
SSH

Arsitektur ini juga memungkinkan extension menggunakan API dan modul yang sudah ada pada platform billing ISP Anda daripada membangun ulang seluruh sistem ACS/billing dari nol.

6. Browser Extension

Extension harus berjalan minimal pada:

Google Chrome
Microsoft Edge
Chromium-based browser

menggunakan:

Manifest V3

Extension aktif ketika halaman:

web.whatsapp.com

dibuka.

7. Struktur Extension

Contoh struktur:

rizkitech-wa-noc/

├── manifest.json
│
├── src/
│
├── background/
│   └── service-worker.ts
│
├── content/
│   ├── whatsapp.ts
│   ├── customer-detector.ts
│   ├── observer.ts
│   └── sidebar-injector.ts
│
├── sidebar/
│   ├── App.tsx
│   ├── Header.tsx
│   ├── CustomerCard.tsx
│   ├── StatusPanel.tsx
│   ├── TrafficPanel.tsx
│   ├── WifiPanel.tsx
│   ├── ACSPanel.tsx
│   ├── OLTPanel.tsx
│   ├── BillingPanel.tsx
│   ├── DiagnosticPanel.tsx
│   └── HistoryPanel.tsx
│
├── services/
│   ├── api.ts
│   ├── auth.ts
│   ├── websocket.ts
│   └── whatsapp.ts
│
└── assets/
8. Sidebar

Sidebar harus dapat:

Open
Close
Collapse
Expand

Posisi default:

RIGHT

Sidebar tidak boleh mengganggu fungsi utama WhatsApp Web.

Lebar rekomendasi:

320 – 400 px
9. Customer Auto Detection

Ketika operator membuka chat, extension mencoba membaca nomor pelanggan.

Contoh:

+62 822-4936-3946

Nomor dinormalisasi menjadi:

6282249363946

Extension kemudian memanggil:

GET /api/wa-extension/customer/by-phone/6282249363946
10. Customer Matching

Backend mencari nomor tersebut pada database pelanggan.

Prioritas pencarian:

WhatsApp Number
       ↓
Phone Number
       ↓
Alternative Phone
       ↓
Customer Mapping

Jika ditemukan:

Customer ID
Name
PPPoE Username
Package
ACS Device
ONU
OLT

langsung dimuat.

11. Pelanggan Tidak Ditemukan

Jika nomor tidak ditemukan:

CUSTOMER NOT FOUND

Nomor:
628123456789

[Cari pelanggan]

[Hubungkan pelanggan]

Operator dapat mencari berdasarkan:

Nama
Customer ID
Nomor HP
Username PPPoE
IP
Serial Number ONU
12. Customer Mapping

Operator dapat menghubungkan nomor WhatsApp dengan pelanggan.

Contoh:

WhatsApp:
628123456789

Customer:
Nana Permana

[ HUBUNGKAN ]

Mapping disimpan agar percakapan berikutnya otomatis dikenali.

Tabel baru dapat dibuat:

customer_whatsapp_links

Field:

id
customer_id
phone_number
is_primary
verified_by
created_at
updated_at
13. Customer Header

Bagian teratas sidebar:

NANA PERMANA
CUST-000231

🟢 ONLINE

IP
10.20.30.15

PPPoE
nana_permana

Status warna:

🟢 ONLINE
🔴 OFFLINE
🟠 ISOLATED
⚪ UNKNOWN
14. Tab Sidebar

Sidebar memiliki tab utama:

STATUS
WIFI
BILLING
HISTORY

Untuk layar sempit dapat dibuat:

STATUS | WIFI | MORE
15. Status Internet

Informasi minimal:

Internet
ONLINE

PPPoE
ACTIVE

IP
10.20.30.15

Uptime
12h 42m

Router
POP-CIOMAS

Package
30M / 30M
16. Traffic Monitoring

Sidebar menampilkan:

DOWNLOAD
↓ 18.42 Mbps

UPLOAD
↑ 3.21 Mbps

Data dapat diperbarui setiap:

2–5 detik

Tetapi extension tidak boleh melakukan polling langsung terhadap MikroTik.

17. Traffic Collector

Gunakan model:

MikroTik
   ↓
Backend
   ↓
Cache
   ↓
WebSocket
   ↓
Extension

Backend bertanggung jawab melakukan rate calculation:

currentBytes - previousBytes
----------------------------
        interval

kemudian mengubahnya menjadi:

bps
Kbps
Mbps
18. Traffic Graph

Operator dapat membuka grafik:

Mbps
50 ┤
40 ┤
30 ┤       ╭──╮
20 ┤   ╭───╯  ╰──
10 ┤───╯
 0 ┼────────────────
      60 seconds

Pilihan:

1 minute
5 minutes
15 minutes
19. Data Usage

Tampilkan:

HARI INI

Download
8.12 GB

Upload
1.62 GB

dan:

BULAN INI

Download
182 GB

Upload
37 GB
20. MikroTik Information

Informasi:

Router
PPPoE Username
Active Session
IP Address
Caller ID / MAC
Uptime
Service
Profile
Rate Limit
21. Ping Test

Tombol:

[ PERIKSA PING ]

Backend menjalankan ping melalui lokasi/router yang relevan.

Result:

PING TEST

Latency:
8 ms

Packet Loss:
0%

Status:
GOOD

Kategori dapat dibuat:

<20 ms       GOOD
20–50 ms     NORMAL
50–100 ms    HIGH
>100 ms      BAD

Threshold harus configurable.

22. GenieACS

Integrasi dilakukan melalui GenieACS NBI.

Data:

ACS
ONLINE

Last Inform
22:31:42

Manufacturer
ZTE

Model
F670L

Serial
ZTEGC123456

Software
V9.0.11
23. ACS Online Detection

Status dapat dihitung berdasarkan:

Current Time - Last Inform

Contoh default:

< 10 menit
ONLINE

10–30 menit
STALE

>30 menit
OFFLINE

Nilai threshold harus configurable.

24. Optical Information

Tampilkan:

RX ONU
-19.82 dBm

Status:

GOOD
WARNING
CRITICAL

Threshold dapat dikonfigurasi per vendor/perangkat.

Contoh:

-8 sampai -24
GOOD

-24 sampai -27
WARNING

< -27
CRITICAL

Ini hanyalah default aplikasi dan bukan nilai universal semua perangkat.

25. WiFi Information

Tab WiFi:

2.4 GHz

SSID
RIZKITECH-NANA

Status
ON

Password
••••••••••

[ 👁 ]

[ UBAH ]

dan:

5 GHz

SSID
RIZKITECH-NANA-5G

Status
ON
26. Change WiFi

Operator dengan permission tertentu dapat:

Change SSID
Change Password
Enable WiFi
Disable WiFi

Perubahan dikirim:

Extension
   ↓
Backend
   ↓
GenieACS
   ↓
ONT
27. Restart ONU

Tombol:

[ RESTART ONU ]

harus memiliki confirmation:

Restart ONU pelanggan?

Internet pelanggan akan terputus sementara.

[BATAL] [RESTART]

Backend kemudian menggunakan GenieACS task.

28. Factory Reset

Factory reset tidak ditampilkan sebagai tombol utama.

Jika tetap dibutuhkan:

More
  ↓
Advanced
  ↓
Factory Reset

Hanya role tertentu:

SUPERADMIN
NETWORK_ADMIN

dan membutuhkan confirmation tambahan.

29. OLT Integration

Informasi:

OLT
OLT-CIOMAS-01

Status
ONLINE

PON
1/1/4

ONU ID
62

Serial
ZTEGC123456
30. ONU Status

Tampilkan:

ONU
ONLINE

Uptime
2d 13h

RX
-19.8 dBm

TX
2.1 dBm

Jika OLT mendukungnya.

31. Billing

Tab Billing menampilkan:

PACKAGE
Silver 30 Mbps

PRICE
Rp xxx.xxx

STATUS
ACTIVE

DUE DATE
10 September 2026

serta:

TAGIHAN

September 2026
UNPAID
32. Isolir

Status:

CUSTOMER STATUS

🟠 ISOLATED

Operator dengan permission dapat:

[ BUKA ISOLIR ]

atau:

[ ISOLIR ]

Semua tindakan harus masuk audit log.

33. Diagnostics Engine

Fitur utama:

[ DIAGNOSA ]

Backend menjalankan pemeriksaan:

Customer status
        ↓
Billing
        ↓
PPPoE
        ↓
MikroTik
        ↓
Ping
        ↓
ACS
        ↓
OLT
        ↓
RX Power
        ↓
Traffic
34. Diagnostic Result

Contoh:

HASIL DIAGNOSA

✅ Billing Active
✅ PPPoE Online
✅ ONU Online
✅ ACS Online
✅ Ping 8 ms
⚠ RX -26.7 dBm
✅ Traffic detected

KESIMPULAN

Optical signal pelanggan lemah.

Kemungkinan:
• konektor kotor
• patchcord bermasalah
• dropcore bending
• sambungan fiber buruk

Kesimpulan harus berbasis rule yang terukur, bukan tebakan AI semata.

35. Diagnostic Rules

Contoh rule:

IF PPPoE = OFFLINE
AND ONU = ONLINE
THEN
"Periksa konfigurasi PPPoE"
IF ONU = OFFLINE
THEN
"Periksa power ONU atau jaringan fiber"
IF RX < threshold
THEN
"Optical signal lemah"
IF PPPoE = ONLINE
AND PING = HIGH
THEN
"Latency jaringan tinggi"
IF PPPoE = ONLINE
AND traffic >= package_limit
THEN
"Pelanggan sedang menggunakan bandwidth mendekati limit paket"
36. Suggested Reply

Setelah diagnosis:

[ BUAT BALASAN ]

Sistem membuat template:

Dari hasil pengecekan kami, koneksi internet
saat ini terdeteksi online.

Namun kualitas sinyal fiber terdeteksi cukup
lemah. Kami sarankan dilakukan pemeriksaan
jalur fiber di lokasi.
37. Insert Into WhatsApp

Tombol:

[ MASUKKAN KE CHAT ]

akan memasukkan teks ke composer WhatsApp.

Secara default jangan otomatis mengirim.

Operator tetap menekan tombol Send.

38. Quick Reply

Sediakan template:

Salam pembuka

Cek modem

Restart modem

Gangguan area

Teknisi dijadwalkan

Pembayaran

Isolir

Gangguan selesai

Admin dapat membuat template sendiri.

39. History

Tab:

HISTORY

menampilkan:

09 Sep 22:21
Ping test
8 ms

09 Sep 22:18
RX Warning
-26.8 dBm

08 Sep 19:31
PPPoE disconnected

08 Sep 19:34
PPPoE connected

03 Sep 12:10
ONU reboot
40. Complaint History

Jika billing memiliki complaint/ticket:

COMPLAINT HISTORY

#CMP-00124
Internet lambat
RESOLVED

#CMP-00118
WiFi tidak muncul
RESOLVED
41. Create Ticket

Operator dapat:

[ BUAT TIKET ]

Data otomatis:

Customer
PPPoE
ONU
RX
Ping
ACS
OLT
Current diagnosis

Operator hanya perlu menambahkan deskripsi.

42. Outage Detection

Fase lanjutan dapat mendeteksi:

Customer A offline
Customer B offline
Customer C offline
Customer D offline

          ↓

Same PON
1/1/4

          ↓

Possible PON Outage

Sidebar kemudian menampilkan:

⚠ POSSIBLE AREA OUTAGE

17 pelanggan pada PON 1/1/4
terdeteksi offline.

Ini akan menjadi fitur NOC yang sangat berguna.

43. Authentication

Extension tidak boleh menyimpan username/password billing secara plaintext.

Gunakan:

Access Token
Refresh Token
Device Session

Login:

Extension
   ↓
Billing Login
   ↓
Token
   ↓
Extension Session
44. Role Based Access Control

Role awal:

SUPERADMIN
ADMIN
NOC
TECHNICIAN
CUSTOMER_SERVICE
BILLING

Contoh permission:

Fitur	CS	NOC	Admin
Lihat status	✓	✓	✓
Ping	✓	✓	✓
Traffic	✓	✓	✓
RX Power	✓	✓	✓
SSID	✓	✓	✓
Ubah SSID	Opsional	✓	✓
Restart ONU	Opsional	✓	✓
Putus PPPoE	×	✓	✓
Isolir	×	Opsional	✓
Factory Reset	×	×	✓

Permission sebenarnya sebaiknya granular dan tidak hard-coded berdasarkan nama role.

45. Audit Log

Semua action penting harus dicatat.

Contoh:

user_id
customer_id
action
device
old_value
new_value
ip_address
timestamp
success
error_message

Contoh:

09-09-2026 22:31

Operator:
admin01

Customer:
Nana Permana

Action:
REBOOT_ONU

Result:
SUCCESS
46. Backend API

Namespace:

/api/wa-extension

Endpoint utama:

GET /customer/by-phone/:phone

GET /customer/:id/overview

GET /customer/:id/network

GET /customer/:id/traffic

GET /customer/:id/acs

GET /customer/:id/wifi

GET /customer/:id/olt

GET /customer/:id/billing

GET /customer/:id/history

Action:

POST /customer/:id/ping

POST /customer/:id/diagnose

POST /customer/:id/reboot

POST /customer/:id/reconnect

POST /customer/:id/isolate

POST /customer/:id/unisolate

PUT /customer/:id/wifi
47. Overview API

Endpoint paling penting:

GET /api/wa-extension/customer/:id/overview

Contoh response:

{
  "customer": {
    "id": 231,
    "name": "Nana Permana",
    "status": "active"
  },

  "package": {
    "name": "Silver",
    "download": 30,
    "upload": 30
  },

  "pppoe": {
    "username": "nana_permana",
    "online": true,
    "ip": "10.20.30.15",
    "uptime": "12h31m"
  },

  "traffic": {
    "downloadMbps": 18.42,
    "uploadMbps": 3.21
  },

  "acs": {
    "online": true,
    "rxPower": -19.8
  },

  "olt": {
    "online": true,
    "name": "OLT-CIOMAS",
    "pon": "1/1/4",
    "onu": "62"
  }
}
48. WebSocket

Realtime channel:

/ws/wa-extension

Subscription:

{
  "type": "subscribe",
  "customerId": 231
}

Server dapat mengirim:

{
  "type": "traffic",
  "downloadMbps": 18.42,
  "uploadMbps": 3.21
}
49. Database Tambahan

Tidak semua data harus membuat tabel baru.

Tabel yang disarankan:

customer_whatsapp_links

extension_sessions

extension_audit_logs

network_diagnostics

customer_network_events

quick_reply_templates
50. Security Requirement

Credential berikut tidak boleh berada di extension:

MySQL Password
MikroTik Password
RADIUS Secret
GenieACS Credential
OLT Password
SSH Key
SNMP Community

Semua berada di backend.

51. Rate Limiting

Endpoint action harus dilindungi.

Contoh:

Ping:
10 / minute / user

Restart ONU:
3 / 10 minute / customer

Diagnostic:
10 / minute

Nilai harus configurable.

52. Protection Terhadap Salah Klik

Action berisiko:

Restart ONU
Disconnect PPPoE
Isolate
Change WiFi
Factory Reset

harus menggunakan confirmation.

Untuk action sangat berisiko:

FACTORY RESET

gunakan:

Type:

RESET

to continue.
53. Handling Perubahan WhatsApp Web

Ini adalah requirement teknis penting.

WhatsApp Web dapat mengubah struktur DOM sewaktu-waktu. Karena itu detector jangan terlalu bergantung pada selector CSS yang rapuh.

Pisahkan:

WhatsApp Adapter

dari logic aplikasi.

WhatsApp Web
      ↓
WhatsApp Adapter
      ↓
Customer Detector
      ↓
Extension Core

Jika struktur WhatsApp berubah, developer cukup memperbaiki adapter.

54. Loading State

Saat membuka chat:

Mencari pelanggan...

kemudian:

Mengambil status PPPoE...
Mengambil data ACS...
Mengambil data ONU...

Jangan membuat seluruh sidebar menunggu satu integrasi lambat.

55. Partial Failure

Misalnya GenieACS mati:

Internet      ONLINE
PPPoE         ONLINE
Ping          8 ms
OLT           ONLINE
ACS           ⚠ UNAVAILABLE

Bukan:

ERROR

untuk seluruh panel.

Setiap provider harus memiliki error boundary sendiri.

56. Performance Target

Target:

Customer identification
< 1 second

Overview
< 2 seconds

Ping result
< 5 seconds

Traffic refresh
2–5 seconds

Sidebar opening
< 300 ms

Tergantung performa network/backend.

57. MVP

Versi pertama jangan langsung mengimplementasikan seluruh fitur.

MVP 1.0 harus fokus pada:

Browser Extension
WhatsApp detection
Customer matching
Manual customer search

Customer information
Package information

PPPoE status
IP address
Uptime

Traffic download/upload

Ping

ACS online/offline
Last inform

SSID

RX Power

Restart ONU

Audit log
Authentication
RBAC

Dengan ini extension sudah cukup berguna untuk operasional nyata.

58. Phase 2

Tambahkan:

OLT integration
ONU status
PON information
Optical monitoring

Billing information
Invoice
Payment status
Isolation

WiFi configuration

Traffic graph

Network history
59. Phase 3

Tambahkan:

Automatic diagnostics

Suggested WhatsApp replies

Complaint integration

Create ticket

Network event correlation

Mass outage detection

PON outage detection

Technician recommendation
60. Phase 4 — AI NOC Assistant

Tahap lanjutan dapat menggunakan AI.

Operator dapat menulis:

Kenapa internet pelanggan ini lambat?

AI menerima data terstruktur yang sudah dikumpulkan backend, misalnya:

Package: 30 Mbps
Traffic: 29.8 Mbps
Ping: 12 ms
RX: -20 dBm
PPPoE: online
ONU: online
ACS: online

kemudian menjawab:

Jaringan pelanggan terlihat normal.

Traffic download saat ini 29.8 Mbps dari
limit paket 30 Mbps.

Kemungkinan besar bandwidth sedang digunakan
mendekati kapasitas paket.

Periksa perangkat yang sedang menggunakan
bandwidth atau lakukan pengecekan traffic
per connection.

AI berfungsi sebagai lapisan interpretasi, bukan sumber kebenaran status jaringan.

61. Success Criteria

MVP dianggap berhasil apabila operator dapat membuka percakapan pelanggan dan dalam beberapa detik mengetahui:

Siapa pelanggan ini?

Paketnya apa?

Internet online?

PPPoE online?

IP berapa?

Traffic berapa?

Ping berapa?

ONU online?

ACS online?

RX bagus?

SSID apa?

tanpa meninggalkan WhatsApp Web.

62. Target UX Akhir

Pengalaman yang ingin dicapai:

Customer:
"Internet saya lambat."

              ↓

CS membuka chat

              ↓

Extension:

NANA PERMANA
🟢 INTERNET ONLINE

30 Mbps

↓ 29.7 Mbps
↑ 2.1 Mbps

Ping 8 ms
RX -19.7 dBm
ONU Online
ACS Online

              ↓

[ DIAGNOSA ]

              ↓

Bandwidth sedang digunakan
mendekati limit paket.

              ↓

[ BUAT BALASAN ]

              ↓

[ MASUKKAN KE WHATSAPP ]

Jadi extension ini bukan sekadar menampilkan data billing. Target akhirnya adalah menjadikan WhatsApp Web sebagai workspace Customer Service + Billing + NOC + ACS + OLT dalam satu layar