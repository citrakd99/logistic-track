/* LoGistic Tracking — backend Apps Script (file gabungan, dibuat oleh tests/bundle.js).
 * Tempel seluruh isi file ini ke Code.gs di editor Apps Script. Jangan edit di sini; edit di folder gas/. */

// ===== Code.gs =====
/**
 * LoGistic Tracking — API (Google Apps Script Web App)
 * Deploy: Execute as = Me, Who has access = Anyone.
 *
 * GET  ?action=status | pr | stock         → publik (viewer)
 * POST {action, token?, ...} (text/plain)   → login, setupAdmin, dan aksi admin
 */

var APP_VERSION = '1.3.0';
var PUBLIC_CACHE_SEC = 60;

function fail_(code, message) { var e = new Error(message); e.code = code; throw e; }
function out_(o) { return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON); }
function handle_(fn) {
  try { return out_({ ok: true, data: fn() }); }
  catch (e) {
    var known = !!e.code;
    if (!known) console.error(e && e.stack || e);
    return out_({ ok: false, code: e.code || 'server', message: known ? e.message : 'Terjadi kesalahan server: ' + (e && e.message || e) });
  }
}

function doGet(e) {
  var action = (e && e.parameter && e.parameter.action) || 'status';
  var fresh = e && e.parameter && e.parameter.fresh === '1';
  return handle_(function () {
    if (action === 'status') return actStatus_();
    if (action !== 'pr' && action !== 'stock') fail_('invalid', 'Aksi tidak dikenal.');
    requireView_(e && e.parameter && e.parameter.vt);
    // respons publik di-cache singkat agar lalu lintas tinggi tidak menghabiskan kuota
    var ck = 'pub:' + action + ':' + dataVersion_();
    if (!fresh) { var hit = cacheGet_(ck); if (hit) return hit; }
    var data = action === 'pr' ? actPR_(fresh) : actStock_(fresh);
    cachePut_(ck, data, PUBLIC_CACHE_SEC);
    return data;
  });
}

function doPost(e) {
  return handle_(function () {
    var b;
    try { b = JSON.parse((e && e.postData && e.postData.contents) || '{}'); } catch (x) { fail_('invalid', 'Body bukan JSON.'); }
    var a = String(b.action || '');
    if (a === 'login') return actLogin_(b);
    if (a === 'setupAdmin') return actSetupAdmin_(b);
    if (a === 'viewerLogin') return actViewerLogin_(b);
    if (a === 'getPR' || a === 'getStock') {
      requireView_(b.token);
      var action = a === 'getPR' ? 'pr' : 'stock', ck = 'pub:' + action + ':' + dataVersion_();
      if (!b.fresh) { var hit = cacheGet_(ck); if (hit) return hit; }
      var data = action === 'pr' ? actPR_(b.fresh) : actStock_(b.fresh);
      cachePut_(ck, data, PUBLIC_CACHE_SEC);
      return data;
    }
    var me = requireAdmin_(b.token);
    switch (a) {
      case 'me': return { email: me.email, name: me.name };
      case 'getSettings': return actGetSettings_();
      case 'setSources': return actSetSources_(me, b);
      case 'saveTx': return actSaveTx_(me, b);
      case 'editTx': return actEditTx_(me, b);
      case 'voidTx': return actVoidTx_(me, b);
      case 'saveItem': return actSaveItem_(me, b);
      case 'hideItem': return actHideItem_(me, b);
      case 'listAdmins': return actListAdmins_(me);
      case 'addAdmin': return actAddAdmin_(me, b);
      case 'removeAdmin': return actRemoveAdmin_(me, b);
      case 'changePassword': return actChangePassword_(me, b);
      case 'refresh': bumpDataVersion_(); return { ok: true };
      case 'syncPR': props_().deleteProperty('PR_SYNCED'); loadPR_(true); bumpDataVersion_(); log_(me.email, 'syncPR', ''); return actGetSettings_();
      case 'setViewerPin': return actSetViewerPin_(me, b);
      case 'setAutoSync': setAutoSync_(b.on !== false); log_(me.email, 'setAutoSync', String(b.on !== false)); return actGetSettings_();
    }
    fail_('invalid', 'Aksi tidak dikenal.');
  });
}

function actStatus_() {
  var c = cfg_();
  return { app: 'LoGistic Tracking', version: APP_VERSION, bound: c.bound, pin: pinOn_(), needsSetup: needsSetup_(), configured: { pr: !!c.prId, master: !!c.masterId, db: !!c.dbId }, today: todayISO_() };
}

