# Cara Pakai LoGistic Tracking

## PIN viewer
Jika admin mengaktifkan **PIN viewer** (Pengaturan → PIN viewer), aplikasi meminta PIN sebelum menampilkan data. PIN diingat di perangkat selama 30 hari. Jika admin mengganti PIN, semua perangkat diminta PIN baru. Admin yang login tidak perlu PIN.

## Untuk semua orang (tanpa login)

### Tracking PR
- **Kotak status di atas** (Belum Release PR → Belum PO → Belum Terkirim → Close / Cancel): klik salah satu kotak untuk menyaring item berdasarkan tahap. Klik kotak yang sama lagi untuk membatalkan filter.
- **Chip peringatan**: *Lewat tgl dibutuhkan*, *Lewat estimasi kirim*, *PR > 14 hari*, *Diterima kurang*. Klik chip untuk melihat item yang terkena.
- Klik nama PR untuk membuka daftar item, lalu klik item untuk melihat detail lengkapnya (release, PO, ETA, penerimaan, SJ).
- **Excel** mengunduh item yang sedang tampil. **Cetak / PDF** membuka dialog cetak; pilih *Simpan sebagai PDF*.
- Data PR **tidak bisa diubah di aplikasi**. Perubahan dilakukan di Google Sheet Tracking PR oleh tim logistik, lalu muncul di aplikasi begitu tombol **↻ Muat ulang** ditekan. Tanpa menekan tombol itu, data diperbarui otomatis tiap 5 menit.

### Stok Gudang
- **Stok** = stok awal (Master) + barang masuk dari PR (Qty Terima) − dipakai − dipinjam + dikembalikan ± koreksi.
- Tab **Stok**: cari barang, saring kategori, atau centang *Ada sisa PR* untuk melihat barang yang masih ditunggu kedatangannya.
- Tab **Riwayat keluar-masuk**: semua barang masuk (dari PR) dan keluar, bisa disaring per tanggal dan jenis.
- Tab **Alat dipinjam**: alat yang belum kembali. Baris merah berarti sudah dipinjam lebih dari 7 hari.
- Kategori yang diberi tanda **?** (misalnya `Material?`) ditebak dari nama barang. Admin bisa menetapkannya lewat *Edit barang*.

## Kategori barang
| Kategori | Cara keluar | Contoh |
|---|---|---|
| **Material** | *Pemakaian*: habis dipakai | kabel, baut, cat |
| **Alat** | *Peminjaman*: dipinjam lalu dikembalikan (tab Alat dipinjam) | bor, gerinda, theodolite |
| **APD** | *Serah APD*: diserahkan ke pekerja, tidak kembali, nama penerima wajib | sepatu safety, helm, sarung tangan, rompi |

Kategori ditentukan dari kolom **Kategori** di tab MASTER (dropdown `Material` / `Alat` / `APD`). Kalau kolom itu kosong, kategori ditebak dari nama barang dan diberi tanda **?**.

**Tab MASTER adalah sumber utama.** Perubahan kategori, stok awal, rak, minimum, dan catatan dari aplikasi (Koreksi kategori, Edit barang, + Barang) **langsung ditulis ke tab MASTER**. Barang yang belum ada di MASTER (misalnya baru datang dari PR) otomatis ditambahkan sebagai baris baru. Sebaliknya, perubahan langsung di Sheet MASTER juga terbaca di aplikasi setelah **↻ Muat ulang**.

## Untuk admin

Klik **Login admin** di kanan atas.

| Tugas | Caranya |
|---|---|
| Barang keluar (habis pakai) | Stok Gudang → **Catat keluar** → *Pemakaian* (jenis otomatis mengikuti kategori barang pertama) → pilih barang, jumlah, penerima → Simpan. Satu catatan bisa berisi banyak barang (**+ Tambah barang**). |
| Pinjamkan alat | Form yang sama → *Peminjaman*. Atau klik barangnya → **Pinjamkan**. |
| Alat kembali | Tab **Alat dipinjam** → **Catat kembali** → isi jumlah & kondisi. Pengembalian sebagian diperbolehkan. |
| Stock opname | Klik barang → **Koreksi stok** → isi **stok fisik** hasil hitung. Selisihnya dicatat otomatis. Alasan wajib diisi. |
| Salah input | Tab Riwayat → klik catatan → **Edit** atau **Batalkan**. Catatan lama tetap tersimpan sebagai *dibatalkan* (dicoret). |
| Barang baru (tidak ada di Master/PR) | Tab Stok → **+ Barang**. |
| **Koreksi kategori cepat** | Tab Stok → **Koreksi kategori** → ketuk Material / Alat / APD di tiap baris (langsung tersimpan). Untuk banyak barang: cari dulu (misalnya "sepatu") lalu **Semua → APD**. Pilihan filter *Belum pasti (tebakan)* menampilkan barang yang kategorinya masih tebakan. |
| Serahkan APD ke pekerja | Klik barang APD → **Serahkan APD**, atau **Catat keluar** → *Serah APD* → isi nama pekerja & jabatan/area. |
| Ubah kategori, stok awal, rak, minimum | Klik barang → **Edit barang**. |
| Sembunyikan barang usang | Klik barang → **Sembunyikan**. Hanya bisa jika stoknya 0 dan tidak sedang dipinjam. |
| Batasi siapa yang bisa melihat | **Pengaturan → PIN viewer** → isi PIN 6–12 digit → **Aktifkan PIN**. Bagikan PIN hanya ke tim. |
| Ganti link Google Sheet | **Pengaturan → Sumber data** → tempel link → **Uji & simpan**. Aplikasi menguji file dulu sebelum menyimpan. |
| Tambah/hapus admin, ganti password | **Pengaturan → Admin**. |

