# LoGistic Tracking

LoGistic Tracking adalah satu web app untuk memantau **Tracking PR** (permintaan material) dan **Stok Gudang** site.

| Peran | Login | Bisa apa |
|---|---|---|
| **Viewer** | Tidak perlu | Melihat Tracking PR, stok, riwayat keluar-masuk, alat dipinjam, dan export Excel/PDF |
| **Admin** | Email + password | Semua yang bisa dilakukan Viewer, ditambah: catat keluar/pinjam/kembali/koreksi, edit/batalkan transaksi, tambah/ubah barang, atur sumber data dan admin |

## Arsitektur

```
GitHub Pages (index.html + assets/)  ──fetch──►  Apps Script (terpasang di Google Sheet Master)
                                                    │ baca  : Tracking PR (akses Pelihat) ──salin──► tab PR_DATA
                                                    │ baca  : tab MASTER
                                                    └ tulis : tab TX, ITEMS, LOG (di Master)
```

- **Link Google Sheet tidak ditulis di kode.** Admin mengisinya di menu **Pengaturan**, lalu server menyimpannya di Script Properties.
- Tracking PR dan Master Stok **hanya dibaca**. Transaksi stok ditulis ke *Data Sheet* yang dibuat otomatis oleh aplikasi.
- Stok dihitung dengan rumus: `Stok awal + Masuk dari PR − Pakai − Pinjam + Kembali ± Koreksi`. Perhitungan dan validasinya dijalankan di server, sehingga Viewer tidak bisa mengubah data walaupun memanggil API langsung.
- Transaksi bersifat *append-only*. **Edit** menandai catatan lama sebagai batal lalu menulis catatan pengganti. **Hapus** menandai catatan sebagai batal dengan alasan. Riwayat tidak pernah hilang.

## Struktur repo

```
index.html, assets/        Frontend (tanpa build step)
assets/config.js           API_URL (URL Web App Apps Script)
gas/                       Backend Apps Script — salin semua file ini ke proyek Apps Script
  Code.gs                  Router doGet/doPost, Pengaturan, setup()
  Auth.gs                  Login admin, token HMAC, manajemen admin
  Data.gs                  Baca Sheet/xlsx, cache, Data Sheet (TX/ITEMS/LOG)
  Stock.gs                 Data PR & stok, CRUD transaksi & barang
  Logic.gs                 Parser log book, hitung stok, validasi (fungsi murni)
  Seed.gs                  Migrasi 27 penanda kategori "Alat" dari aplikasi lama
dist/LoGistic.gs           Gabungan semua file gas/ (satu file untuk ditempel ke Apps Script)
  appsscript.json          Manifest (zona waktu, Drive API v3, akses web app)
tests/                     Unit test, test integrasi (emulator Apps Script), server lokal
.github/workflows/         CI: jalankan test → deploy ke GitHub Pages
```

## Mode sementara
Selama `API_URL` di `assets/config.js` masih kosong, menu **Tracking PR** dan **Stok Gudang** menampilkan tombol untuk membuka aplikasi versi sebelumnya di claude.ai (link ada di `LT_CONFIG.LEGACY`). Aplikasi versi sebelumnya membaca Google Sheet yang sama. Begitu `API_URL` diisi, aplikasi otomatis beralih ke mode penuh.

## Pemasangan (sekali saja, ±15 menit, lewat laptop/PC)

### 1. Backend: Apps Script dipasang di Google Sheet **Master**
Tracking PR milik pihak lain dan Anda hanya **Pelihat**, jadi script dipasang di **Master** (milik Anda). Script membaca Tracking PR lewat link, menyalin isinya ke tab `PR_DATA` di Master, lalu menulis transaksi stok ke tab `TX`, `ITEMS`, dan `LOG` di file Master yang sama.

