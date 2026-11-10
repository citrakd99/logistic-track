/**
 * PrEdit.gs — admin mengedit Tracking PR langsung dari aplikasi (butuh akses Editor ke Sheet PR).
 * - Edit item: hanya sel yang berubah ditulis; lokasi baris dicari ulang saat simpan;
 *   cek bentrok (nilai di Sheet dibanding nilai yang dilihat admin saat membuka form).
 * - Tambah item ke PR yang ada (disisipkan setelah item terakhir PR itu) & tambah PR baru (di akhir log book).
 * Kolom kunci (No, Deskripsi, Qty, Sat, Tgl PR, No. PR) tidak diubah lewat edit agar tautan item/kendala aman.
 */
var PR_COLS = { no: 0, desc: 1, qty: 2, unit: 3, prDate: 4, prNo: 5, reqDate: 6, ccQty: 7, ccUnit: 8, balance: 9, releaseDate: 10, poDate: 11, poNo: 12, eta: 13, recvQty: 14, recvUnit: 15, recvDate: 16, sjNo: 17, supplier: 18, status: 19, remarks: 20 };
var PR_EDITABLE = ['reqDate', 'ccQty', 'ccUnit', 'balance', 'releaseDate', 'poDate', 'poNo', 'eta', 'recvQty', 'recvUnit', 'recvDate', 'sjNo', 'supplier', 'status', 'remarks'];
var PR_DATE_F = { prDate: 1, reqDate: 1, releaseDate: 1, poDate: 1, eta: 1, recvDate: 1 };
var PR_NUM_F = { qty: 1, ccQty: 1, recvQty: 1 };

function prSheetW_() {
  var id = cfg_().prId; if (!id) fail_('not_configured', 'Sumber Tracking PR belum diatur.');
  var ss; try { ss = SpreadsheetApp.openById(id); } catch (e) { fail_('source', 'Tracking PR tidak bisa dibuka.'); }
  var sheets = ss.getSheets();
  return sheets.filter(function (s) { return s.getName().trim().toUpperCase() === 'TRACKING PR'; })[0] || sheets[0];
}
/** Baca Sheet PR langsung (bukan salinan) + cek struktur kolom. */
function prLive_(sh) {
  var tz; try { tz = tz_(sh.getParent && sh.getParent().getSpreadsheetTimeZone()); } catch (e) { tz = tz_(); }
  var vals = sh.getDataRange().getValues().map(function (r) { return r.map(function (v) { return isDate_(v) ? Utilities.formatDate(v, tz, 'yyyy-MM-dd') : v; }); });
  var hi = findHeaderRow_(vals);
  if (hi < 0) fail_('shape', 'Tracking PR: kolom "Deskripsi" tidak ditemukan.');
  var h = vals[hi];
  if (!/pr/i.test(String(h[PR_COLS.prNo])) || !/status/i.test(String(h[PR_COLS.status])) || !/supplier/i.test(String(h[PR_COLS.supplier])))
    fail_('shape', 'Struktur kolom Tracking PR berubah (No. PR di kolom F, SUPPLIER di S, STATUS di T). Edit dibatalkan agar data tidak tertulis ke kolom yang salah.');
  var parsed = parsePR_(vals.slice(hi + 1), todayISO_());
  return { vals: vals, hi: hi, parsed: parsed, rowOf: function (it) { return hi + 2 + it.r; } };
}
/** Bisakah akun pemilik script menulis ke Sheet PR? */
function prCanWrite_() {
  var id = cfg_().prId; if (!id) return false;
  try {
    var f = DriveApp.getFileById(id), me = String(Session.getEffectiveUser().getEmail() || '').toLowerCase();
    try { if (f.getOwner() && f.getOwner().getEmail().toLowerCase() === me) return true; } catch (e) { }
    try { if (f.getEditors().some(function (u) { return u.getEmail().toLowerCase() === me; })) return true; } catch (e) { }
    try { if (f.getSharingPermission() === DriveApp.Permission.EDIT && f.getSharingAccess() !== DriveApp.Access.PRIVATE) return true; } catch (e) { }
    return false;
  } catch (e) { return false; }
}
var PR_NO_ACCESS = 'Akun pemilik script belum menjadi Editor di Sheet Tracking PR. Minta pemilik Sheet (prc.citrakd) memberi akses Editor.';
/** Jalankan penulisan; error izin dari Google diterjemahkan menjadi pesan yang jelas. */
function prWrite_(fn) {
  try { return fn(); } catch (e) {
    if (e && e.code) throw e;
    if (/permission|izin|access|akses|denied|ditolak/i.test(String(e && e.message))) fail_('forbidden', PR_NO_ACCESS);
    throw e;
  }
}
function requirePRWrite_() { /* izin dicek saat menulis (prWrite_) karena akses lewat link tidak selalu terdeteksi */ }

