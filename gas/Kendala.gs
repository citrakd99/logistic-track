/**
 * Kendala.gs — catatan kendala & action plan Tracking PR (hanya admin yang menulis).
 * Satu catatan = KENAPA (kendala) · APA (action) · SIAPA (PIC) · KAPAN (tanggal komitmen).
 * Disimpan di tab KENDALA (Master/Data Sheet) karena Sheet Tracking PR hanya bisa dilihat.
 * Status: open | selesai | batal. "Terlambat" dihitung di tampilan (komitmen < hari ini & open).
 */
var DEFAULT_PICS = ['Fitri', 'Aqsha', 'Ahad', 'Anggun'];
/** Daftar PIC untuk dropdown (Script Properties PIC_LIST; default 4 nama). */
function picList_() { try { var l = JSON.parse(props_().getProperty('PIC_LIST') || 'null'); return Array.isArray(l) && l.length ? l : DEFAULT_PICS.slice(); } catch (e) { return DEFAULT_PICS.slice(); } }
function savePics_(l) { props_().setProperty('PIC_LIST', JSON.stringify(l)); }
function cleanPic_(p) { return String(p || '').replace(/\s+/g, ' ').trim().slice(0, 40); }
/** Tambahkan PIC ke daftar jika belum ada (tanpa beda huruf besar/kecil). Mengembalikan nama baku. */
function ensurePic_(p) {
  var l = picList_(), hit = l.filter(function (x) { return x.toLowerCase() === p.toLowerCase(); })[0];
  if (hit) return hit;
  l.push(p); savePics_(l); return p;
}
/** Admin: atur ulang daftar PIC (tambah / hapus / urutkan). Catatan lama tidak berubah. */
function actSetPics_(me, b) {
  var seen = {}, l = (Array.isArray(b.pics) ? b.pics : []).map(cleanPic_).filter(function (p) { var k = p.toLowerCase(); if (!p || seen[k]) return false; seen[k] = 1; return true; });
  if (!l.length) fail_('invalid', 'Minimal 1 PIC.');
  if (l.length > 50) fail_('invalid', 'Maksimal 50 PIC.');
  savePics_(l); bumpDataVersion_(); log_(me.email, 'setPics', l.join(', '));
  return { picList: l };
}

var KENDALA_KAT = ['Budget/Harga', 'Approval CC', 'Vendor/Supplier', 'Spesifikasi', 'Pengiriman', 'Administrasi PO', 'Lainnya'];

function listKendala_() {
  try {
    return readTable_(db_(), 'KENDALA').map(stripRow_).filter(function (k) { return k.status !== 'batal'; });
  } catch (e) { return []; } // Data Sheet belum diatur: Tracking PR tetap tampil
}
function stamp_() { return Utilities.formatDate(new Date(), tz_(), 'yyyy-MM-dd HH:mm'); }
function addRiwayat_(row, me, text) { row.riwayat = (String(row.riwayat || '') + '\n' + stamp_() + ' · ' + me.email.split('@')[0] + ': ' + text).trim().slice(-4000); }

