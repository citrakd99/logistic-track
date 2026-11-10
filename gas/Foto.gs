/**
 * Foto.gs — foto surat jalan per PR, diambil dari kamera HP.
 * File disimpan di Drive akun pemilik script: LoGistic Tracking / Surat Jalan / yyyy-MM-dd (tanggal upload).
 * File tidak dibagikan publik; viewer melihat lewat aplikasi (PIN/admin) yang mengirim gambarnya.
 */
var FOTO_MAX_FILES = 8, FOTO_MAX_BYTES = 6 * 1024 * 1024;

function folderPath_(names) {
  var p = props_(), key = 'FOLDER_' + names.join('/'), id = p.getProperty(key);
  if (id) { try { var f0 = DriveApp.getFolderById(id); if (!f0.isTrashed || !f0.isTrashed()) return f0; } catch (e) { } }
  var cur = DriveApp.getRootFolder();
  names.forEach(function (n) { var it = cur.getFoldersByName(n); cur = it.hasNext() ? it.next() : cur.createFolder(n); });
  p.setProperty(key, cur.getId());
  return cur;
}
function listFoto_() {
  try {
    return readTable_(db_(), 'FOTO_SJ').filter(function (r) { return r.status !== 'dihapus'; }).map(function (r) {
      var o = stripRow_(r); delete o.thumb; return o;
    });
  } catch (e) { return []; }
}
/** files: [{ data: base64 jpeg, thumb: base64 kecil, mime }] */
function actUploadSJ_(me, b) {
  var files = Array.isArray(b.files) ? b.files : [], prNo = pStr_(b.prNo), sj = pStr_(b.sjNo).slice(0, 40), note = pStr_(b.note).slice(0, 300);
  if (!prNo) fail_('invalid', 'No. PR wajib.');
  if (!files.length || files.length > FOTO_MAX_FILES) fail_('invalid', 'Kirim 1–' + FOTO_MAX_FILES + ' foto sekaligus.');
  var day = todayISO_(), folder = folderPath_(['LoGistic Tracking', 'Surat Jalan', day]), now = Date.now(), rows = [];
  var hhmmss = Utilities.formatDate(new Date(), tz_(), 'HHmmss'), safe = function (s) { return String(s).replace(/[^A-Za-z0-9-]+/g, ''); };
  files.forEach(function (f, i) {
    var mime = /^image\/(jpeg|png|webp)$/.test(f.mime) ? f.mime : 'image/jpeg';
    var bytes; try { bytes = Utilities.base64Decode(String(f.data || '')); } catch (e) { fail_('invalid', 'Foto ' + (i + 1) + ' rusak.'); }
    if (!bytes.length || bytes.length > FOTO_MAX_BYTES) fail_('invalid', 'Foto ' + (i + 1) + ' terlalu besar (maks 6 MB).');
    var name = 'SJ_' + safe(prNo) + (sj ? '_' + safe(sj) : '') + '_' + hhmmss + '_' + (i + 1) + (mime === 'image/png' ? '.png' : '.jpg');
    var file = folder.createFile(Utilities.newBlob(bytes, mime, name));
    try { file.setDescription('Surat jalan ' + prNo + (sj ? ' · SJ ' + sj : '') + (note ? ' · ' + note : '') + ' · diunggah ' + me.email); } catch (e) { }
    rows.push({ id: 'f' + now.toString(36) + i + Utilities.getUuid().slice(0, 4), prKey: keyOfPR_(prNo), prNo: prNo, sjNo: sj, items: pStr_(b.items).slice(0, 200),
      fileId: file.getId(), fileName: name, folder: day, url: file.getUrl(), size: bytes.length, thumb: String(f.thumb || '').slice(0, 45000),
      note: note, status: 'aktif', uploadedAt: now, uploadedBy: me.email });
  });
  var ss = db_(); appendRows_(ss, 'FOTO_SJ', rows); bumpDataVersion_();
  log_(me.email, 'uploadSJ', prNo + (sj ? ' SJ ' + sj : '') + ' · ' + rows.length + ' foto → Surat Jalan/' + day);
  return { saved: rows.length, folder: 'LoGistic Tracking / Surat Jalan / ' + day };
}
/** Thumbnail semua foto 1 PR (untuk galeri). */
function actFotoThumbs_(b) {
  var key = keyOfPR_(pStr_(b.prNo));
  return readTable_(db_(), 'FOTO_SJ').filter(function (r) { return r.prKey === key && r.status !== 'dihapus'; })
    .map(function (r) { return { id: r.id, thumb: r.thumb, sjNo: r.sjNo, note: r.note, uploadedAt: r.uploadedAt, uploadedBy: r.uploadedBy, folder: r.folder }; });
}
/** Gambar ukuran penuh (base64) — dikirim lewat script agar file Drive tetap privat. */
function actFotoFull_(b) {
  var r = readTable_(db_(), 'FOTO_SJ').filter(function (x) { return x.id === b.id && x.status !== 'dihapus'; })[0];
  if (!r) fail_('invalid', 'Foto tidak ditemukan.');
  var blob = DriveApp.getFileById(r.fileId).getBlob();
  return { id: r.id, mime: blob.getContentType(), data: Utilities.base64Encode(blob.getBytes()), name: r.fileName };
}
function actHapusFoto_(me, b) {
  var reason = pStr_(b.reason); if (!reason) fail_('invalid', 'Alasan wajib diisi.');
  return withLock_(function () {
    var ss = db_(), r = readTable_(ss, 'FOTO_SJ').filter(function (x) { return x.id === b.id; })[0];
    if (!r) fail_('invalid', 'Foto tidak ditemukan.');
    try { DriveApp.getFileById(r.fileId).setTrashed(true); } catch (e) { }
    var o = stripRow_(r); o.status = 'dihapus'; o.note = (o.note ? o.note + ' · ' : '') + 'dihapus: ' + reason;
    updateRow_(ss, 'FOTO_SJ', r._row, o);
    log_(me.email, 'hapusFoto', r.prNo + ' ' + r.fileName + ' (' + reason + ')');
    return { id: r.id };
  });
}
