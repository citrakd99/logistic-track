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
/** Spreadsheet tempat script terpasang (script di Master: Ekstensi → Apps Script). null jika script berdiri sendiri. */
function boundSs_() { try { return SpreadsheetApp.getActiveSpreadsheet() || null; } catch (e) { return null; } }
function cfg_() {
  var p = props_(), b = boundSs_(), bid = b ? b.getId() : '';
  return { prId: p.getProperty('PR_ID') || '', masterId: p.getProperty('MASTER_ID') || bid, dbId: p.getProperty('DB_ID') || bid, bound: !!b };
}
/** Zona waktu aman: file yang dibuka dengan akses Pelihat bisa mengembalikan zona kosong. */
function tz_(t) { t = typeof t === 'string' ? t.trim() : ''; if (t) return t; try { t = Session.getScriptTimeZone(); } catch (e) { t = ''; } return (typeof t === 'string' && t) ? t : 'Asia/Jakarta'; }
function todayISO_() { return Utilities.formatDate(new Date(), tz_(), 'yyyy-MM-dd'); }

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
function bumpDataVersion_() { props_().setProperty('DATA_VER', Date.now().toString(36) + Utilities.getUuid().slice(0, 6)); }

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
    var ss = SpreadsheetApp.openById(ssId), tz; try { tz = tz_(ss.getSpreadsheetTimeZone()); } catch (e) { tz = tz_(); }
    var sheets = ss.getSheets();
    var sh = sheets.filter(function (s) { return s.getName().trim().toUpperCase() === preferTab; })[0] || sheets[0];
    return sh.getDataRange().getValues().map(function (r) {
      return r.map(function (v) { return isDate_(v) ? Utilities.formatDate(v, tz, 'yyyy-MM-dd') : v; });
    });
  } finally {
    if (tmpId) { try { Drive.Files.remove(tmpId); } catch (e) { try { DriveApp.getFileById(tmpId).setTrashed(true); } catch (e2) { /* biarkan */ } } }
  }
}

/**
 * Tracking PR: file sumber hanya DIBACA (akses Pelihat cukup). Setiap kali file sumber berubah,
 * isinya disalin ke tab PR_DATA di Master/Data Sheet, lalu aplikasi membaca dari salinan itu.
 */
function loadPR_(fresh) {
  var c = cfg_();
  if (!c.prId) fail_('not_configured', 'Sumber Tracking PR belum diatur admin.');
  var info = fileInfo_(c.prId, fresh), ck = 'pr:' + c.prId + ':' + info.updated;
  var hit = cacheGet_(ck);
  if (hit) return hit;
  var all = null;
  if (c.dbId) {
    if (props_().getProperty('PR_SYNCED') !== c.prId + ':' + info.updated) all = syncPRCopy_(info);
    if (!all) all = readPRCopy_();
  }
  if (!all) all = readValues_(info, 'TRACKING PR');
  var res = parsePRValues_(all, info);
  cachePut_(ck, res, 21600);
  return res;
}
function parsePRValues_(all, info) {
  var hi = findHeaderRow_(all);
  if (hi < 0) fail_('shape', 'Tracking PR: kolom "Deskripsi" tidak ditemukan. Pastikan tab pertama memakai format log book.');
  var parsed = parsePR_(all.slice(hi + 1), todayISO_());
  if (parsed.items.length < 1) fail_('shape', 'Tracking PR: tidak ada item PR yang terbaca.');
  return { prs: parsed.prs, items: parsed.items, source: { name: info.name, url: info.url, updated: info.updated, copiedAt: props_().getProperty('PR_SYNCED_AT') || '' }, readAt: Date.now() };
}

var PR_COPY_TAB = 'PR_DATA';
/** Salin isi Tracking PR ke tab PR_DATA (semua sebagai teks, tanggal ISO). Mengembalikan nilai yang disalin. */
function syncPRCopy_(info) {
  var all = readValues_(info, 'TRACKING PR');
  if (findHeaderRow_(all) < 0) fail_('shape', 'Tracking PR: kolom "Deskripsi" tidak ditemukan.');
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(5000)) return all; // sinkron lain sedang berjalan: pakai data yang sudah dibaca
  try {
    var ss = SpreadsheetApp.openById(cfg_().dbId), sh = ss.getSheetByName(PR_COPY_TAB) || ss.insertSheet(PR_COPY_TAB);
    var width = Math.max(21, all.reduce(function (m, r) { return Math.max(m, r.length); }, 0));
    var rows = [['SALINAN OTOMATIS dari "' + info.name + '" — jangan diedit, akan ditimpa', info.url, 'Disalin: ' + Utilities.formatDate(new Date(), tz_(), 'yyyy-MM-dd HH:mm')]
      .concat(Array(width - 3).fill(''))].concat(all.map(function (r) {
        var o = []; for (var i = 0; i < width; i++) o.push(r[i] === undefined || r[i] === null ? '' : String(r[i])); return o;
      }));
    sh.clearContents();
    if (sh.getMaxRows() < rows.length) sh.insertRowsAfter(sh.getMaxRows(), rows.length - sh.getMaxRows());
    if (sh.getMaxColumns && sh.getMaxColumns() < width) sh.insertColumnsAfter(sh.getMaxColumns(), width - sh.getMaxColumns());
    sh.getRange(1, 1, rows.length, width).setNumberFormat('@').setValues(rows);
    props_().setProperties({ PR_SYNCED: info.id + ':' + info.updated, PR_SYNCED_AT: String(Date.now()) });
    return all;
  } finally { lock.releaseLock(); }
}
function readPRCopy_() {
  var sh = SpreadsheetApp.openById(cfg_().dbId).getSheetByName(PR_COPY_TAB);
  if (!sh || sh.getLastRow() < 2) return null;
  return sh.getDataRange().getValues().slice(1);
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
    head.forEach(function (h, j) { var v = r[j]; o[h] = isDate_(v) ? Utilities.formatDate(v, tz_(), 'yyyy-MM-dd') : v; });
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
