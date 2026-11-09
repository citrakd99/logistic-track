# Cara Pakai LoGistic Tracking

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

## Untuk admin

Klik **Login admin** di kanan atas.

| Tugas | Caranya |
|---|---|
| Barang keluar (habis pakai) | Stok Gudang → **Catat keluar / pinjam** → *Pemakaian* → pilih barang, jumlah, penerima → Simpan. Satu catatan bisa berisi banyak barang (**+ Tambah barang**). |
| Pinjamkan alat | Form yang sama → *Peminjaman*. Atau klik barangnya → **Pinjamkan**. |
| Alat kembali | Tab **Alat dipinjam** → **Catat kembali** → isi jumlah & kondisi. Pengembalian sebagian diperbolehkan. |
| Stock opname | Klik barang → **Koreksi stok** → isi **stok fisik** hasil hitung. Selisihnya dicatat otomatis. Alasan wajib diisi. |
| Salah input | Tab Riwayat → klik catatan → **Edit** atau **Batalkan**. Catatan lama tetap tersimpan sebagai *dibatalkan* (dicoret). |
| Barang baru (tidak ada di Master/PR) | Tab Stok → **+ Barang**. |
| Ubah kategori, stok awal, rak, minimum | Klik barang → **Edit barang**. |
| Sembunyikan barang usang | Klik barang → **Sembunyikan**. Hanya bisa jika stoknya 0 dan tidak sedang dipinjam. |
| Ganti link Google Sheet | **Pengaturan → Sumber data** → tempel link → **Uji & simpan**. Aplikasi menguji file dulu sebelum menyimpan. |
| Tambah/hapus admin, ganti password | **Pengaturan → Admin**. |

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
| *Sesi berakhir* | Sesi admin berlaku 12 jam. Login lagi. |
| *Terlalu banyak percobaan gagal* | Login salah 5 kali. Tunggu 15 menit. |
| Lupa semua password admin | Di editor Apps Script jalankan `resetAdmins`, lalu ambil kode setup baru dari log dan buat admin lagi. Data stok tidak terhapus. |
| Data PR tidak berubah setelah Sheet diedit | Tekan **↻ Muat ulang** untuk membaca ulang langsung dari Sheet. |