### Konfirmasi sebelum menyimpan
Setiap aksi yang mengubah data (catat keluar / pinjam / serah APD, kembali, koreksi stok, edit & batalkan catatan, edit / tambah / sembunyikan barang, ubah kategori massal, PIN, hapus admin) menampilkan **ringkasan untuk dicek** dulu. Data baru tersimpan setelah **Ya, simpan** ditekan. **Batal** atau tombol Esc kembali ke form tanpa menyimpan. Koreksi kategori per baris (satu ketukan) tetap langsung tersimpan agar cepat.

### Aturan yang dijaga server
- Barang keluar atau dipinjam **tidak boleh melebihi stok tersedia**. Pesan error menyebut sisa stoknya.
- Pengembalian tidak boleh melebihi jumlah yang dipinjam.
- Catatan pinjam yang sudah punya pengembalian tidak bisa dibatalkan. Batalkan pengembaliannya dulu.
- Koreksi wajib diberi alasan. Pembatalan juga wajib diberi alasan.
- Semua aksi admin tercatat di tab **LOG** pada Data Sheet (waktu, email, aksi).

## Masalah umum

| Pesan | Penyebab & solusi |
|---|---|
| *Sumber data belum diatur* | Admin belum mengisi Pengaturan → Sumber data. |
| *File tidak bisa dibuka oleh akun pemilik Apps Script* | File belum dibagikan ke akun Google yang men-deploy Apps Script. Bagikan minimal sebagai *Pelihat*. |
| *Kolom "Deskripsi" tidak ditemukan* | Format Tracking PR berubah. Tab pertama (atau tab bernama `TRACKING PR`) harus memakai format log book, dengan judul kolom B = `Deskripsi`. |
| *Kolom "Nama Barang" tidak ditemukan* | Master Stok harus punya tab `MASTER` dengan judul kolom `Nama Barang · Satuan · Kategori · Stok Awal · Lokasi Rak · Stok Minimum · Catatan`. |
| *Argumen tak valid: timeZone* saat Uji & simpan | Sudah diperbaiki di v1.3.0: file yang dibuka dengan akses Pelihat tidak mengirim zona waktu. Tempel ulang `dist/LoGistic.gs` ke Apps Script lalu **Kelola deployment → Edit → Versi baru → Terapkan**. |
| Tampilan lama / fitur baru tidak muncul (versi di bawah halaman tidak sesuai) | Browser masih memakai file lama. Di laptop tekan **Ctrl+Shift+R**; di HP tutup lalu buka lagi aplikasinya. Mulai v1.5.0 setiap rilis otomatis memaksa file baru dimuat. |
| Dropdown kategori di Sheet MASTER belum ada APD | Menu Sheet **LoGistic → Pasang dropdown kategori**, atau klik **Uji & simpan** di Pengaturan. |
| *Masukkan PIN* / *PIN salah* | Minta PIN terbaru ke admin. Salah 20 kali (dari semua perangkat) → dikunci 15 menit. |
| *Sesi berakhir* | Sesi admin berlaku 12 jam. Login lagi. |
| *Terlalu banyak percobaan gagal* | Login salah 5 kali. Tunggu 15 menit. |
| Lupa semua password admin | Di editor Apps Script jalankan `resetAdmins`, lalu ambil kode setup baru dari log dan buat admin lagi. Data stok tidak terhapus. |
| Data PR tidak berubah setelah Sheet diedit | Tekan **↻ Muat ulang** untuk membaca ulang langsung dari Sheet. |