function normCmp_(f, v) {
  if (v === null || v === undefined) return '';
  if (PR_NUM_F[f]) { var n = pNum_(v); return n === null ? String(v).trim() : String(n); }
  return String(v).trim();
}
function cleanVal_(f, v) {
  v = v === null || v === undefined ? '' : String(v).trim();
  if (v === '') return '';
  if (PR_DATE_F[f]) { if (!isISO_(v)) fail_('invalid', 'Tanggal tidak valid untuk ' + f + '.'); return v; }
  if (PR_NUM_F[f]) { var n = pNum_(v); if (n === null || n < 0) fail_('invalid', 'Angka tidak valid untuk ' + f + '.'); return n; }
  if (f === 'status' && STATUSES.indexOf(v) < 0) fail_('invalid', 'Status harus salah satu: ' + STATUSES.join(', ') + '.');
  return v.slice(0, 300);
}
function writeCell_(sh, row, f, v) {
  var rg = sh.getRange(row, PR_COLS[f] + 1);
  if (v === '') { rg.setValue(''); return; }
  if (PR_DATE_F[f]) { var p = String(v).split('-'); rg.setNumberFormat('d-mmm').setValue(new Date(+p[0], +p[1] - 1, +p[2])); return; }
  if (PR_NUM_F[f]) { rg.setValue(+v); return; }
  rg.setNumberFormat('@').setValue(String(v));
}
function afterPRWrite_() {
  try { SpreadsheetApp.flush(); } catch (e) { }
  var p = props_(); p.deleteProperty('PR_SYNCED'); p.setProperty('PR_REV', Date.now().toString(36));
  bumpDataVersion_();
  try { loadPR_(true); } catch (e) { /* salinan diperbarui saat dibuka berikutnya */ }
}

/** changes: [{ id, fields:{f:nilaiBaru}, orig:{f:nilaiYangDilihat} }] (1–100 item). */
function actEditPR_(me, b) {
  var changes = Array.isArray(b.changes) ? b.changes : [];
  if (!changes.length || changes.length > 100) fail_('invalid', 'Pilih 1–100 item.');
  requirePRWrite_();
  return withLock_(function () {
    var sh = prSheetW_(), live = prLive_(sh), byId = {}, conflicts = [], plan = [];
    live.parsed.items.forEach(function (it) { byId[it.id] = it; });
    changes.forEach(function (c) {
      var it = byId[c.id];
      if (!it) fail_('conflict', 'Item tidak ditemukan lagi di Sheet (mungkin diubah/dihapus orang lain). Muat ulang lalu coba lagi.');
      Object.keys(c.fields || {}).forEach(function (f) {
        if (PR_EDITABLE.indexOf(f) < 0) fail_('invalid', 'Kolom ' + f + ' tidak bisa diedit dari aplikasi.');
        var nv = cleanVal_(f, c.fields[f]);
        if (c.orig && f in c.orig && normCmp_(f, c.orig[f]) !== normCmp_(f, it[f]))
          conflicts.push(it.prNo + ' item ' + (it.no || '?') + ' · ' + f + ': di Sheet sekarang "' + (it[f] === null ? '' : it[f]) + '"');
        if (normCmp_(f, nv) !== normCmp_(f, it[f])) plan.push({ row: live.rowOf(it), f: f, v: nv, it: it, old: it[f] });
      });
    });
    if (conflicts.length) fail_('conflict', 'Data sudah diubah orang lain di Sheet sejak form dibuka:\n' + conflicts.slice(0, 8).join('\n') + '\nMuat ulang lalu ulangi edit.');
    prWrite_(function () { plan.forEach(function (p) { writeCell_(sh, p.row, p.f, p.v); }); });
    if (plan.length) afterPRWrite_();
    log_(me.email, 'editPR', plan.map(function (p) { return p.it.prNo + '#' + p.it.no + ' ' + p.f + ': ' + (p.old === null ? '' : p.old) + ' → ' + p.v; }).join('; ').slice(0, 480));
    return { updated: plan.length };
  });
}

