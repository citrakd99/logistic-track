/**
 * Konfigurasi publik LoGistic Tracking.
 * API_URL = URL Web App Apps Script (berakhiran /exec) hasil deploy folder gas/.
 * Ini bukan rahasia: keamanan ada di server (token admin). Link Google Sheet TIDAK
 * diisi di sini — admin mengaturnya dari halaman Pengaturan di aplikasi.
 * Jika dikosongkan, aplikasi meminta URL API saat dibuka (disimpan di browser itu saja).
 */
window.LT_CONFIG = {
  API_URL: '',
  // Mode sementara: selama API_URL kosong, menu membuka aplikasi lama yang sudah berjalan di claude.ai.
  // Hapus/abaikan setelah API_URL diisi.
  LEGACY: {
    pr: 'https://claude.ai/artifact/VtpFqeEBsaNYJyntoBR58p',
    stok: 'https://claude.ai/artifact/Btrs7XfhYVsY9zYaUhpaPj'
  }
};