function srcView_(id) {
  if (!id) return null;
  try { var i = fileInfo_(id, true); return { id: id, name: i.name, url: i.url, updated: i.updated, type: i.mime === MimeType.GOOGLE_SHEETS ? 'Google Sheet' : 'File Excel (.xlsx)' }; }
  catch (e) { return { id: id, error: e.message }; }
}
function actGetSettings_() {
  var c = cfg_(), at = props_().getProperty('PR_SYNCED_AT');
  var pc = pinCfg_();
  return { pin: !!(pc && pc.hash), pinAt: pc && pc.at || null, bound: c.bound, pr: srcView_(c.prId), master: srcView_(c.masterId), db: srcView_(c.dbId), prCopiedAt: at ? +at : null, autoSync: autoSyncOn_() };
}

/**
 * Simpan link sumber. Setiap link diuji dulu: bisa dibuka, formatnya benar.
 * Data Sheet dibuat otomatis jika kosong.
 */
function actSetSources_(me, b) {
  var p = props_(), c = cfg_(), res = {};
  var prId = idFromUrl_(b.prUrl), masterId = b.masterUrl ? idFromUrl_(b.masterUrl) : c.masterId, dbId = b.dbUrl ? idFromUrl_(b.dbUrl) : c.dbId;
  if (!prId) fail_('invalid', 'Link Tracking PR tidak valid.');
  if (b.masterUrl && !masterId) fail_('invalid', 'Link Master Stok tidak valid.');
  if (masterId && masterId === prId) fail_('invalid', 'Link Master Stok sama dengan link Tracking PR.');

  var prInfo = fileInfo_(prId, true);
  var prVals = readValues_(prInfo, 'TRACKING PR'), hi = findHeaderRow_(prVals);
  if (hi < 0) fail_('shape', 'Tracking PR: kolom "Deskripsi" tidak ditemukan.');
  var n = parsePR_(prVals.slice(hi + 1), todayISO_()).items.length;
  if (!n) fail_('shape', 'Tracking PR: tidak ada item PR yang terbaca.');
  res.pr = { name: prInfo.name, items: n };

  if (masterId) {
    var mInfo = fileInfo_(masterId, true), rows = parseMaster_(readValues_(mInfo, 'MASTER'));
    if (!rows) fail_('shape', 'Master Stok: kolom "Nama Barang" tidak ditemukan di tab MASTER.');
    res.master = { name: mInfo.name, items: rows.length };
  }

  if (dbId) {
    var dInfo = fileInfo_(dbId, true);
    if (dInfo.mime !== MimeType.GOOGLE_SHEETS) fail_('invalid', 'Data Sheet harus Google Sheet (bukan .xlsx) karena aplikasi menulis ke file ini.');
    try { var dss = SpreadsheetApp.openById(dbId); Object.keys(TABS).forEach(function (t) { ensureTab_(dss, t, TABS[t]); }); }
    catch (e) { fail_('source', 'Data Sheet tidak bisa diedit oleh akun pemilik Apps Script.'); }
  } else {
    dbId = createDb_();
    res.dbCreated = true;
  }
  var bound = boundSs_(), bid = bound ? bound.getId() : '';
  // jika script terpasang di Master: Master & Data Sheet default = file itu sendiri, tidak perlu disimpan
  p.setProperty('PR_ID', prId);
  if (masterId && masterId !== bid) p.setProperty('MASTER_ID', masterId); else p.deleteProperty('MASTER_ID');
  if (dbId !== bid) p.setProperty('DB_ID', dbId); else p.deleteProperty('DB_ID');
  p.deleteProperty('PR_SYNCED');
  res.pr.copied = !!loadPR_(true);
  bumpDataVersion_();
  log_(me.email, 'setSources', 'PR=' + prId + ' MASTER=' + (masterId || '-') + ' DB=' + dbId);
  res.settings = actGetSettings_();
  return res;
}

/**
 * Jalankan SEKALI dari editor Apps Script (pilih fungsi "setup" → Run).
 * Memicu izin akses Drive/Sheets, menyiapkan kunci rahasia, dan menampilkan
 * KODE SETUP untuk membuat admin pertama dari aplikasi.
 */
function setup() {
  secret_();
  DriveApp.getRootFolder();
  var b = boundSs_();
  if (b) {
    Object.keys(TABS).forEach(function (t) { ensureTab_(b, t, TABS[t]); });
    console.log('Script terpasang di "' + b.getName() + '": Master & Data Sheet = file ini (tab MASTER, TX, ITEMS, LOG, PR_DATA).');
  }
  if (needsSetup_()) {
    var key = props_().getProperty('SETUP_KEY');
    if (!key) { key = Utilities.getUuid().slice(0, 8).toUpperCase(); props_().setProperty('SETUP_KEY', key); }
    console.log('KODE SETUP ADMIN PERTAMA: ' + key);
  } else {
    console.log('Admin sudah ada: ' + admins_().map(function (a) { return a.email; }).join(', '));
  }
}

/** Darurat: jika semua password admin lupa. Jalankan dari editor, lalu buat admin baru lewat app. */
function resetAdmins() {
  props_().deleteProperty('ADMINS');
  setup();
}

