# RizBill Release Package

## Install Cepat

Jalankan 3 perintah ini:

```bash
git clone https://github.com/berbagibaik1202/rizbillsinglerouter.git rizbillsingle
cd rizbillsingle
bash install-vps.sh
```

Installer akan otomatis membuat `docker.env`, database, dan credential aplikasi.
Kalau kamu memakai repo build public, isi `APP_UPDATE_REPO_URL` di `docker.env` agar tombol `Update App` bisa melakukan update dari halaman Settings.
Kalau `docker.env` lama belum punya key update, jalankan ulang `bash install-vps.sh` supaya nilai dari `docker.env.example` tersinkron ke file env aktif.

Kalau pakai Nginx Proxy Manager, arahkan upstream ke `APP_INSTANCE_NAME:3002`.
Kalau akses langsung ke `IP-VPS:3002`, itu tidak akan jalan kecuali kamu menambahkan port mapping host di compose.

## Reset Total dan Build Ulang

Kalau kamu mau mematikan semua container stack ini lalu membangun ulang termasuk database MariaDB, pakai urutan berikut:

```bash
docker compose --env-file docker.env -f docker-compose.vps.yml down -v --remove-orphans
docker compose --env-file docker.env -f docker-compose.vps.yml up -d --build
```

Catatan: opsi `down -v` akan menghapus volume database, jadi semua data lama ikut terhapus.

Untuk restart/update deployment manual, pakai urutan aman ini:

```bash
git fetch origin
git reset --hard origin/release-push
git clean -fd -e docker.env -e backend/uploads -e backend/whatsapp_session
docker compose --env-file docker.env -f docker-compose.vps.yml down
docker compose --env-file docker.env -f docker-compose.vps.yml up -d --build
```

Kalau mau multi-instance, set `APP_INSTANCE_NAME`, `COMPOSE_PROJECT_NAME`, `DB_NAME`, dan `WA_SESSION_BASE_DIR` berbeda untuk tiap folder deploy.
Folder `backend/whatsapp_session` hanya dipakai sebagai fallback lokal untuk Windows atau environment tanpa `/opt`. Di VPS/Linux, sesi WhatsApp utama tetap di bawah `WA_SESSION_BASE_DIR`.
Network proxy yang dipakai adalah external network yang sama dengan NPM, dan installer akan membuatnya otomatis kalau belum ada.
Di halaman Settings ada tab `Update App` untuk menjalankan update aplikasi tanpa menghapus volume database MariaDB.
