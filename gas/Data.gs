/**
 * Data.gs — akses Google Sheet: sumber PR & Master (baca saja), Data Sheet aplikasi
 * (TX, ITEMS, LOG), dan cache.
 * Link sumber disimpan di Script Properties lewat halaman Pengaturan, tidak di kode.
 */

var TABS = {
  TX: ['id', 'type', 'key', 'name', 'unit', 'kat', 'qty', 'date', 'person', 'purpose', 'cond', 'note', 'loanId', 'reason', 'createdAt', 'createdBy', 'void', 'voidReason', 'voidAt', 'voidBy', 'replaces'],
  ITEMS: ['key', 'name', 'unit', 'kat', 'awal', 'rak', 'min', 'note', 'hidden', 'full', 'source', 'updatedAt', 'updatedBy'],
  LOG: ['at', 'email', 'action', 'detail', 'result']
};
// kolom yang dipaksa teks agar Sheets tidak mengubah "3/4 inch" atau tanggal jadi nilai lain
var NUM_COLS = { TX: ['qty', 'createdAt', 'void', 'voidAt'], ITEMS: ['awal', 'min', 'hidden', 'full', 'updatedAt'], LOG: ['at'] };

function isDate_(v) { return Object.prototype.toString.call(v) === '[object Date]' && !isNaN(v.getTime()); }
function props_() { return PropertiesService.getScriptProperties(); }
function cfg_() {
  var p = props_();
  return { prId: p.getProperty('PR_ID') || '', masterId: p.getProperty('MASTER_ID') || '', dbId: p.getProperty('DB_ID') || '' };
}
function todayISO_() { return Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd'); }

function idFromUrl_(u) {
  u = String(u || '').trim();
  var m = /\/d\/([A-Za-z0-9_-]{20,})/.exec(u) || /[?&]id=([A-Za-z0-9_-]{20,})/.exec(u) || /^([A-Za-z0-9_-]{20,})$/.exec(u);
  return m ? m[1] : '';
}

// ---------- cache (dipecah per 45rb karakter, batas CacheService 100KB/kunci) ----------
function cachePut_(key, obj, ttl) {
  var s = JSON.stringify(obj), size = 45000, n = Math.ceil(s.length / size) || 1, map = {};
  if (n > 200) return;
  for (var i = 0; i < n; i++) map[key + ':' + i] = s.slice(i * size, (i + 1) * size);
  map[key] = String(n);
  try { CacheService.getScriptCache().putAll(map, ttl || 21600); } catch (e) { /* cache penuh: abaikan, data tetap dihitung */ }
}
function cacheGet_(key) {
  var c = CacheService.getScriptCache(), n = +c.get(key);
  if (!n) return null;
  var keys = []; for (var i = 0; i < n; i++) keys.push(key + ':' + i);
  var got = c.getAll(keys), parts = [];
  for (var j = 0; j < n; j++) { if (got[keys[j]] == null) return null; parts.push(got[keys[j]]); }
  try { return JSON.parse(parts.join('')); } catch (e) { return null; }
}
function dataVersion_() { return props_().getProperty('DATA_VER') || '0'; }
function bumpDataVersion_() { props_().setProperty('DATA_VER', String(Date.now())); }

// ---------- sumber (PR & Master) ----------
function fileInfo_(id, fresh) {
  var ck = 'fi:' + id;
  if (!fresh) { var c = cacheGet_(ck); if (c) return c; }
  var f;
  try { f = DriveApp.getFileById(id); } catch (e) { fail_('source', 'File tidak bisa dibuka oleh akun pemilik Apps Script. Pastikan file dibagikan ke akun itu.'); }
  var info = { id: id, name: f.getName(), mime: f.getMimeType(), updated: f.getLastUpdated().getTime(), url: f.getUrl() };
  cachePut_(ck, info, 60);
  return info;
}

/** Baca semua nilai satu tab. Google Sheet dibaca langsung; .xlsx dikonversi ke salinan sementara lalu dihapus. */
function readValues_(info, preferTab) {
  var ssId = info.id, tmpId = null;
  if (info.mime !== MimeType.GOOGLE_SHEETS) {
    if (!/spreadsheetml|ms-excel|csv/.test(info.mime)) fail_('source', '"' + info.name + '" bukan file spreadsheet.');
    var blob = DriveApp.getFileById(info.id).getBlob();
    var tmp = Drive.Files.create({ name: '_logistic_tmp_' + info.id, mimeType: MimeType.GOOGLE_SHEETS }, blob);
    ssId = tmpId = tmp.id;
  }
  try {
    var ss = SpreadsheetApp.openById(ssId), tz = ss.getSpreadsheetTimeZone();
    var sheets = ss.getSheets();
    var sh = sheets.filter(function (s) { return s.getName().trim().toUpperCase() === preferTab; })[0] || sheets[0];
    return sh.getDataRange().getValues().map(function (r) {
      return r.map(function (v) { return isDate_(v) ? Utilities.formatDate(v, tz, 'yyyy-MM-dd') : v; });
    });
  } finally {
    if (tmpId) { try { Drive.Files.remove(tmpId); } catch (e) { try { DriveApp.getFileById(tmpId).setTrashed(true); } catch (e2) { /* biarkan */ } } }
  }
}

function loadPR_(fresh) {
  var id = cfg_().prId;
  if (!id) fail_('not_configured', 'Sumber Tracking PR belum diatur admin.');
  var info = fileInfo_(id, fresh), ck = 'pr:' + id + ':' + info.updated;
  var hit = cacheGet_(ck);
  if (hit) return hit;
  var all = readValues_(info, 'TRACKING PR'), hi = findHeaderRow_(all);
  if (hi < 0) fail_('shape', 'Tracking PR: kolom "Deskripsi" tidak ditemukan. Pastikan tab pertama memakai format log book.');
  var parsed = parsePR_(all.slice(hi + 1), todayISO_());
  if (parsed.items.length < 1) fail_('shape', 'Tracking PR: tidak ada item PR yang terbaca.');
  var res = { prs: parsed.prs, items: parsed.items, source: { name: info.name, url: info.url, updated: info.updated }, readAt: Date.now() };
  cachePut_(ck, res, 21600);
  return res;
}

function loadMaster_(fresh) {
  var id = cfg_().masterId;
  if (!id) return { rows: [], source: null };
  var info = fileInfo_(id, fresh), ck = 'ms:' + id + ':' + info.updated;
  var hit = cacheGet_(ck);
  if (hit) return hit;
  var rows = parseMaster_(readValues_(info, 'MASTER'));
  if (!rows) fail_('shape', 'Master Stok: kolom "Nama Barang" tidak ditemukan di tab MASTER.');
  var res = { rows: rows, source: { name: info.name, url: info.url, updated: info.updated } };
  cachePut_(ck, res, 21600);
  return res;
}

// ---------- Data Sheet aplikasi ----------
function db_() {
  var id = cfg_().dbId;
  if (!id) fail_('not_configured', 'Data Sheet belum dibuat. Admin perlu menyimpan Pengaturan sumber data.');
  var ss = SpreadsheetApp.openById(id);
  Object.keys(TABS).forEach(function (name) { ensureTab_(ss, name, TABS[name]); });
  return ss;
}
function ensureTab_(ss, name, headers) {
  var sh = ss.getSheetByName(name);
  if (!sh) { sh = ss.insertSheet(name); }
  if (sh.getLastRow() === 0) {
    sh.getRange(1, 1, 1, headers.length).setValues([headers]).setFontWeight('bold');
    sh.setFrozenRows(1);
    headers.forEach(function (h, i) {
      if ((NUM_COLS[name] || []).indexOf(h) < 0) sh.getRange(1, i + 1, sh.getMaxRows(), 1).setNumberFormat('@');
    });
  }
  return sh;
}
function createDb_() {
  var ss = SpreadsheetApp.create('LoGistic Tracking — Data');
  Object.keys(TABS).forEach(function (name) { ensureTab_(ss, name, TABS[name]); });
  var def = ss.getSheetByName('Sheet1') || ss.getSheetByName('Lembar1');
  if (def && ss.getSheets().length > 1) ss.deleteSheet(def);
  return ss.getId();
}

function readTable_(ss, name) {
  var sh = ss.getSheetByName(name), lr = sh.getLastRow(), lc = TABS[name].length;
  if (lr < 2) return [];
  var head = sh.getRange(1, 1, 1, lc).getValues()[0], vals = sh.getRange(2, 1, lr - 1, lc).getValues();
  return vals.map(function (r, i) {
    var o = { _row: i + 2 };
    head.forEach(function (h, j) { var v = r[j]; o[h] = isDate_(v) ? Utilities.formatDate(v, Session.getScriptTimeZone(), 'yyyy-MM-dd') : v; });
    return o;
  }).filter(function (o) { return o[head[0]] !== '' && o[head[0]] !== null; });
}
function appendRows_(ss, name, objs) {
  if (!objs.length) return;
  var sh = ss.getSheetByName(name), cols = TABS[name];
  var rows = objs.map(function (o) { return cols.map(function (c) { return o[c] === undefined || o[c] === null ? '' : o[c]; }); });
  var start = sh.getLastRow() + 1, need = start + rows.length - 1 - sh.getMaxRows();
  if (need > 0) sh.insertRowsAfter(sh.getMaxRows(), need + 100); // baris baru mewarisi format teks baris di atasnya
  sh.getRange(start, 1, rows.length, cols.length).setValues(rows);
}
function updateRow_(ss, name, rowIndex, obj) {
  var sh = ss.getSheetByName(name), cols = TABS[name];
  sh.getRange(rowIndex, 1, 1, cols.length).setValues([cols.map(function (c) { return obj[c] === undefined || obj[c] === null ? '' : obj[c]; })]);
}
function log_(email, action, detail, result) {
  try {
    var id = cfg_().dbId; if (!id) return;
    appendRows_(SpreadsheetApp.openById(id), 'LOG', [{ at: new Date(), email: email || '-', action: action, detail: String(detail || '').slice(0, 500), result: result || 'ok' }]);
  } catch (e) { /* log gagal tidak boleh menggagalkan aksi */ }
}
function stripRow_(o) { var c = {}; for (var k in o) if (k !== '_row') c[k] = o[k]; return c; }
