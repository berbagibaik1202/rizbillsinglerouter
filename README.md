# RizBill Release Package

## Skema Repo

Repo ini dipakai sebagai satu URL dengan dua branch:

- `main` untuk source asli dan pengembangan
- `release-push` untuk hasil build siap deploy

Aturan pakai:

- Jangan campur source React penuh ke branch release kalau tujuanmu hanya distribusi build.
- Update aplikasi berjalan cukup tarik branch `release-push` dari repo yang sama.

## Install Cepat

Kalau ingin pasang package release siap pakai, jalankan 3 perintah ini:

```bash
git clone https://github.com/berbagibaik1202/rizbillsinglerouter.git rizbillsingle
cd rizbillsingle
bash install-vps.sh
```

Installer akan otomatis membuat `docker.env`, database, dan credential aplikasi.

Kalau ingin update dari UI, biarkan `APP_UPDATE_REPO_URL` mengarah ke repo ini dan `APP_UPDATE_GIT_BRANCH` ke `release-push`.
Kalau `docker.env` lama belum punya key update, jalankan ulang `bash install-vps.sh` supaya nilai dari `docker.env.example` tersinkron ke file env aktif.

Kalau kamu ingin bekerja dari source utama, clone repo ini lalu checkout branch `main`.

Kalau pakai Nginx Proxy Manager, arahkan upstream ke `APP_INSTANCE_NAME:3002`.
Kalau akses langsung ke `IP-VPS:3002`, itu tidak akan jalan kecuali kamu menambahkan port mapping host di compose.

## Alur Update

Kalau yang ingin diperbarui adalah source utama:

```bash
git fetch origin
git checkout main
git pull origin main
```

Kalau yang ingin diperbarui adalah release/build:

```bash
git fetch origin
git checkout release-push
git pull origin release-push
```

Untuk build release dari source, pakai workflow build yang sudah ada di `package.json`, lalu publish hasilnya ke branch `release-push` di repo yang sama.

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
git reset --hard origin/main
git clean -fd -e docker.env -e backend/uploads -e backend/whatsapp_session
docker compose --env-file docker.env -f docker-compose.vps.yml down
docker compose --env-file docker.env -f docker-compose.vps.yml up -d --build
```

## Backup Database Langsung

Kalau ingin backup database dari aplikasi lama di VPS lama, backup langsung dari container MariaDB milik stack lama. Cara ini tidak tergantung network ke aplikasi baru.

1. Masuk ke folder project lama di VPS lama.
2. Pastikan container MariaDB lama masih berjalan.
3. Jalankan salah satu perintah berikut:

```bash
mkdir -p backup
docker exec -i NAMA_CONTAINER_MARIADB sh -lc 'mariadb-dump -uroot -p"$MARIADB_ROOT_PASSWORD" --single-transaction --routines --events --triggers "$MARIADB_DATABASE"' > backup/backup-$(date +%F_%H%M%S).sql
```

Kalau `mariadb-dump` tidak tersedia, gunakan:

```bash
docker exec -i NAMA_CONTAINER_MARIADB sh -lc 'mysqldump -uroot -p"$MARIADB_ROOT_PASSWORD" --single-transaction --routines --events --triggers "$MARIADB_DATABASE"' > backup/backup-$(date +%F_%H%M%S).sql
```

4. Verifikasi file backup:

```bash
ls -lh backup/
```

Kalau perlu dipindahkan ke VPS lain, kirim file `.sql` itu dengan `scp`.

Kalau mau multi-instance, set `APP_INSTANCE_NAME`, `COMPOSE_PROJECT_NAME`, `DB_NAME`, dan `WA_SESSION_BASE_DIR` berbeda untuk tiap folder deploy.
Network proxy yang dipakai adalah external network yang sama dengan NPM, dan installer akan membuatnya otomatis kalau belum ada.
Di halaman Settings ada tab `Update App` untuk menjalankan update aplikasi tanpa menghapus volume database MariaDB.
