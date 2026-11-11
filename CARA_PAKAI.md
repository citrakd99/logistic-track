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

### Edit Tracking PR dari aplikasi (admin)
Syarat: akun pemilik script (ahadaja@gmail.com) adalah **Editor** di Sheet Tracking PR — status terlihat di **Pengaturan → Sumber data**.
- **Edit item:** Daftar PR → buka item → **Edit item**. Kolom Cost Control (qty/sat release, balance, tgl release), Procurement (tgl PO, No. PO, estimasi kirim, supplier), Kedatangan (qty/sat terima, tgl terima, No. SJ), tgl dibutuhkan, status, remarks. Status disarankan otomatis (mis. tgl terima + qty terima → *Close*), tetap bisa diubah.
- **Edit massal:** buka PR → **Edit massal** → centang item → isi sekali (mis. Tgl terima + No. SJ untuk 1 surat jalan).
- **+ Item:** buka PR → **+ Item** — disisipkan di bawah item terakhir PR itu. **+ PR baru:** tombol di toolbar Daftar PR — nomor PR berikutnya disarankan otomatis, ditambahkan di akhir log book.
- Konfirmasi menampilkan nilai lama → baru. Jika sel yang sama sudah diubah orang lain di Sheet sejak form dibuka, penyimpanan **dibatalkan** dengan pesan nilai terbarunya (tidak menimpa pekerjaan orang lain).
- No, Deskripsi, Qty PR, Tgl PR, dan No. PR tetap diubah di Sheet (dipakai sebagai kunci item & kendala).

### Foto surat jalan
- Buka PR → **📷 Foto surat jalan** (atau dari detail item → **📷 Foto SJ**; setelah mengisi Tgl terima + No. SJ aplikasi juga menawarkan foto). Di HP tombol **Ambil / pilih foto** membuka kamera; bisa beberapa foto (maks 8 sekali kirim).
- Foto diperkecil otomatis di HP (±300–500 KB) lalu disimpan ke Google Drive: **LoGistic Tracking / Surat Jalan / <tanggal upload>** — folder per hari dibuat otomatis. Nama file: `SJ_<PR>_<No SJ>_<jam>_<n>.jpg`.
- **Drive siapa?** Default: Drive akun pemilik script. Agar foto disimpan & **dimiliki prc.citrakd**, pasang *script foto* di akun itu (panduan: `relay/CARA_PASANG.md`) lalu isi URL & kunci di **Pengaturan → Penyimpanan foto surat jalan** → *Uji & pakai*. Foto lama bisa dipindahkan dengan tombol **Pindahkan ke Drive …**.
- **Siapa yang bisa melihat:** admin & viewer (pemegang PIN) di aplikasi; link di Sheet PR / Excel bisa dibuka **siapa saja yang punya link** (bisa dimatikan di Pengaturan).
- **Link di Sheet Tracking PR:** setelah upload, link foto otomatis ditulis ke kolom **V "FOTO SJ"** (setelah REMARKS), contoh `SJ 1301 (10-Nov) | SJ 1301 (10-Nov) #2` — tiap bagian bisa diklik membuka foto di Drive. Baris yang diberi link: item yang difoto (dari detail item), atau item dengan No. SJ yang sama (dari PR), atau semua item PR jika No. SJ kosong. Foto dihapus → link ikut hilang. Tim yang punya akses ke Sheet PR otomatis diberi akses *lihat* ke file foto itu.
- Tampil di aplikasi: badge 📷 di PR, galeri, ketuk untuk ukuran penuh, **Buka di Drive ↗**. Admin bisa **Hapus** (file pindah ke Sampah Drive pemiliknya, bisa dipulihkan 30 hari).

