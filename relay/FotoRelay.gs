/**
 * LoGistic Tracking — FOTO RELAY (dipasang & di-deploy oleh akun prc.citrakd@gmail.com)
 *
 * Tujuan: foto surat jalan disimpan & DIMILIKI akun yang men-deploy script ini (kuota & kepemilikan
 * akun tersebut), di folder:  LoGistic Tracking / Surat Jalan / <yyyy-MM-dd>.
 * Aplikasi utama mengirim foto ke sini (server ke server) dengan KUNCI rahasia.
 *
 * Pasang: script.google.com (login prc.citrakd) → Proyek baru → tempel file ini + appsscript.json
 *   → jalankan fungsi setup() → salin KUNCI dari log → Terapkan → Aplikasi web
 *   (Jalankan sebagai: Saya, Akses: Siapa saja) → salin URL /exec.
 *   URL & KUNCI dimasukkan admin di aplikasi: Pengaturan → Penyimpanan foto.
 */
var RELAY_VERSION = '1.0.0';
var MAX_BYTES = 6 * 1024 * 1024, MAX_FILES = 10;

function P_() { return PropertiesService.getScriptProperties(); }
function out_(o) { return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON); }
function err_(code, msg) { var e = new Error(msg); e.code = code; throw e; }
function eq_(a, b) { a = String(a); b = String(b); if (a.length !== b.length) return false; var r = 0; for (var i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i); return r === 0; }
function tz_() { var t = ''; try { t = Session.getScriptTimeZone(); } catch (e) { } return t || 'Asia/Jakarta'; }

function doGet() { return out_({ ok: true, data: { app: 'LoGistic Foto Relay', version: RELAY_VERSION } }); }

function doPost(e) {
  try {
    var b = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    var key = P_().getProperty('RELAY_KEY');
    if (!key) err_('not_configured', 'Relay belum di-setup. Jalankan setup() di editor.');
    var c = CacheService.getScriptCache(), fails = +(c.get('fail') || 0);
    if (fails >= 30) err_('locked', 'Terlalu banyak kunci salah. Coba lagi 15 menit lagi.');
    if (!eq_(b.key || '', key)) { c.put('fail', String(fails + 1), 900); err_('unauthorized', 'Kunci relay salah.'); }
    switch (b.action) {
      case 'ping': return out_({ ok: true, data: { owner: Session.getEffectiveUser().getEmail(), version: RELAY_VERSION, root: folderPath_(['LoGistic Tracking', 'Surat Jalan']).getUrl() } });
      case 'upload': return out_({ ok: true, data: upload_(b) });
      case 'full': return out_({ ok: true, data: full_(b) });
      case 'trash': return out_({ ok: true, data: trash_(b) });
    }
    err_('invalid', 'Aksi tidak dikenal.');
  } catch (x) {
    return out_({ ok: false, code: x.code || 'server', message: x.code ? x.message : 'Kesalahan relay: ' + (x && x.message || x) });
  }
}

function folderPath_(names) {
  var p = P_(), k = 'F_' + names.join('/'), id = p.getProperty(k);
  if (id) { try { var f = DriveApp.getFolderById(id); if (!f.isTrashed()) return f; } catch (e) { } }
  var cur = DriveApp.getRootFolder();
  names.forEach(function (n) { var it = cur.getFoldersByName(n); cur = it.hasNext() ? it.next() : cur.createFolder(n); });
  p.setProperty(k, cur.getId());
  return cur;
}

/** files: [{ data: base64, mime, name }], day: yyyy-MM-dd (opsional, default hari ini), publicLink: true/false */
function upload_(b) {
  var files = Array.isArray(b.files) ? b.files : [];
  if (!files.length || files.length > MAX_FILES) err_('invalid', 'Kirim 1–' + MAX_FILES + ' foto.');
  var day = /^\d{4}-\d{2}-\d{2}$/.test(b.day || '') ? b.day : Utilities.formatDate(new Date(), tz_(), 'yyyy-MM-dd');
  var folder = folderPath_(['LoGistic Tracking', 'Surat Jalan', day]), out = [];
  files.forEach(function (f, i) {
    var bytes = Utilities.base64Decode(String(f.data || ''));
    if (!bytes.length || bytes.length > MAX_BYTES) err_('invalid', 'Foto ' + (i + 1) + ' kosong / terlalu besar.');
    var mime = /^image\/(jpeg|png|webp)$/.test(f.mime) ? f.mime : 'image/jpeg';
    var name = String(f.name || ('SJ_' + Date.now() + '_' + (i + 1) + '.jpg')).replace(/[^\w.\- ]+/g, '').slice(0, 120);
    var file = folder.createFile(Utilities.newBlob(bytes, mime, name));
    if (b.description) { try { file.setDescription(String(b.description).slice(0, 500)); } catch (e) { } }
    if (b.publicLink !== false) { try { file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW); } catch (e) { } }
    out.push({ fileId: file.getId(), url: file.getUrl(), name: name, size: bytes.length });
  });
  return { files: out, folder: day, owner: Session.getEffectiveUser().getEmail() };
}
function full_(b) {
  var f = DriveApp.getFileById(String(b.fileId || '')), blob = f.getBlob();
  return { mime: blob.getContentType(), data: Utilities.base64Encode(blob.getBytes()) };
}
function trash_(b) { DriveApp.getFileById(String(b.fileId || '')).setTrashed(true); return { fileId: b.fileId }; }

/** Jalankan SEKALI dari editor: membuat KUNCI rahasia & folder, memicu izin Drive. */
function setup() {
  var k = P_().getProperty('RELAY_KEY');
  if (!k) { k = Utilities.getUuid().replace(/-/g, '') + Utilities.getUuid().replace(/-/g, '').slice(0, 8); P_().setProperty('RELAY_KEY', k); }
  var root = folderPath_(['LoGistic Tracking', 'Surat Jalan']);
  console.log('KUNCI RELAY: ' + k);
  console.log('Folder foto: ' + root.getUrl() + ' (pemilik: ' + Session.getEffectiveUser().getEmail() + ')');
}
/** Darurat: ganti kunci (aplikasi utama harus diisi kunci baru). */
function gantiKunci() { P_().deleteProperty('RELAY_KEY'); setup(); }