// ---------- sinkron otomatis Tracking PR → tab PR_DATA ----------
function syncPR() {
  var c = cfg_(); if (!c.prId) { console.log('Sumber Tracking PR belum diatur.'); return; }
  var info = fileInfo_(c.prId, true);
  if (props_().getProperty('PR_SYNCED') === c.prId + ':' + info.updated) { console.log('Tracking PR belum berubah.'); return; }
  loadPR_(true); bumpDataVersion_();
  console.log('Tracking PR disalin ke tab ' + PR_COPY_TAB + '.');
}
function autoSyncOn_() { try { return ScriptApp.getProjectTriggers().some(function (t) { return t.getHandlerFunction() === 'syncPR'; }); } catch (e) { return false; } }
function setAutoSync_(on) {
  ScriptApp.getProjectTriggers().forEach(function (t) { if (t.getHandlerFunction() === 'syncPR') ScriptApp.deleteTrigger(t); });
  if (on) ScriptApp.newTrigger('syncPR').timeBased().everyMinutes(10).create();
}
/** Jalankan dari editor untuk menyalakan sinkron otomatis tiap 10 menit. */
function pasangSinkronOtomatis() { setAutoSync_(true); console.log('Sinkron otomatis Tracking PR aktif (tiap 10 menit).'); }

/** Menu di Google Sheet Master (hanya muncul jika script terpasang di Master). */
function onOpen() {
  try {
    SpreadsheetApp.getUi().createMenu('LoGistic')
      .addItem('Sinkron Tracking PR sekarang', 'syncPR')
      .addItem('Nyalakan sinkron otomatis (10 menit)', 'pasangSinkronOtomatis')
      .addToUi();
  } catch (e) { /* bukan konteks Sheet */ }
}

// ===== Auth.gs =====
/**
 * Auth.gs — admin login (email + password) dengan token bertanda tangan HMAC.
 * Viewer tidak login. Daftar admin disimpan di Script Properties (ADMINS),
 * password disimpan sebagai hash HMAC-SHA256 berulang dengan salt per admin.
 */

var TOKEN_TTL_MS = 12 * 3600 * 1000;
var LOGIN_MAX_FAIL = 5;
var LOGIN_LOCK_SEC = 15 * 60;
var HASH_ROUNDS = 400;

function b64u_(bytesOrStr) {
  var s = typeof bytesOrStr === 'string' ? Utilities.base64EncodeWebSafe(bytesOrStr, Utilities.Charset.UTF_8) : Utilities.base64EncodeWebSafe(bytesOrStr);
  return s.replace(/=+$/, '');
}
function fromB64u_(s) {
  var pad = s.length % 4 ? '===='.slice(s.length % 4) : '';
  return Utilities.newBlob(Utilities.base64DecodeWebSafe(s + pad)).getDataAsString('UTF-8');
}
function secret_() {
  var p = props_(), s = p.getProperty('SECRET');
  if (!s) { s = Utilities.getUuid() + Utilities.getUuid(); p.setProperty('SECRET', s); }
  return s;
}
function hashPw_(pw, salt) {
  var key = Utilities.newBlob(salt).getBytes();
  var h = Utilities.computeHmacSha256Signature(Utilities.newBlob(String(pw)).getBytes(), key);
  for (var i = 0; i < HASH_ROUNDS; i++) h = Utilities.computeHmacSha256Signature(h, key);
  return Utilities.base64Encode(h);
}
function safeEq_(a, b) {
  a = String(a); b = String(b);
  if (a.length !== b.length) return false;
  var r = 0; for (var i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

function admins_() { try { return JSON.parse(props_().getProperty('ADMINS') || '[]'); } catch (e) { return []; } }
function saveAdmins_(list) { props_().setProperty('ADMINS', JSON.stringify(list)); }
function findAdmin_(email) { email = normEmail_(email); return admins_().filter(function (a) { return a.email === email; })[0] || null; }
function normEmail_(e) { return String(e || '').trim().toLowerCase(); }
function checkEmail_(e) { if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e)) fail_('invalid', 'Format email tidak valid.'); }
function checkPw_(pw) { if (String(pw || '').length < 8) fail_('invalid', 'Password minimal 8 karakter.'); }

function issueToken_(a) {
  var payload = b64u_(JSON.stringify({ e: a.email, v: a.ver || 1, x: Date.now() + TOKEN_TTL_MS }));
  var sig = b64u_(Utilities.computeHmacSha256Signature(payload, secret_()));
  return payload + '.' + sig;
}

