# PPOB reseller voucher

Portal reseller memiliki menu **PPOB** untuk produk prabayar dan pascabayar yang diaktifkan admin. Katalog dan harga mengikuti pengaturan PPOB yang sudah tersedia. Saldo menggunakan `users.balance`, sama dengan saldo pembelian voucher. Tombol Isi Saldo menggunakan top-up reseller yang sudah ada.

Riwayat, pengecekan status, dan struk tersedia di halaman PPOB. Reseller hanya dapat melihat atau memperbarui status transaksi miliknya. Daftar PPOB admin menampilkan nama dan label reseller.

## Penerapan

Jalankan migrasi database bawaan setelah memperbarui aplikasi: `npm run db:migrate` pada checkout source. Untuk instalasi release/Docker, gunakan mekanisme migrasi instalasi tersebut (`dist/backend/migrate.js` pada container aplikasi). Jika migrasi otomatis saat startup dinonaktifkan, migrasi harus dijalankan secara manual sebelum menggunakan fitur ini.

Migrasi menambah `ppob_transactions.reseller_id`, membuat `customer_id` nullable, dan membuat tabel `reseller_ppob_inquiries`. Data transaksi customer tetap menggunakan `customer_id`.

## Perilaku transaksi

- Pembelian mengunci saldo reseller dan mencatat debit sebelum menghubungi provider.
- Timeout atau hasil belum pasti tetap PENDING. Gunakan Cek Status; jangan membuat pembelian pengganti.
- Kegagalan yang dikonfirmasi mengembalikan nilai debit sekali saja. Status final tidak dibuka ulang oleh callback yang terlambat.
- Pascabayar menggunakan nominal dan referensi inquiry yang disimpan server. Inquiry berlaku 15 menit, terikat pada reseller, produk, serta nomor tujuan, dan hanya dapat dibayar sekali.
- Transaksi reseller serta produk yang terkait dengan riwayatnya tidak dihapus melalui endpoint penghapusan PPOB. Nonaktifkan produk jika tidak lagi dijual.

Pengujian lokal: `node --test tests/reseller-ppob*.test.mjs`. Pengujian menggunakan database/provider tiruan; tidak melakukan pembelian Digiflazz sungguhan.