### Kendala & action plan (Tracking PR)
Untuk item/PR yang tersendat, admin mencatat **Kenapa** (kendala) · **Apa** (action plan) · **Siapa** (PIC) · **Kapan** (tanggal komitmen).
- **PIC** dipilih dari dropdown (awal: Fitri, Aqsha, Ahad, Anggun). Pilih **+ Tambah PIC baru…** untuk mengetik nama baru, yang otomatis masuk daftar. Atur daftar (tambah / hapus / urutan) di **Pengaturan → Daftar PIC**.
- **Catat:** Daftar PR → buka item → **+ Kendala**. Untuk masalah yang menyangkut satu PR utuh (mis. budget), buka PR → **+ Kendala seluruh PR**.
- **Pantau:** menu **Kendala & action plan** — kotak *Kendala terbuka · Komitmen lewat · Jatuh tempo ≤ 3 hari · Closed*, ringkasan per PIC, cari, export Excel untuk rapat.
- **Follow-up:** klik catatan → **Follow-up** (isi hasil konfirmasi ke PIC) · **Edit** (geser tanggal wajib alasan, jumlah geser tercatat; ubah **Status** Open ↔ Closed) · **✓ Close** · **Buka lagi** (untuk yang sudah closed).
- **Close / hapus cepat:** di daftar Kendala dan di kartu kendala detail item ada tombol **✓ Close** dan **🗑** (hapus). Keduanya tetap minta konfirmasi.
- **Hapus** = baris dihapus permanen dari tab KENDALA (isi & alasan tetap tercatat di tab LOG). Pakai untuk salah input / dobel.
- Di Daftar PR, item/PR yang punya kendala diberi tanda **⚠** (merah jika komitmen sudah lewat). Chip filter *Ada kendala terbuka* / *Komitmen action lewat*.
- Viewer (pemegang PIN) bisa melihat; hanya admin yang mengisi. Data disimpan di tab **KENDALA** pada Sheet Master; riwayat setiap perubahan ada di kolom *riwayat*.

### Edit dua arah: aplikasi ⇄ Google Sheet
| Data | Dari aplikasi | Langsung di Sheet Master |
|---|---|---|
| Kendala & action plan (tab **KENDALA**) | ✔ | ✔ — dropdown *status* (open / closed / batal; isian lama "selesai" otomatis dibaca sebagai closed), *kategori*, *pic*; kolom *komitmen* berupa tanggal (klik dua kali → kalender). Baris baru cukup isi **prNo, itemNo (kosong = seluruh PR), kategori, kendala, action, pic, komitmen** — ID & riwayat terisi otomatis. Mengubah tanggal komitmen di Sheet menambah hitungan *geser*. |
| Barang (tab **MASTER**) | ✔ | ✔ — kategori, stok awal, rak, minimum, catatan; barang baru = baris baru |
| Transaksi stok (TX), ITEMS, LOG, PR_DATA | ✔ | Sebaiknya jangan — Sheet memberi peringatan sebelum diedit |
| Tracking PR | ✖ (hanya dibaca) | Diedit pemilik Sheet PR |

Perubahan dari Sheet langsung terbaca aplikasi (tekan **↻ Muat ulang** jika halaman sudah terbuka). Fitur ini butuh trigger edit: otomatis terpasang saat **Uji & simpan** di Pengaturan, atau lewat menu Sheet **LoGistic → Aktifkan edit dari Sheet**.

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

## Export ke Excel
| Tombol | Isi file |
|---|---|
| **Excel** (Daftar PR) | Item yang sedang tampil (ikut filter/pencarian) + sheet *Kendala* & *Foto SJ* untuk PR tersebut |
| **Excel** (Kendala & action plan) | Daftar kendala sesuai filter |
| **Excel** (Stok) | STOK, RIWAYAT, DIPINJAM |
| **Excel lengkap** (ada di ketiga halaman) | Satu file: *Ringkasan* (status PR, kendala per PIC, stok) · Tracking PR · Kendala · Foto SJ · Stok · Riwayat · Dipinjam |

Tanggal berupa tanggal Excel (bisa diurutkan/difilter), judul kolom sudah berfilter, kolom *Link foto SJ* bisa diklik ke foto di Drive.

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