function cleanNewItems_(items) {
  if (!Array.isArray(items) || !items.length || items.length > 50) fail_('invalid', 'Isi 1–50 item.');
  return items.map(function (x, i) {
    var desc = pStr_(x.desc).slice(0, 300), qty = pNum_(x.qty), unit = pStr_(x.unit).slice(0, 30);
    if (!desc) fail_('invalid', 'Item ' + (i + 1) + ': deskripsi wajib.');
    if (qty === null || !(qty > 0)) fail_('invalid', 'Item ' + (i + 1) + ': qty harus angka > 0.');
    if (!unit) fail_('invalid', 'Item ' + (i + 1) + ': satuan wajib.');
    var spec = pStr_(x.spec).split(/\n+/).map(function (s) { return s.trim(); }).filter(Boolean).slice(0, 10);
    return { desc: desc, qty: qty, unit: unit, spec: spec };
  });
}
function blankRow_() { var r = []; for (var i = 0; i < 21; i++) r.push(''); return r; }
function isoToDate_(v) { if (!isISO_(v)) return ''; var p = v.split('-'); return new Date(+p[0], +p[1] - 1, +p[2]); }
function itemRows_(items, startNo, prNo, prDate, reqDate) {
  var rows = [];
  items.forEach(function (x, i) {
    var r = blankRow_(); r[0] = startNo + i; r[1] = x.desc; r[2] = x.qty; r[3] = x.unit; r[4] = prDate; r[5] = prNo; r[6] = reqDate; r[19] = 'Belum Release PR';
    rows.push(r);
    x.spec.forEach(function (s) { var sr = blankRow_(); sr[1] = '- ' + s.replace(/^-\s*/, ''); rows.push(sr); });
  });
  return rows;
}
function writeBlock_(sh, startRow, rows, fmtSrcRow) {
  sh.getRange(startRow, 1, rows.length, 21).setValues(rows);
  try { if (fmtSrcRow) sh.getRange(fmtSrcRow, 1, 1, 21).copyTo(sh.getRange(startRow, 1, rows.length, 21), SpreadsheetApp.CopyPasteType.PASTE_FORMAT, false); } catch (e) { }
  rows.forEach(function (r, i) {
    [4, 6].forEach(function (c) { if (isDate_(r[c])) sh.getRange(startRow + i, c + 1).setNumberFormat('d-mmm'); });
    [1, 5].forEach(function (c) { if (r[c] !== '') sh.getRange(startRow + i, c + 1).setNumberFormat('@'); });
  });
}