1. Buka Google Sheet **Master**. Tab barangnya harus bernama `MASTER`, dengan kolom `Nama Barang · Satuan · Kategori · Stok Awal · Lokasi Rak · Stok Minimum · Catatan`.
2. Pilih menu **Ekstensi → Apps Script**.
3. Hapus isi `Code.gs`, lalu tempel **seluruh isi `dist/LoGistic.gs`**. Ini satu file gabungan dari folder `gas/`.
4. Buka **Setelan proyek** (ikon roda gigi) dan centang **Tampilkan file manifes "appsscript.json"**. Lalu buka `appsscript.json` dan ganti isinya dengan `dist/appsscript.json`.
5. Pilih fungsi **`setup`**, lalu klik **Jalankan** dan setujui izin akses. Log akan menampilkan `KODE SETUP ADMIN PERTAMA: XXXXXXXX`. Catat kode ini. Tab `TX`, `ITEMS`, dan `LOG` otomatis dibuat di Master.
6. Pilih **Terapkan → Deployment baru → jenis: Aplikasi web**, dengan pengaturan **Jalankan sebagai: Saya** dan **Akses: Siapa saja**. Salin URL yang berakhiran `/exec`.

> Akun pemilik script harus punya akses **Pelihat** ke Tracking PR. Viewer aplikasi tidak perlu akses ke Sheet mana pun.
> Script juga bisa dipasang sebagai proyek terpisah di script.google.com. Dalam mode itu, link Master dan Data Sheet diisi lewat Pengaturan.

### 2. Frontend: GitHub Pages
1. Isi `assets/config.js` → `API_URL: 'https://script.google.com/macros/s/…/exec'`, lalu commit.
2. Di repo GitHub, buka **Settings → Pages → Source: GitHub Actions**.
3. Push ke `main`. Workflow akan menjalankan test lalu men-deploy. Alamat situsnya: `https://<username>.github.io/<repo>/`.

### 3. Konfigurasi awal di aplikasi
1. Buka situs, lalu klik **Login admin**. Karena belum ada admin, aplikasi menampilkan form **Buat admin pertama**. Masukkan kode setup dari langkah 1.5.
2. Buka **Pengaturan → Sumber data**, tempel **link Tracking PR** saja, lalu klik **Uji & simpan**. Isinya langsung disalin ke tab `PR_DATA` di Master.
3. Klik **Nyalakan sinkron otomatis** supaya salinan PR diperbarui tiap 10 menit. Tombol **↻ Muat ulang** di aplikasi juga menyalin ulang jika PR berubah. Di Sheet Master juga muncul menu **LoGistic → Sinkron Tracking PR sekarang**.
4. (Sekali saja) Di editor Apps Script, jalankan fungsi `seedKategoriAlatDariAppLama` untuk membawa 27 penanda kategori "Alat" dari aplikasi lama.

## Update kode backend
Setelah mengubah file di `gas/`, jalankan `npm run bundle`, lalu tempel ulang `dist/LoGistic.gs` ke editor Apps Script. Lalu buka **Terapkan → Kelola deployment → Edit (pensil) → Versi: Versi baru → Terapkan**. URL tetap sama.
Rollback: pada menu yang sama, pilih versi sebelumnya.

## Pengembangan lokal
```bash
npm install
npm test                                  # unit + integrasi (kode gas/ asli di emulator)
node tests/run-tests.js path/ke/tracking-pr.xlsx    # uji parser dengan data nyata
npm run dev -- path/ke/tracking-pr.xlsx   # http://localhost:8787 (admin@demo.id / demo12345)
```

## Batasan yang diketahui
- Apps Script memberi jeda 1–4 detik per permintaan (*cold start*). Respons publik di-cache 60 detik, dan data sumber di-cache sampai file Sheet berubah.
- Kuota Apps Script akun gratis kira-kira 20.000 panggilan per hari. Jumlah ini cukup untuk tim di bawah 50 orang.
- Apps Script tidak menerima IP klien, jadi pembatasan laju hanya ada pada login (5 kali gagal → dikunci 15 menit per email).
- Data viewer bersifat publik bagi siapa pun yang tahu URL situs, termasuk nama supplier, no. PO, dan qty.
- Belum diuji pada beban serentak tinggi. Penulisan diserialisasi dengan `LockService`, dengan batas tunggu 20 detik.
