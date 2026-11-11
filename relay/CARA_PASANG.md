# Pasang Script Foto di akun prc.citrakd (sekali, ±10 menit, lewat laptop)

Dengan script ini, foto surat jalan dari aplikasi LoGistic Tracking **disimpan dan dimiliki akun
prc.citrakd@gmail.com** (memakai kuota akun itu) di folder:

```
My Drive / LoGistic Tracking / Surat Jalan / 2026-11-11 / SJ_PR-078_1301_143205_1.jpg
```

## Langkah (login sebagai prc.citrakd@gmail.com)
1. Buka <https://script.google.com>, lalu klik **Proyek baru**. Beri nama `LoGistic Foto`.
2. Hapus isi `Code.gs`, lalu tempel **seluruh isi `relay/FotoRelay.gs`**.
3. Buka **Setelan proyek** (ikon roda gigi), centang **Tampilkan file manifes "appsscript.json"**, lalu ganti isi file itu dengan **`relay/appsscript.json`**.
4. Pilih fungsi **`setup`**, lalu klik **Jalankan** dan setujui izin Drive (*Advanced → Go to LoGistic Foto → Allow*).
   Di **Log eksekusi** akan muncul:
   - `KUNCI RELAY: xxxxxxxx…` ← **salin**, ini kunci rahasia
   - `Folder foto: https://drive.google.com/…` ← folder tempat foto disimpan
5. Klik **Terapkan → Deployment baru → jenis Aplikasi web**, lalu atur:
   - Jalankan sebagai: **Saya (prc.citrakd@gmail.com)**
   - Yang memiliki akses: **Siapa saja**
   - Klik **Terapkan**, lalu salin **URL aplikasi web** (berakhiran `/exec`).
6. Kirim **URL** dan **KUNCI** ke admin aplikasi lewat jalur pribadi (jangan di grup).

## Di aplikasi (admin)
**Pengaturan → Penyimpanan foto surat jalan** → isi URL & Kunci → **Uji & pakai**.
Akan muncul "Sekarang: Google Drive prc.citrakd@gmail.com". Kalau masih ada foto lama, klik
**Pindahkan ke Drive prc.citrakd** untuk memindahkannya.

## Keamanan
- Tanpa kunci yang benar, script menolak semua permintaan. Setelah 30 kali salah, script dikunci 15 menit.
- Kalau kunci bocor: jalankan fungsi `gantiKunci` di editor, lalu isi kunci baru di aplikasi.
- Pengaturan "Link foto bisa dibuka siapa saja yang punya link" ada di aplikasi (default: aktif).