/** Buat / ubah catatan kendala. Ubah tanggal komitmen wajib alasan → geser+1 & masuk riwayat. */
function actSaveKendala_(me, b) {
  var kendala = pStr_(b.kendala).slice(0, 500), action = pStr_(b.rencana).slice(0, 500), pic = cleanPic_(b.pic), komitmen = pStr_(b.komitmen);
  var kategori = KENDALA_KAT.indexOf(b.kategori) >= 0 ? b.kategori : 'Lainnya';
  if (!kendala) fail_('invalid', 'Isi kendala (kenapa) wajib diisi.');
  if (!action) fail_('invalid', 'Action plan (apa yang dilakukan) wajib diisi.');
  if (!pic) fail_('invalid', 'PIC (siapa) wajib diisi.');
  if (!isISO_(komitmen)) fail_('invalid', 'Tanggal komitmen (kapan) wajib diisi.');
  pic = ensurePic_(pic); // PIC baru otomatis masuk daftar dropdown
  return withLock_(function () {
    var ss = db_(), rows = readTable_(ss, 'KENDALA'), now = Date.now();
    if (b.id) {
      var old = rows.filter(function (r) { return r.id === b.id; })[0];
      if (!old) fail_('invalid', 'Catatan kendala tidak ditemukan.');
      var r = stripRow_(old), changes = [];
      if (String(r.komitmen) !== komitmen) {
        var alasan = pStr_(b.alasanGeser);
        if (!alasan) fail_('invalid', 'Tanggal komitmen berubah: alasan wajib diisi.');
        changes.push('komitmen ' + (r.komitmen || '-') + ' → ' + komitmen + ' (' + alasan + ')');
        r.geser = (+r.geser || 0) + 1;
      }
      if (r.pic !== pic) changes.push('PIC ' + r.pic + ' → ' + pic);
      if (r.action !== action) changes.push('action diubah');
      if (r.kendala !== kendala) changes.push('kendala diubah');
      if (r.kategori !== kategori) changes.push('kategori ' + r.kategori + ' → ' + kategori);
      Object.assign(r, { kategori: kategori, kendala: kendala, action: action, pic: pic, komitmen: komitmen, updatedAt: now, updatedBy: me.email });
      if (changes.length) addRiwayat_(r, me, changes.join('; '));
      updateRow_(ss, 'KENDALA', old._row, r);
      log_(me.email, 'editKendala', r.prNo + ' ' + changes.join('; '));
      return { id: r.id };
    }
    var prNo = pStr_(b.prNo);
    if (!prNo) fail_('invalid', 'No. PR wajib.');
    var n = {
      id: 'k' + now.toString(36) + Utilities.getUuid().slice(0, 4), prKey: keyOfPR_(prNo), prNo: prNo,
      itemNo: b.itemNo === '' || b.itemNo == null ? '' : String(b.itemNo), itemId: pStr_(b.itemId), itemDesc: pStr_(b.itemDesc).slice(0, 200),
      kategori: kategori, kendala: kendala, action: action, pic: pic, komitmen: komitmen, status: 'open', selesaiAt: '', followup: '', followupAt: '',
      geser: 0, riwayat: '', createdAt: now, createdBy: me.email, updatedAt: now, updatedBy: me.email
    };
    addRiwayat_(n, me, 'dibuat · PIC ' + pic + ' · komitmen ' + komitmen);
    appendRows_(ss, 'KENDALA', [n]);
    log_(me.email, 'addKendala', prNo + (n.itemNo ? ' item ' + n.itemNo : ' (seluruh PR)') + ': ' + kendala.slice(0, 80));
    return { id: n.id };
  });
}

/** Follow-up (catat progres), tandai selesai, buka lagi, atau batalkan. */
function actKendalaStatus_(me, b) {
  var op = String(b.op || ''), note = pStr_(b.note).slice(0, 500);
  if (['followup', 'selesai', 'buka', 'batal'].indexOf(op) < 0) fail_('invalid', 'Aksi kendala tidak dikenal.');
  if ((op === 'followup' || op === 'batal' || op === 'buka') && !note) fail_('invalid', op === 'followup' ? 'Isi hasil follow-up.' : 'Alasan wajib diisi.');
  return withLock_(function () {
    var ss = db_(), rows = readTable_(ss, 'KENDALA'), old = rows.filter(function (r) { return r.id === b.id; })[0];
    if (!old) fail_('invalid', 'Catatan kendala tidak ditemukan.');
    var r = stripRow_(old), now = Date.now();
    if (op === 'followup') { r.followup = note; r.followupAt = now; addRiwayat_(r, me, 'follow-up: ' + note); }
    if (op === 'selesai') { if (r.status === 'selesai') fail_('invalid', 'Sudah selesai.'); r.status = 'selesai'; r.selesaiAt = now; addRiwayat_(r, me, 'SELESAI' + (note ? ': ' + note : '')); }
    if (op === 'buka') { r.status = 'open'; r.selesaiAt = ''; addRiwayat_(r, me, 'dibuka lagi: ' + note); }
    if (op === 'batal') { r.status = 'batal'; addRiwayat_(r, me, 'dibatalkan: ' + note); }
    r.updatedAt = now; r.updatedBy = me.email;
    updateRow_(ss, 'KENDALA', old._row, r);
    log_(me.email, 'kendala:' + op, r.prNo + ' ' + note.slice(0, 80));
    return { id: r.id, status: r.status };
  });
}