/** Tambah item ke PR yang sudah ada: disisipkan setelah item terakhir PR (dan baris spesifikasinya). */
function actAddPRItems_(me, b) {
  var items = cleanNewItems_(b.items), reqIso = pStr_(b.reqDate);
  requirePRWrite_();
  return withLock_(function () {
    var sh = prSheetW_(), live = prLive_(sh), key = keyOfPR_(pStr_(b.prNo));
    var mine = live.parsed.items.filter(function (it) { return it.pr === key; });
    if (!mine.length) fail_('invalid', 'PR ' + b.prNo + ' tidak ditemukan di Sheet.');
    var last = mine.reduce(function (a, it) { return it.r > a.r ? it : a; }, mine[0]);
    var data = live.vals.slice(live.hi + 1), pos = last.r;
    while (pos + 1 < data.length && !pStr_(data[pos + 1][PR_COLS.prNo]) && /^-/.test(pStr_(data[pos + 1][PR_COLS.desc]))) pos++;
    var maxNo = mine.reduce(function (m, it) { return Math.max(m, +it.no || 0); }, 0);
    var raw = live.vals[live.rowOf(last) - 1];
    var prNoText = pStr_(raw[PR_COLS.prNo]), prDate = isoToDate_(String(raw[PR_COLS.prDate])) || raw[PR_COLS.prDate];
    var rows = itemRows_(items, maxNo + 1, prNoText, prDate, isoToDate_(reqIso) || (reqIso ? reqIso : raw[PR_COLS.reqDate]));
    var after = live.hi + 2 + pos; // baris Sheet terakhir milik PR ini
    prWrite_(function () { sh.insertRowsAfter(after, rows.length); writeBlock_(sh, after + 1, rows, live.rowOf(last)); });
    afterPRWrite_();
    log_(me.email, 'addPRItems', prNoText + ': ' + items.map(function (x) { return x.qty + ' ' + x.unit + ' ' + x.desc; }).join('; ').slice(0, 450));
    return { prNo: prNoText, added: items.length };
  });
}

/** Nomor PR berikutnya (format terbaru di Sheet: "PR-081"). */
function nextPRNo_(prs) {
  var max = 0; prs.forEach(function (p) { var m = /(\d+)\s*$/.exec(p.prNo); if (m) max = Math.max(max, +m[1]); });
  return 'PR-' + String(max + 1).padStart(3, '0');
}
function actNextPRNo_() { var sh = prSheetW_(); return { prNo: nextPRNo_(prLive_(sh).parsed.prs), canWrite: prCanWrite_() }; }

/** Tambah PR baru di akhir log book: baris kosong pemisah, item, "U/ keperluan", "Note : ...". */
function actAddPR_(me, b) {
  var items = cleanNewItems_(b.items), prDate = pStr_(b.prDate) || todayISO_(), reqIso = pStr_(b.reqDate);
  if (!isISO_(prDate)) fail_('invalid', 'Tanggal PR tidak valid.');
  if (reqIso && !isISO_(reqIso)) fail_('invalid', 'Tanggal dibutuhkan tidak valid.');
  requirePRWrite_();
  return withLock_(function () {
    var sh = prSheetW_(), live = prLive_(sh), prNo = pStr_(b.prNo) || nextPRNo_(live.parsed.prs);
    if (!/^PR/i.test(prNo)) fail_('invalid', 'No. PR harus diawali "PR" (mis. PR-081).');
    if (live.parsed.prs.some(function (p) { return p.key === keyOfPR_(prNo); })) fail_('invalid', prNo + ' sudah ada di Sheet.');
    var rows = itemRows_(items, 1, prNo, isoToDate_(prDate), reqIso ? isoToDate_(reqIso) : '');
    var purpose = pStr_(b.purpose).slice(0, 200), note = pStr_(b.note).slice(0, 300);
    if (purpose) { var u = blankRow_(); u[1] = 'U/ ' + purpose.replace(/^u\/\s*/i, ''); rows.push(u); }
    if (note) { var n = blankRow_(); n[1] = 'Note : ' + note.replace(/^note\s*:\s*/i, ''); rows.push(n); }
    var last = sh.getLastRow(), start = last + 2, need = start + rows.length - 1 - sh.getMaxRows();
    var lastItem = live.parsed.items[live.parsed.items.length - 1];
    prWrite_(function () { if (need > 0) sh.insertRowsAfter(sh.getMaxRows(), need + 20); writeBlock_(sh, start, rows, lastItem ? live.rowOf(lastItem) : null); });
    afterPRWrite_();
    log_(me.email, 'addPR', prNo + ': ' + items.length + ' item' + (purpose ? ' · U/ ' + purpose : ''));
    return { prNo: prNo, added: items.length };
  });
}
