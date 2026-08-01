# RizBill Release Package

## Skema Repo

Repo ini dipakai dalam dua jalur:

- Source utama: `https://github.com/berbagibaik1202/rizbillsinglerouter.git`
- Release/build: `https://github.com/berbagibaik1202/rizbillsinglepub.git`

Aturan pakai:

- `main` di repo source dipakai untuk kode asli dan pengembangan.
- `main` di repo release dipakai untuk hasil build yang siap deploy.
- Jangan campur source React penuh ke repo release kalau tujuanmu hanya distribusi build.

## Install Cepat

Kalau ingin pasang package release siap pakai, jalankan 3 perintah ini:

```bash
git clone https://github.com/berbagibaik1202/rizbillsinglepub.git
cd rizbillsinglepub
bash install-vps.sh
```

Installer akan otomatis membuat `docker.env`, database, dan credential aplikasi.

Kalau kamu memakai repo build public, isi `APP_UPDATE_REPO_URL` di `docker.env` agar tombol `Update App` bisa melakukan update dari halaman Settings.
Kalau `docker.env` lama belum punya key update, jalankan ulang `bash install-vps.sh` supaya nilai dari `docker.env.example` tersinkron ke file env aktif.

Kalau kamu ingin bekerja dari source utama, clone repo source lalu jalankan workflow development atau build dari sana, bukan dari repo release.

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
git fetch pub
git checkout main
git pull pub main
```

Untuk build release dari source, pakai workflow build yang sudah ada di `package.json`, lalu publish hasilnya ke repo release.

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