/** Verifikasi token admin. Mengembalikan objek admin atau melempar 401/403. */
function requireAdmin_(token) {
  var parts = String(token || '').split('.');
  if (parts.length !== 2) fail_('unauthorized', 'Silakan login sebagai admin.');
  var sig = b64u_(Utilities.computeHmacSha256Signature(parts[0], secret_()));
  if (!safeEq_(sig, parts[1])) fail_('unauthorized', 'Sesi tidak valid. Silakan login ulang.');
  var p; try { p = JSON.parse(fromB64u_(parts[0])); } catch (e) { fail_('unauthorized', 'Sesi tidak valid. Silakan login ulang.'); }
  if (!p.x || p.x < Date.now()) fail_('unauthorized', 'Sesi berakhir. Silakan login ulang.');
  var a = findAdmin_(p.e);
  if (!a || (a.ver || 1) !== p.v) fail_('forbidden', 'Akun ini bukan admin lagi atau password sudah diganti.');
  return a;
}

function needsSetup_() { return admins_().length === 0; }

// ---------- aksi ----------
function actLogin_(b) {
  var email = normEmail_(b.email), c = CacheService.getScriptCache(), lk = 'lf:' + email;
  var fails = +(c.get(lk) || 0);
  if (fails >= LOGIN_MAX_FAIL) fail_('locked', 'Terlalu banyak percobaan gagal. Coba lagi dalam 15 menit.');
  var a = findAdmin_(email);
  if (!a || !safeEq_(hashPw_(b.password || '', a.salt), a.hash)) {
    c.put(lk, String(fails + 1), LOGIN_LOCK_SEC);
    log_(email, 'login', '', 'gagal');
    fail_('unauthorized', 'Email atau password salah.');
  }
  c.remove(lk);
  log_(a.email, 'login', '', 'ok');
  return { token: issueToken_(a), email: a.email, name: a.name || a.email, exp: Date.now() + TOKEN_TTL_MS };
}

/** Admin pertama: hanya bisa saat belum ada admin, wajib kode setup dari fungsi setup() di editor. */
function actSetupAdmin_(b) {
  if (!needsSetup_()) fail_('forbidden', 'Admin pertama sudah dibuat. Silakan login.');
  var key = props_().getProperty('SETUP_KEY');
  if (!key) fail_('forbidden', 'Kode setup belum dibuat. Jalankan fungsi setup() di editor Apps Script.');
  var c = CacheService.getScriptCache(), n = +(c.get('setupfail') || 0);
  if (n >= LOGIN_MAX_FAIL) fail_('locked', 'Terlalu banyak percobaan. Coba lagi dalam 15 menit.');
  if (!safeEq_(String(b.setupKey || '').trim(), key)) { c.put('setupfail', String(n + 1), LOGIN_LOCK_SEC); fail_('unauthorized', 'Kode setup salah.'); }
  var email = normEmail_(b.email); checkEmail_(email); checkPw_(b.password);
  var salt = Utilities.getUuid(), a = { email: email, name: String(b.name || '').trim().slice(0, 60) || email, salt: salt, hash: hashPw_(b.password, salt), ver: 1, createdAt: Date.now(), createdBy: 'setup' };
  saveAdmins_([a]);
  props_().deleteProperty('SETUP_KEY');
  log_(email, 'setupAdmin', '', 'ok');
  return { token: issueToken_(a), email: a.email, name: a.name, exp: Date.now() + TOKEN_TTL_MS };
}

function actListAdmins_(me) {
  return admins_().map(function (a) { return { email: a.email, name: a.name, createdAt: a.createdAt, createdBy: a.createdBy, me: a.email === me.email }; });
}
function actAddAdmin_(me, b) {
  var email = normEmail_(b.email); checkEmail_(email); checkPw_(b.password);
  var list = admins_();
  if (list.some(function (a) { return a.email === email; })) fail_('invalid', 'Email ini sudah terdaftar sebagai admin.');
  var salt = Utilities.getUuid();
  list.push({ email: email, name: String(b.name || '').trim().slice(0, 60) || email, salt: salt, hash: hashPw_(b.password, salt), ver: 1, createdAt: Date.now(), createdBy: me.email });
  saveAdmins_(list);
  log_(me.email, 'addAdmin', email);
  return actListAdmins_(me);
}
function actRemoveAdmin_(me, b) {
  var email = normEmail_(b.email);
  if (email === me.email) fail_('invalid', 'Tidak bisa menghapus akun sendiri.');
  var list = admins_(), next = list.filter(function (a) { return a.email !== email; });
  if (next.length === list.length) fail_('invalid', 'Admin tidak ditemukan.');
  if (!next.length) fail_('invalid', 'Minimal harus ada satu admin.');
  saveAdmins_(next);
  log_(me.email, 'removeAdmin', email);
  return actListAdmins_(me);
}
function actChangePassword_(me, b) {
  if (!safeEq_(hashPw_(b.oldPassword || '', me.salt), me.hash)) fail_('unauthorized', 'Password lama salah.');
  checkPw_(b.newPassword);
  var list = admins_();
  list.forEach(function (a) {
    if (a.email === me.email) { a.salt = Utilities.getUuid(); a.hash = hashPw_(b.newPassword, a.salt); a.ver = (a.ver || 1) + 1; }
  });
  saveAdmins_(list);
  log_(me.email, 'changePassword', '');
  var a = findAdmin_(me.email);
  return { token: issueToken_(a), email: a.email, name: a.name, exp: Date.now() + TOKEN_TTL_MS };
}

