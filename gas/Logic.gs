/**
 * Logic.gs — fungsi murni (tanpa layanan Google) untuk parsing log book PR,
 * perhitungan stok, dan validasi transaksi. Diporting dari artefak lama
 * Tracking PR & Tracking Stok agar hasil hitung identik.
 * File ini juga dipakai test runner Node (tests/run-tests.js).
 */

var STATUSES = ['Belum Release PR', 'Belum PO', 'Belum Terkirim', 'Close', 'Cancel'];
var TX_TYPES = ['pakai', 'pinjam', 'kembali', 'koreksi'];
var MONI = { jan: 1, feb: 2, mar: 3, apr: 4, mei: 5, may: 5, jun: 6, jul: 7, agu: 8, agt: 8, aug: 8, sep: 9, okt: 10, oct: 10, nov: 11, des: 12, dec: 12 };
var UNIT_ALIAS = { psg: 'pasang', pasang: 'pasang', pcs: 'pcs', pc: 'pcs', buah: 'pcs', bh: 'pcs', lsn: 'lusin', lusin: 'lusin', btg: 'batang', batang: 'batang', m: 'meter', mtr: 'meter', meter: 'meter', unit: 'unit', unt: 'unit', set: 'set', roll: 'roll', rol: 'roll', ls: 'ls', lot: 'ls', box: 'box', dus: 'dus', kg: 'kg', sak: 'sak', lembar: 'lembar', lbr: 'lembar', org: 'org', orang: 'org', pack: 'pack', pak: 'pack' };
var ALAT_RE = /\b(m\/c|mesin|bor\b|gerinda|grinda|tangga|laptop|tang\b|obeng|meteran|waterpass|auto level|hammer|gergaji|palu|cutting torch|regulator|trafo|jackdrill|vibrator|gerobak|ashiba|proyektor|printer|modem|switch|hub\b|dispenser|fingerprint|tensi|ht\b|boomlift|scissor|chain ?saw|box alat|toolbox|kunci|multimeter|tester|sigmat|alat)/i;

function pad2_(n) { return String(n).padStart(2, '0'); }
function isEmpty_(v) { return v === null || v === undefined || v === ''; }
function isISO_(s) { return /^\d{4}-\d{2}-\d{2}$/.test(s || ''); }
function pStr_(v) { return isEmpty_(v) ? '' : String(v).trim(); }
function round3_(n) { return +(+n).toFixed(3); }
function normT_(s) { return String(s == null ? '' : s).toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ''); }
function unitKey_(u) { var k = String(u || '').toLowerCase().replace(/[^a-z0-9]/g, ''); return UNIT_ALIAS[k] || k; }
function stockKey_(name, unit) { return normT_(name) + '|' + unitKey_(unit); }
function keyOfPR_(p) { return String(p).trim().toUpperCase().replace(/[^A-Z0-9]+/g, '-').replace(/^-|-$/g, ''); }
function djb_(s) { var x = 5381; for (var ch of String(s)) x = ((x << 5) + x + ch.codePointAt(0)) | 0; return (x >>> 0).toString(36); }
function guessKat_(name) { return /^(mata |kawat|batu )/i.test(name) ? 'Material' : (ALAT_RE.test(name) ? 'Alat' : 'Material'); }

/** @param {*} v @param {string} today ISO tanggal hari ini (untuk tebakan tahun) */
function pDate_(v, today) {
  if (isEmpty_(v)) return ['', ''];
  var s = String(v).trim().replace(/-0kt/i, '-Okt');
  if (!s) return ['', ''];
  if (isISO_(s)) return [s, ''];
  var m = /^(\d{1,2})[-\s/]([A-Za-z]{3})[A-Za-z]*(?:[-\s/](\d{2,4}))?/.exec(s);
  if (m && MONI[m[2].toLowerCase()]) {
    var mo = MONI[m[2].toLowerCase()], d = +m[1];
    var ty = +String(today || '').slice(0, 4) || new Date().getFullYear();
    var y = m[3] ? (+m[3] < 100 ? 2000 + (+m[3]) : +m[3]) : ty;
    if (!m[3] && today && Date.parse(y + '-' + pad2_(mo) + '-' + pad2_(d)) - Date.parse(today) > 150 * 864e5) y--;
    return [y + '-' + pad2_(mo) + '-' + pad2_(d), ''];
  }
  m = /^(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{2,4})$/.exec(s);
  if (m) { var yy = +m[3] < 100 ? 2000 + (+m[3]) : +m[3]; return [yy + '-' + pad2_(m[2]) + '-' + pad2_(m[1]), '']; }
  return ['', s];
}

