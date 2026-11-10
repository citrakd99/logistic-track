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
  // item yang ditautkan: dari detail item → item itu; dari PR → item dengan No. SJ sama; selain itu semua item PR
  var targetItems = pStr_(b.items);
  try {
    if (!targetItems) {
      var itemsPR = loadPR_(false).items.filter(function (it) { return it.pr === keyOfPR_(prNo); });
      var bySj = sj ? itemsPR.filter(function (it) { return normT_(it.sjNo) === normT_(sj); }) : [];
      targetItems = (bySj.length ? bySj : itemsPR).map(function (it) { return it.no; }).filter(function (n) { return n !== null && n !== ''; }).join(',');
    }
  } catch (e) { /* daftar item tidak terbaca: link ditulis ke semua item PR saat rebuild */ }
  rows.forEach(function (r) { r.items = targetItems; });
  var ss = db_(); appendRows_(ss, 'FOTO_SJ', rows); bumpDataVersion_();
  var link = writeFotoLinks_(keyOfPR_(prNo));
  shareFotoWithPRTeam_(rows.map(function (r) { return r.fileId; }));
  log_(me.email, 'uploadSJ', prNo + (sj ? ' SJ ' + sj : '') + ' · ' + rows.length + ' foto → Surat Jalan/' + day + (link.ok ? ' · link di kolom V' : ' · link tidak ditulis: ' + link.reason));
  return { saved: rows.length, folder: 'LoGistic Tracking / Surat Jalan / ' + day, linkWritten: link.ok, linkNote: link.reason || '' };
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
    writeFotoLinks_(r.prKey);
    log_(me.email, 'hapusFoto', r.prNo + ' ' + r.fileName + ' (' + reason + ')');
    return { id: r.id };
  });
}

// ---------- link foto di Sheet Tracking PR (kolom V, setelah REMARKS) ----------
var FOTO_COL = 22, FOTO_HEADER = 'FOTO SJ';
/**
 * Tulis ulang kolom V untuk semua item satu PR dari daftar FOTO_SJ aktif.
 * Isi sel: "SJ 1301 (10-Nov) | SJ 1301 (10-Nov) #2" — tiap bagian bisa diklik ke file foto di Drive.
 * Membangun ulang (bukan menambah) agar foto yang dihapus ikut hilang dari sel.
 */
function writeFotoLinks_(prKey) {
  try {
    var sh = prSheetW_(), live = prLive_(sh), items = live.parsed.items.filter(function (it) { return it.pr === prKey; });
    if (!items.length) return { ok: false, reason: 'PR tidak ditemukan di Sheet' };
    var fotos = readTable_(db_(), 'FOTO_SJ').filter(function (f) { return f.prKey === prKey && f.status !== 'dihapus'; })
      .sort(function (a, b) { return (+a.uploadedAt || 0) - (+b.uploadedAt || 0); });
    return prWrite_(function () {
      var hdr = sh.getRange(live.hi + 1, FOTO_COL);
      if (!pStr_(hdr.getValue())) hdr.setValue(FOTO_HEADER);
      items.forEach(function (it) {
        var mine = fotos.filter(function (f) {
          var list = String(f.items || '').split(',').map(function (x) { return x.trim(); }).filter(Boolean);
          return !list.length || list.indexOf(String(it.no)) >= 0;
        });
        var cell = sh.getRange(live.rowOf(it), FOTO_COL);
        if (!mine.length) { if (pStr_(cell.getValue())) cell.setValue(''); return; }
        var parts = [], seen = {};
        mine.forEach(function (f) {
          var base = (f.sjNo ? 'SJ ' + f.sjNo : 'Foto') + ' (' + shortDay_(f.folder) + ')';
          seen[base] = (seen[base] || 0) + 1;
          parts.push({ text: base + (seen[base] > 1 ? ' #' + seen[base] : ''), url: f.url });
        });
        var text = parts.map(function (p) { return p.text; }).join(' | '), b2 = SpreadsheetApp.newRichTextValue().setText(text), pos = 0;
        parts.forEach(function (p) { b2.setLinkUrl(pos, pos + p.text.length, p.url); pos += p.text.length + 3; });
        cell.setRichTextValue(b2.build());
      });
      try { SpreadsheetApp.flush(); } catch (e) { }
      return { ok: true };
    });
  } catch (e) { return { ok: false, reason: e.code === 'forbidden' ? 'belum ada akses Editor ke Sheet Tracking PR' : (e.message || String(e)) }; }
}
function shortDay_(iso) { var M = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des']; var p = String(iso || '').split('-'); return p.length === 3 ? (+p[2]) + '-' + M[+p[1] - 1] : String(iso || ''); }
/** Agar link di Sheet bisa dibuka tim PR: beri akses lihat ke editor & viewer Sheet Tracking PR (file tetap tidak publik). */
function shareFotoWithPRTeam_(fileIds) {
  try {
    var f = DriveApp.getFileById(cfg_().prId), me = String(Session.getEffectiveUser().getEmail() || '').toLowerCase(), emails = {};
    var add = function (u) { try { var e = u.getEmail().toLowerCase(); if (e && e !== me) emails[e] = 1; } catch (x) { } };
    try { add(f.getOwner()); } catch (x) { }
    try { f.getEditors().forEach(add); } catch (x) { }
    try { f.getViewers().forEach(add); } catch (x) { }
    var list = Object.keys(emails).slice(0, 50);
    if (!list.length) return;
    fileIds.forEach(function (id) { try { DriveApp.getFileById(id).addViewers(list); } catch (x) { } });
  } catch (e) { /* berbagi gagal: foto tetap tersimpan & tampil di aplikasi */ }
}