// ---------- PIN viewer ----------
// Jika PIN aktif, data hanya bisa dibaca dengan token viewer (didapat setelah memasukkan PIN) atau token admin.
var VIEWER_TTL_MS = 30 * 24 * 3600 * 1000;
var PIN_MAX_FAIL = 20;

function pinCfg_() { try { return JSON.parse(props_().getProperty('VIEWER_PIN') || 'null'); } catch (e) { return null; } }
function pinOn_() { var c = pinCfg_(); return !!(c && c.hash); }

function issueViewerToken_(c) {
  var payload = b64u_(JSON.stringify({ t: 'v', v: c.ver, x: Date.now() + VIEWER_TTL_MS }));
  return payload + '.' + b64u_(Utilities.computeHmacSha256Signature(payload, secret_()));
}
/** true jika token boleh membaca data: PIN mati, token admin sah, atau token viewer sah untuk versi PIN saat ini. */
function canView_(token) {
  if (!pinOn_()) return true;
  var parts = String(token || '').split('.');
  if (parts.length !== 2) return false;
  if (!safeEq_(b64u_(Utilities.computeHmacSha256Signature(parts[0], secret_())), parts[1])) return false;
  var p; try { p = JSON.parse(fromB64u_(parts[0])); } catch (e) { return false; }
  if (!p.x || p.x < Date.now()) return false;
  if (p.t === 'v') return p.v === pinCfg_().ver;
  var a = findAdmin_(p.e);
  return !!(a && (a.ver || 1) === p.v);
}
function requireView_(token) { if (!canView_(token)) fail_('pin_required', 'Masukkan PIN untuk melihat data.'); }

function actViewerLogin_(b) {
  var c = pinCfg_();
  if (!c || !c.hash) return { token: '', exp: 0, pin: false };
  var cache = CacheService.getScriptCache(), n = +(cache.get('pinfail') || 0);
  if (n >= PIN_MAX_FAIL) fail_('locked', 'Terlalu banyak PIN salah. Coba lagi dalam 15 menit.');
  if (!safeEq_(hashPw_(String(b.pin || '').trim(), c.salt), c.hash)) { cache.put('pinfail', String(n + 1), LOGIN_LOCK_SEC); fail_('unauthorized', 'PIN salah.'); }
  return { token: issueViewerToken_(c), exp: Date.now() + VIEWER_TTL_MS, pin: true };
}
/** Admin: pasang/ganti PIN (semua viewer harus memasukkan PIN baru) atau matikan PIN (pin kosong + off=true). */
function actSetViewerPin_(me, b) {
  var p = props_(), old = pinCfg_();
  if (b.off === true) { p.deleteProperty('VIEWER_PIN'); log_(me.email, 'viewerPin', 'dimatikan'); bumpDataVersion_(); return { pin: false }; }
  var pin = String(b.pin || '').trim();
  if (!/^\d{6,12}$/.test(pin)) fail_('invalid', 'PIN harus 6–12 digit angka.');
  var salt = Utilities.getUuid();
  p.setProperty('VIEWER_PIN', JSON.stringify({ salt: salt, hash: hashPw_(pin, salt), ver: (old && old.ver || 0) + 1, at: Date.now(), by: me.email }));
  log_(me.email, 'viewerPin', old ? 'diganti' : 'diaktifkan');
  bumpDataVersion_();
  return { pin: true };
}

// ===== Data.gs =====
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

// ===== Stock.gs =====
/**
 * Stock.gs — data PR & stok untuk viewer, dan CRUD stok untuk admin.
 * Transaksi bersifat append-only: edit = batalkan (void) + catat ulang, hapus = void.
 */

function stockContext_(ss, fresh) {
  var pr = loadPR_(fresh), master = loadMaster_(fresh);
  var tx = readTable_(ss, 'TX'), items = readTable_(ss, 'ITEMS');
  var feed = prToStockFeed_(pr.items);
  return { pr: pr, master: master, tx: tx, items: items, feed: feed };
}

function actPR_(fresh) {
  var pr = loadPR_(!!fresh);
  return { prs: pr.prs, items: pr.items, source: pr.source, readAt: pr.readAt, today: todayISO_() };
}