function pNum_(v) {
  if (isEmpty_(v)) return null;
  if (typeof v === 'number') return v;
  var t = String(v).trim();
  if (!t) return null;
  if (/^\d{1,3}(\.\d{3})+$/.test(t)) t = t.replace(/\./g, '');
  else if (/^\d{1,3}(,\d{3})+$/.test(t)) t = t.replace(/,/g, '');
  var n = Number(t.replace(',', '.'));
  return isNaN(n) ? null : n;
}

function normStatus_(s) {
  var f = STATUSES.filter(function (x) { return x.toLowerCase() === String(s).toLowerCase().replace(/\s+/g, ' ').trim(); })[0];
  return f || '';
}

function deriveStatus_(it) {
  if (isISO_(it.recvDate) || (it.sjNo && it.recvQty)) return 'Close';
  if (it.poNo || isISO_(it.poDate)) return 'Belum Terkirim';
  if (isISO_(it.releaseDate)) return 'Belum PO';
  return 'Belum Release PR';
}

/** Cari baris header log book (kolom B = "Deskripsi"). */
function findHeaderRow_(rows) {
  for (var i = 0; i < rows.length; i++) if (String(rows[i][1] == null ? '' : rows[i][1]).trim() === 'Deskripsi') return i;
  return -1;
}

/**
 * Parse log book PR 21 kolom (baris data sesudah header).
 * @return {{prs: Object[], items: Object[]}}
 */
