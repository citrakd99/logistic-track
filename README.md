# LoGistic Tracking

LoGistic Tracking adalah satu web app untuk memantau **Tracking PR** (permintaan material) dan **Stok Gudang** site.

| Peran | Login | Bisa apa |
|---|---|---|
| **Viewer** | Tidak perlu | Melihat Tracking PR, stok, riwayat keluar-masuk, alat dipinjam, dan export Excel/PDF |
| **Admin** | Email + password | Semua yang bisa dilakukan Viewer, ditambah: catat keluar/pinjam/kembali/koreksi, edit/batalkan transaksi, tambah/ubah barang, atur sumber data dan admin |

## Arsitektur

```
GitHub Pages (index.html + assets/)  ──fetch──►  Google Apps Script Web App (gas/)
                                                    │ baca  : Tracking PR (Google Sheet / .xlsx)
                                                    │ baca  : Master Stok (Google Sheet / .xlsx)
                                                    └ tulis : Data Sheet aplikasi (tab TX, ITEMS, LOG)
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
  appsscript.json          Manifest (zona waktu, Drive API v3, akses web app)
tests/                     Unit test, test integrasi (emulator Apps Script), server lokal
.github/workflows/         CI: jalankan test → deploy ke GitHub Pages
```

## Pemasangan (sekali saja, ±15 menit)

### 1. Backend: Google Apps Script
1. Buka <https://script.google.com>, lalu klik **Proyek baru**. Beri nama `LoGistic Tracking API`.
2. Di **Setelan proyek** (ikon roda gigi), centang **Tampilkan file manifes "appsscript.json"**.
3. Salin isi setiap file di folder `gas/` ke file dengan nama yang sama di editor, termasuk `appsscript.json`. Gunakan tombol **+** untuk menambah file skrip.
4. Di menu **Layanan (+)**, tambahkan **Drive API** versi **v3** (identifier `Drive`). Langkah ini dibutuhkan untuk membaca file .xlsx.
5. Pilih fungsi **`setup`**, lalu klik **Jalankan** dan setujui izin akses. Di **Log eksekusi** akan muncul `KODE SETUP ADMIN PERTAMA: XXXXXXXX`. Catat kode ini.
6. Klik **Terapkan → Deployment baru → Aplikasi web**, dengan pengaturan:
   - Jalankan sebagai: **Saya**
   - Yang memiliki akses: **Siapa saja**
7. Salin **URL aplikasi web** yang berakhiran `/exec`.

> Akun yang men-deploy Apps Script harus punya akses **lihat** ke Tracking PR dan Master Stok. Viewer tidak perlu akses ke Sheet.

### 2. Frontend: GitHub Pages
1. Isi `assets/config.js` → `API_URL: 'https://script.google.com/macros/s/…/exec'`, lalu commit.
2. Di repo GitHub, buka **Settings → Pages → Source: GitHub Actions**.
3. Push ke `main`. Workflow akan menjalankan test lalu men-deploy. Alamat situsnya: `https://<username>.github.io/<repo>/`.

### 3. Konfigurasi awal di aplikasi
1. Buka situs, lalu klik **Login admin**. Karena belum ada admin, aplikasi menampilkan form **Buat admin pertama**. Masukkan kode setup dari langkah 1.5.
2. Buka **Pengaturan → Sumber data**, lalu tempel link Tracking PR dan Master Stok. Kosongkan Data Sheet supaya dibuat otomatis. Klik **Uji & simpan**.
3. (Sekali saja) Di editor Apps Script, jalankan fungsi `seedKategoriAlatDariAppLama` untuk membawa 27 penanda kategori "Alat" dari aplikasi lama.

## Update kode backend
Setelah mengubah file di `gas/`, salin perubahannya ke editor Apps Script. Lalu buka **Terapkan → Kelola deployment → Edit (pensil) → Versi: Versi baru → Terapkan**. URL tetap sama.
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