function actStock_(fresh) {
  var ss = db_(), ctx = stockContext_(ss, !!fresh);
  var M = buildStock_(ctx.master.rows, ctx.items, ctx.feed, ctx.tx);
  var list = Object.keys(M).map(function (k) { return M[k]; });
  return {
    items: list,
    tx: ctx.tx.map(stripRow_),
    loans: openLoans_(ctx.tx),
    sources: { pr: ctx.pr.source, master: ctx.master.source, db: { url: ss.getUrl(), name: ss.getName() } },
    today: todayISO_()
  };
}

function withLock_(fn) {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(20000)) fail_('busy', 'Server sedang memproses simpanan lain. Coba lagi sebentar.');
  try { var r = fn(); bumpDataVersion_(); return r; } finally { lock.releaseLock(); }
}

function newId_() { return 't' + Date.now().toString(36) + Utilities.getUuid().slice(0, 6); }

/** Catat 1..n transaksi (pakai/pinjam multi-baris, kembali, koreksi). */
function actSaveTx_(me, b) {
  var lines = Array.isArray(b.lines) ? b.lines : [];
  if (!lines.length || lines.length > 50) fail_('invalid', 'Isi 1–50 baris transaksi.');
  return withLock_(function () {
    var ss = db_(), ctx = stockContext_(ss, true);
    var M = buildStock_(ctx.master.rows, ctx.items, ctx.feed, ctx.tx);
    var now = Date.now(), add = [], keys = {};
    lines.forEach(function (l, i) {
      var c = cleanTx_(l, M);
      if (c.error) fail_('invalid', (lines.length > 1 ? 'Baris ' + (i + 1) + ': ' : '') + c.error);
      if (c.tx.type === 'kembali') {
        var loan = ctx.tx.filter(function (t) { return t.id === c.tx.loanId && t.type === 'pinjam' && !isVoid_(t); })[0];
        if (!loan) fail_('invalid', 'Catatan pinjam tidak ditemukan atau sudah dibatalkan.');
        if (loan.key !== c.tx.key) fail_('invalid', 'Barang pengembalian berbeda dengan barang yang dipinjam.');
      }
      var t = c.tx; t.id = newId_() + i; t.createdAt = now; t.createdBy = me.email; t.void = false; t.replaces = '';
      add.push(t); keys[t.key] = 1;
    });
    var err = validateLedgerChange_(ctx.master.rows, ctx.items, ctx.feed, ctx.tx, ctx.tx.concat(add), Object.keys(keys));
    if (err) fail_('invalid', err);
    appendRows_(ss, 'TX', add);
    log_(me.email, 'saveTx', add.map(function (t) { return t.type + ' ' + t.qty + ' ' + t.name; }).join('; '));
    return { saved: add.length };
  });
}

/** Edit transaksi: void baris lama + tulis baris pengganti (riwayat tetap utuh). */
function actEditTx_(me, b) {
  return withLock_(function () {
    var ss = db_(), ctx = stockContext_(ss, true);
    var old = ctx.tx.filter(function (t) { return t.id === b.id; })[0];
    if (!old) fail_('invalid', 'Transaksi tidak ditemukan.');
    if (isVoid_(old)) fail_('invalid', 'Transaksi ini sudah dibatalkan.');
    var M = buildStock_(ctx.master.rows, ctx.items, ctx.feed, ctx.tx);
    var patch = b.tx || {}; patch.type = old.type; patch.loanId = old.loanId;
    if (!patch.key) patch.key = old.key;
    if (old.type === 'pinjam' && patch.key !== old.key) fail_('invalid', 'Barang pada catatan pinjam tidak bisa diganti. Batalkan lalu catat ulang.');
    var c = cleanTx_(patch, M);
    if (c.error) fail_('invalid', c.error);
    var now = Date.now(), nt = c.tx;
    // pinjam yang diedit tetap memakai id lama agar pengembalian tetap terhubung
    var voided = stripRow_(old); voided.void = true; voided.voidReason = 'Diedit: ' + (String(b.reason || '').trim() || 'koreksi data'); voided.voidAt = now; voided.voidBy = me.email;
    if (old.type === 'pinjam') { voided.id = old.id + '~' + now.toString(36); nt.id = old.id; } else nt.id = newId_();
    nt.createdAt = now; nt.createdBy = me.email; nt.void = false; nt.replaces = voided.id;
    var after = ctx.tx.filter(function (t) { return t.id !== old.id; }).concat([voided, nt]);
    var err = validateLedgerChange_(ctx.master.rows, ctx.items, ctx.feed, ctx.tx, after, uniq_([old.key, nt.key]));
    if (err) fail_('invalid', err);
    updateRow_(ss, 'TX', old._row, voided);
    appendRows_(ss, 'TX', [nt]);
    log_(me.email, 'editTx', old.id + ' → ' + nt.id);
    return { id: nt.id };
  });
}