function parsePR_(rows, today) {
  var prs = {}, prOrder = [], items = [], cur = null, last = null, seen = {};
  for (var ri = 0; ri < rows.length; ri++) {
    var r = [];
    for (var c = 0; c < 21; c++) { var v = rows[ri][c]; r.push(typeof v === 'string' ? v.trim() : (v === undefined ? '' : v)); }
    var no = r[0], desc = pStr_(r[1]), prno = pStr_(r[5]);
    if (isEmpty_(no)) { var mm = /^(\d{1,2})([A-Za-z].*)$/.exec(desc); if (mm && prno) { no = mm[1]; desc = mm[2]; } }
    if (prno) {
      if (!/^PR/i.test(prno)) continue;
      var k = keyOfPR_(prno);
      if (!prs[k]) { prs[k] = { key: k, prNo: prno, prDate: pDate_(r[4], today)[0], purpose: '', notes: '', seq: prOrder.length + 1 }; prOrder.push(k); }
      var rq = pDate_(r[6], today), rel = pDate_(r[10], today), po = pDate_(r[11], today), eta = pDate_(r[13], today), rc = pDate_(r[16], today);
      cur = {
        pr: k, prNo: prno, no: pNum_(no), desc: desc, spec: '', qty: pNum_(r[2]), unit: pStr_(r[3]),
        reqDate: rq[0], reqNote: rq[1], ccQty: pNum_(r[7]), ccUnit: pStr_(r[8]), balance: pStr_(r[9]),
        releaseDate: rel[0], poDate: po[0], poNo: pStr_(r[12]), eta: eta[0],
        recvQty: pNum_(r[14]), recvUnit: pStr_(r[15]), recvDate: rc[0], sjNo: pStr_(r[17]), supplier: pStr_(r[18]),
        status: normStatus_(pStr_(r[19])), remarks: pStr_(r[20])
      };
      var extra = [rel[1], po[1], eta[1], rc[1]].filter(Boolean);
      if (extra.length) cur.remarks = [cur.remarks].concat(extra).filter(Boolean).join('; ');
      if (!cur.status) cur.status = deriveStatus_(cur);
      items.push(cur); last = k; continue;
    }
    if (!isEmpty_(no) && desc && cur && !cur.desc) { cur.no = pNum_(no); cur.desc = desc; continue; }
    if (!desc || !last) continue;
    if (desc.charAt(0) === '-' && cur) { cur.spec = (cur.spec + '\n' + desc.replace(/^-\s*/, '')).trim(); continue; }
    var p = prs[last];
    if (/^u\//i.test(desc) && !p.purpose) p.purpose = desc.slice(2).trim();
    else p.notes = (p.notes + '\n' + desc).trim();
  }
  var out = prOrder.map(function (k) { var p = prs[k]; p.notes = p.notes.replace(/^Note\s*:\s*\n?/i, '').trim(); return p; });
  items.forEach(function (it, i) {
    var base = it.pr + '--' + (isEmpty_(it.no) ? 'x' : String(it.no).replace(/[^0-9A-Za-z.]/g, '')) + '-' + djb_(normT_(it.desc));
    seen[base] = (seen[base] || 0) + 1;
    it.id = base + (seen[base] > 1 ? '-' + seen[base] : '');
    it.seq = i + 1;
  });
  return { prs: out, items: items };
}

/** Parse tab MASTER stok (baris sesudah header "Nama Barang"). */
function parseMaster_(rows) {
  var hi = -1;
  for (var i = 0; i < rows.length; i++) if (/^nama barang$/i.test(String(rows[i][0] == null ? '' : rows[i][0]).trim())) { hi = i; break; }
  if (hi < 0) return null;
  var out = [], seen = {};
  for (var j = hi + 1; j < rows.length; j++) {
    var r = rows[j], name = pStr_(r[0]);
    if (!name) continue;
    var unit = pStr_(r[1]), key = stockKey_(name, unit);
    if (seen[key]) continue;
    seen[key] = 1;
    var kr = pStr_(r[2]).toLowerCase();
    out.push({ key: key, name: name, unit: unit, kat: kr.indexOf('alat') === 0 ? 'Alat' : (kr ? 'Material' : ''), awal: pNum_(r[3]) || 0, rak: pStr_(r[4]), min: pNum_(r[5]), note: pStr_(r[6]) });
  }
  return out;
}

/** Barang masuk (dari PR yang sudah diterima) + permintaan PR per barang. */
function prToStockFeed_(items) {
  var rows = [], req = [];
  items.forEach(function (i) {
    var cancel = i.status === 'Cancel';
    var unit = (i.recvUnit || i.unit || '').trim();
    if (!cancel && typeof i.recvQty === 'number' && i.recvQty > 0) {
      rows.push({ id: i.id, key: stockKey_(i.desc, unit), name: i.desc, unit: unit, qty: i.recvQty, date: i.recvDate || '', prNo: i.prNo, sjNo: i.sjNo, supplier: i.supplier, prQty: i.qty, prUnit: i.unit });
    }
    if (!cancel && typeof i.qty === 'number' && i.qty > 0) {
      req.push({ key: stockKey_(i.desc, unit), prNo: i.prNo, qty: i.qty, unit: i.unit, ccQty: i.ccQty, ccUnit: i.ccUnit, recvQty: typeof i.recvQty === 'number' ? i.recvQty : 0, recvUnit: i.recvUnit, status: i.status });
    }
  });
  return { rows: rows, req: req };
}

/**
 * Hitung stok. Urutan prioritas data barang: ITEMS (diubah di aplikasi) > Master > tebakan nama.
 * @param {Object[]} master hasil parseMaster_
 * @param {Object[]} overrides baris tab ITEMS
 * @param {{rows:Object[],req:Object[]}} feed hasil prToStockFeed_
 * @param {Object[]} tx baris tab TX
 */
function buildStock_(master, overrides, feed, tx) {
  var M = {};
  function get(key, name, unit) {
    if (!M[key]) M[key] = { key: key, name: name, unit: unit, kat: '', katSrc: '', awal: 0, rak: '', min: null, note: '', inMaster: false, inApp: false, hidden: false, inQty: 0, outQty: 0, loanQty: 0, retQty: 0, adj: 0, last: '', ins: [], reqs: [] };
    return M[key];
  }
  (master || []).forEach(function (m) {
    var it = get(m.key, m.name, m.unit);
    it.name = m.name; it.unit = m.unit || it.unit; it.kat = m.kat || ''; it.katSrc = m.kat ? 'master' : '';
    it.awal = m.awal || 0; it.rak = m.rak || ''; it.min = m.min; it.note = m.note || ''; it.inMaster = true;
  });
  (overrides || []).forEach(function (o) {
    if (!o.key) return;
    var it = get(o.key, o.name || '', o.unit || '');
    var full = o.full === true || String(o.full).toUpperCase() === 'TRUE';
    if (o.source === 'app') { it.inApp = true; if (o.name) it.name = o.name; if (o.unit) it.unit = o.unit; }
    if (o.kat === 'Alat' || o.kat === 'Material') { it.kat = o.kat; it.katSrc = 'app'; }
    if (full) {
      it.awal = pNum_(o.awal) || 0; it.rak = pStr_(o.rak); it.min = pNum_(o.min); it.note = pStr_(o.note);
    } else {
      if (!isEmpty_(o.awal)) it.awal = pNum_(o.awal) || 0;
      if (!isEmpty_(o.rak)) it.rak = pStr_(o.rak);
      if (!isEmpty_(o.min)) it.min = pNum_(o.min);
      if (!isEmpty_(o.note)) it.note = pStr_(o.note);
    }
    it.hidden = o.hidden === true || String(o.hidden).toUpperCase() === 'TRUE';
  });
  (feed.rows || []).forEach(function (r) {
    var it = get(r.key, r.name, r.unit);
    it.inQty += r.qty; it.ins.push(r);
    if ((r.date || '') > it.last) it.last = r.date;
  });
  (tx || []).forEach(function (t) {
    if (isVoid_(t)) return;
    var it = get(t.key, t.name, t.unit), q = +t.qty || 0;
    if (t.type === 'pakai') it.outQty += q;
    else if (t.type === 'pinjam') it.loanQty += q;
    else if (t.type === 'kembali') it.retQty += q;
    else if (t.type === 'koreksi') it.adj += q;
    if ((t.date || '') > it.last) it.last = t.date;
  });
  (feed.req || []).forEach(function (r) {
    var it = M[r.key];
    if (!it) return;
    var sameUnit = !r.recvQty || unitKey_(r.recvUnit || r.unit) === unitKey_(r.unit);
    var o = {}; for (var k in r) o[k] = r[k];
    o.sisa = sameUnit ? Math.max(0, round3_((r.qty || 0) - (r.recvQty || 0))) : null;
    it.reqs.push(o);
  });
  Object.keys(M).forEach(function (key) {
    var it = M[key];
    var units = {}; it.reqs.forEach(function (r) { units[unitKey_(r.unit)] = 1; });
    it.reqQty = it.reqs.length && Object.keys(units).length === 1 ? it.reqs.reduce(function (s, r) { return s + (r.qty || 0); }, 0) : null;
    it.reqUnit = it.reqs.length ? it.reqs[0].unit : '';
    it.sisaPR = round3_(it.reqs.reduce(function (s, r) { return s + (r.sisa || 0); }, 0));
    var withSisa = it.reqs.filter(function (r) { return r.sisa > 0; })[0];
    it.sisaUnit = withSisa ? withSisa.unit : it.reqUnit;
    it.sisaCek = it.reqs.some(function (r) { return r.sisa === null; });
    if (!it.kat) { it.kat = guessKat_(it.name); it.katSrc = 'tebakan'; }
    it.dipinjam = round3_(it.loanQty - it.retQty);
    it.stok = round3_(it.awal + it.inQty - it.outQty - it.loanQty + it.retQty + it.adj);
    it.status = it.stok <= 0 ? 'out' : (it.min != null && it.stok <= it.min ? 'low' : 'ok');
  });
  return M;
}

function isVoid_(t) { return t.void === true || String(t.void).toUpperCase() === 'TRUE'; }

/** Pinjaman yang belum kembali penuh. */
function openLoans_(tx) {
  var ret = {};
  tx.forEach(function (t) { if (!isVoid_(t) && t.type === 'kembali' && t.loanId) ret[t.loanId] = (ret[t.loanId] || 0) + (+t.qty || 0); });
  return tx.filter(function (t) { return !isVoid_(t) && t.type === 'pinjam'; })
    .map(function (t) { var o = {}; for (var k in t) o[k] = t[k]; o.returned = ret[t.id] || 0; o.sisa = round3_((+t.qty || 0) - (ret[t.id] || 0)); return o; })
    .filter(function (l) { return l.sisa > 0; })
    .sort(function (a, b) { return String(a.date || '').localeCompare(String(b.date || '')); });
}

/**
 * Validasi perubahan ledger: hitung stok sebelum & sesudah, tolak jika ada barang
 * yang jadi minus (dan lebih buruk dari sebelumnya), atau pengembalian melebihi pinjaman.
 * @return {string|null} pesan error atau null jika valid
 */
function validateLedgerChange_(master, overrides, feed, txBefore, txAfter, touchedKeys) {
  var before = buildStock_(master, overrides, feed, txBefore);
  var after = buildStock_(master, overrides, feed, txAfter);
  for (var i = 0; i < touchedKeys.length; i++) {
    var k = touchedKeys[i], a = after[k], b = before[k];
    if (!a) return 'Barang tidak ditemukan: ' + k;
    var bStok = b ? b.stok : 0;
    if (a.stok < 0 && a.stok < bStok) return 'Stok "' + a.name + '" tidak cukup: tersedia ' + fmtQ_(Math.max(0, bStok)) + ' ' + a.unit + ', kurang ' + fmtQ_(-a.stok) + ' ' + a.unit + '.';
    if (a.dipinjam < 0) return 'Jumlah kembali "' + a.name + '" melebihi jumlah yang dipinjam.';
  }
  var ret = {}, loans = {};
  txAfter.forEach(function (t) {
    if (isVoid_(t)) return;
    if (t.type === 'pinjam') loans[t.id] = +t.qty || 0;
    if (t.type === 'kembali') ret[t.loanId] = (ret[t.loanId] || 0) + (+t.qty || 0);
  });
  for (var lid in ret) {
    if (!(lid in loans)) return 'Catatan pinjam untuk pengembalian ini tidak ada atau sudah dibatalkan.';
    if (ret[lid] > loans[lid] + 1e-9) return 'Jumlah dikembalikan melebihi sisa pinjaman.';
  }
  return null;
}

function fmtQ_(n) { return String(round3_(n)).replace('.', ','); }

/** Bersihkan & cek input satu transaksi. Lempar pesan jika tidak valid. */
function cleanTx_(t, stockMap) {
  var type = String(t.type || '');
  if (TX_TYPES.indexOf(type) < 0) return { error: 'Jenis transaksi tidak dikenal.' };
  var qty = pNum_(t.qty);
  if (qty === null || !isFinite(qty)) return { error: 'Jumlah harus angka.' };
  if (type === 'koreksi') { if (qty === 0) return { error: 'Koreksi tidak boleh 0.' }; }
  else if (!(qty > 0)) return { error: 'Jumlah harus lebih dari 0.' };
  var it = stockMap[t.key];
  if (!it) return { error: 'Barang tidak ditemukan di daftar stok.' };
  var date = pStr_(t.date);
  if (!isISO_(date)) return { error: 'Tanggal wajib diisi (format YYYY-MM-DD).' };
  if (type === 'kembali' && !pStr_(t.loanId)) return { error: 'Pengembalian harus merujuk catatan pinjam.' };
  if (type === 'koreksi' && !pStr_(t.reason)) return { error: 'Alasan koreksi wajib diisi.' };
  if ((type === 'pakai' || type === 'pinjam') && !pStr_(t.person)) return { error: (type === 'pinjam' ? 'Nama peminjam' : 'Nama penerima') + ' wajib diisi.' };
  return {
    tx: {
      type: type, key: it.key, name: it.name, unit: it.unit, kat: it.kat, qty: round3_(qty), date: date,
      person: pStr_(t.person).slice(0, 80), purpose: pStr_(t.purpose).slice(0, 120), cond: pStr_(t.cond).slice(0, 80),
      note: pStr_(t.note).slice(0, 300), loanId: pStr_(t.loanId), reason: pStr_(t.reason).slice(0, 200)
    }
  };
}

if (typeof module !== 'undefined') {
  module.exports = { pDate_, pNum_, parsePR_, parseMaster_, prToStockFeed_, buildStock_, openLoans_, validateLedgerChange_, cleanTx_, stockKey_, findHeaderRow_, isVoid_ };
}