function actVoidTx_(me, b) {
  var reason = String(b.reason || '').trim();
  if (!reason) fail_('invalid', 'Alasan pembatalan wajib diisi.');
  return withLock_(function () {
    var ss = db_(), ctx = stockContext_(ss, true);
    var old = ctx.tx.filter(function (t) { return t.id === b.id; })[0];
    if (!old) fail_('invalid', 'Transaksi tidak ditemukan.');
    if (isVoid_(old)) fail_('invalid', 'Transaksi ini sudah dibatalkan.');
    if (old.type === 'pinjam' && ctx.tx.some(function (t) { return !isVoid_(t) && t.type === 'kembali' && t.loanId === old.id; }))
      fail_('invalid', 'Pinjaman ini sudah punya catatan kembali. Batalkan catatan kembalinya dulu.');
    var v = stripRow_(old); v.void = true; v.voidReason = reason.slice(0, 200); v.voidAt = Date.now(); v.voidBy = me.email;
    var after = ctx.tx.map(function (t) { return t.id === old.id ? v : t; });
    var err = validateLedgerChange_(ctx.master.rows, ctx.items, ctx.feed, ctx.tx, after, [old.key]);
    if (err) fail_('invalid', err);
    updateRow_(ss, 'TX', old._row, v);
    log_(me.email, 'voidTx', old.id + ' ' + reason);
    return { id: old.id };
  });
}

/** Tambah barang baru (source=app) atau ubah data barang (kategori, stok awal, rak, minimum, catatan). */
function actSaveItem_(me, b) {
  return withLock_(function () {
    var ss = db_(), ctx = stockContext_(ss, true);
    var M = buildStock_(ctx.master.rows, ctx.items, ctx.feed, ctx.tx);
    var isNew = !b.key, key, name, unit;
    if (isNew) {
      name = String(b.name || '').trim(); unit = String(b.unit || '').trim();
      if (!name || !unit) fail_('invalid', 'Nama barang dan satuan wajib diisi.');
      key = stockKey_(name, unit);
      if (M[key]) fail_('invalid', 'Barang "' + M[key].name + '" (' + M[key].unit + ') sudah ada.');
    } else {
      key = String(b.key); if (!M[key]) fail_('invalid', 'Barang tidak ditemukan.');
      name = M[key].name; unit = M[key].unit;
    }
    var kat = b.kat === 'Alat' || b.kat === 'Material' ? b.kat : '';
    var awal = pNum_(b.awal), min = pNum_(b.min);
    if (awal !== null && awal < 0) fail_('invalid', 'Stok awal tidak boleh minus.');
    if (min !== null && min < 0) fail_('invalid', 'Stok minimum tidak boleh minus.');
    var exist = ctx.items.filter(function (o) { return o.key === key; })[0];
    var row = {
      key: key, name: name, unit: unit, kat: kat, awal: awal === null ? 0 : awal, rak: String(b.rak || '').trim().slice(0, 60),
      min: min === null ? '' : min, note: String(b.note || '').trim().slice(0, 300), hidden: false, full: true,
      source: exist ? exist.source : (isNew ? 'app' : 'override'), updatedAt: Date.now(), updatedBy: me.email
    };
    if (exist) updateRow_(ss, 'ITEMS', exist._row, row); else appendRows_(ss, 'ITEMS', [row]);
    log_(me.email, isNew ? 'addItem' : 'editItem', name + ' [' + unit + ']');
    return { key: key };
  });
}

/** Sembunyikan barang dari daftar (hanya jika stok 0 dan tidak sedang dipinjam). */
function actHideItem_(me, b) {
  return withLock_(function () {
    var ss = db_(), ctx = stockContext_(ss, true);
    var M = buildStock_(ctx.master.rows, ctx.items, ctx.feed, ctx.tx), it = M[b.key];
    if (!it) fail_('invalid', 'Barang tidak ditemukan.');
    var hide = b.hidden !== false;
    if (hide && (it.stok !== 0 || it.dipinjam > 0)) fail_('invalid', 'Barang masih punya stok ' + fmtQ_(it.stok) + ' atau sedang dipinjam. Koreksi stok ke 0 dulu.');
    var exist = ctx.items.filter(function (o) { return o.key === it.key; })[0];
    if (exist) { var r = stripRow_(exist); r.hidden = hide; r.updatedAt = Date.now(); r.updatedBy = me.email; updateRow_(ss, 'ITEMS', exist._row, r); }
    else appendRows_(ss, 'ITEMS', [{ key: it.key, name: it.name, unit: it.unit, hidden: hide, full: false, source: 'override', updatedAt: Date.now(), updatedBy: me.email }]);
    log_(me.email, hide ? 'hideItem' : 'showItem', it.name);
    return { key: it.key, hidden: hide };
  });
}

function uniq_(a) { var o = {}; a.forEach(function (x) { o[x] = 1; }); return Object.keys(o); }

// ===== Logic.gs =====
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

// ===== Seed.gs =====
/**
 * Seed.gs — migrasi satu kali dari artefak lama "Tracking Stock".
 * Artefak lama belum punya transaksi stok; yang dibawa hanya 27 penanda kategori "Alat"
 * yang diubah manual di aplikasi lama.
 * Jalankan SEKALI dari editor setelah sumber data diatur di halaman Pengaturan.
 */
var LEGACY_KAT_ALAT = [
  'subpanel34|unit', 'webbingslingbelt2tpanjang3m|pcs', 'webbingslingbelt2tpanjang6m|pcs', 'pipascapoldingdia15tebal32mmpjng2mtr|batang',
  'paneltemporaryfactoryf2|unit', 'paneltemporaryfactoryf4|unit', 'slevecoupler|pcs', 'pipascapoldingdia15tebal32mmpjng6mtr|batang',
  'tespentekiro|pcs', 'clampmati|pcs', 'spancrew16mmtrunbuckle|pcs', 'stikcone|pcs', 'clamphidup|pcs', 'subpanel12|unit',
  'theodolitedigitalextopcon|unit', 'vacumacvalve|unit', 'jackbase60cm|pcs', 'slingbaja6mm|meter', 'lampusorotled250wattexlokal|unit',
  'fullbodyharnesdoublehockabsober|unit', 'pipascapoldingdia15tebal32mmpjng1mtr|batang', 'paneltemporaryoffice|unit',
  'twistcableal4x1x25mm|meter', 'asiba1meter|pcs', 'fullbodyharnesdoublehock|unit', 'asiba2meter|pcs', 'sarungtanganlistrik1000v|pasang'
];
var LEGACY_NAMES = {
  'subpanel34|unit': 'Sub Panel 3&4', 'webbingslingbelt2tpanjang3m|pcs': 'Webbing Sling Belt 2T Panjang 3M', 'webbingslingbelt2tpanjang6m|pcs': 'Webbing Sling Belt 2T Panjang 6M',
  'pipascapoldingdia15tebal32mmpjng2mtr|batang': 'pipa Scapolding Dia 1.5 tebal 3,2 mm pjng 2 mtr', 'paneltemporaryfactoryf2|unit': 'Panel Temporary Factory F2',
  'paneltemporaryfactoryf4|unit': 'Panel Temporary Factory F4', 'slevecoupler|pcs': 'Sleve coupler', 'pipascapoldingdia15tebal32mmpjng6mtr|batang': 'Pipa Scapolding Dia 1.5 tebal 3,2 mm pjng 6 mtr',
  'tespentekiro|pcs': 'Tespen Tekiro', 'clampmati|pcs': 'Clamp mati', 'spancrew16mmtrunbuckle|pcs': 'Span Crew 16mm/Trunbuckle', 'stikcone|pcs': 'Stik Cone',
  'clamphidup|pcs': 'Clamp hidup', 'subpanel12|unit': 'Sub Panel 1&2', 'theodolitedigitalextopcon|unit': 'Theodolite digital ex.Topcon', 'vacumacvalve|unit': 'Vacum Ac Valve',
  'jackbase60cm|pcs': 'Jack Base 60cm', 'slingbaja6mm|meter': 'Sling Baja 6mm', 'lampusorotled250wattexlokal|unit': 'lampu sorot LED 250 Watt Ex. Lokal',
  'fullbodyharnesdoublehockabsober|unit': 'Full Body Harnes Double Hock + Absober', 'pipascapoldingdia15tebal32mmpjng1mtr|batang': 'pipa Scapolding Dia 1.5 tebal 3,2 mm pjng 1 mtr',
  'paneltemporaryoffice|unit': 'Panel Temporary Office', 'twistcableal4x1x25mm|meter': 'Twist Cable AL 4x1x25mm', 'asiba1meter|pcs': 'asiba 1 meter',
  'fullbodyharnesdoublehock|unit': 'Full Body Harnes Double Hock', 'asiba2meter|pcs': 'asiba 2 meter', 'sarungtanganlistrik1000v|pasang': 'Sarung Tangan Listrik 1000 V'
};

function seedKategoriAlatDariAppLama() {
  var ss = db_(), have = {};
  readTable_(ss, 'ITEMS').forEach(function (o) { have[o.key] = 1; });
  var add = LEGACY_KAT_ALAT.filter(function (k) { return !have[k]; }).map(function (k) {
    return { key: k, name: LEGACY_NAMES[k], unit: k.split('|')[1], kat: 'Alat', hidden: false, full: false, source: 'override', updatedAt: Date.now(), updatedBy: 'migrasi-app-lama' };
  });
  appendRows_(ss, 'ITEMS', add);
  bumpDataVersion_();
  console.log('Ditambahkan ' + add.length + ' penanda kategori Alat (dilewati ' + (LEGACY_KAT_ALAT.length - add.length) + ' yang sudah ada).');
}
