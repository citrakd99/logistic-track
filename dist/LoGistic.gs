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

var APP_VERSION = '1.9.1';
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
    if (a === 'fotoThumbs') { requireView_(b.token); return actFotoThumbs_(b); }
    if (a === 'fotoFull') { requireView_(b.token); return actFotoFull_(b); }
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
      case 'setKat': return actSetKat_(me, b);
      case 'saveKendala': return actSaveKendala_(me, b);
      case 'kendalaStatus': return actKendalaStatus_(me, b);
      case 'hapusKendala': return actHapusKendala_(me, b);
      case 'setPics': return actSetPics_(me, b);
      case 'editPR': return actEditPR_(me, b);
      case 'addPRItems': return actAddPRItems_(me, b);
      case 'addPR': return actAddPR_(me, b);
      case 'nextPRNo': return actNextPRNo_();
      case 'uploadSJ': return actUploadSJ_(me, b);
      case 'hapusFoto': return actHapusFoto_(me, b);
      case 'setFotoStore': return actSetFotoStore_(me, b);
      case 'migrateFoto': return actMigrateFoto_(me);
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

/** Deteksi file .gs lama yang tertinggal di proyek Apps Script (fungsi lama menimpa fungsi baru). */
function staleFiles_() {
  var stale = [];
  if (String(readValues_).indexOf('tz_(') < 0) stale.push('Data.gs');
  if (typeof actSetViewerPin_ !== 'function' || String(loadPR_).indexOf('syncPRCopy_') < 0) stale.push('Data.gs/Auth.gs');
  if (String(actSetKat_).indexOf('upsertMaster_') < 0) stale.push('Stock.gs');
  if (typeof actHapusKendala_ !== 'function' || typeof actSetPics_ !== 'function' || String(actPR_).indexOf('picList_') < 0 || String(listKendala_).indexOf('pDate_') < 0) stale.push('Kendala.gs');
  if (typeof saatSheetDiedit !== 'function') stale.push('SheetEdit.gs');
  if (typeof actEditPR_ !== 'function') stale.push('PrEdit.gs');
  if (typeof relayCall_ !== 'function' || typeof writeFotoLinks_ !== 'function' || String(actPR_).indexOf('listFoto_') < 0) stale.push('Foto.gs');
  return stale;
}
function actStatus_() {
  var c = cfg_();
  return { app: 'LoGistic Tracking', version: APP_VERSION, staleFiles: staleFiles_(), bound: c.bound, pin: pinOn_(), needsSetup: needsSetup_(), configured: { pr: !!c.prId, master: !!c.masterId, db: !!c.dbId }, today: todayISO_() };
}

function srcView_(id) {
  if (!id) return null;
  try { var i = fileInfo_(id, true); return { id: id, name: i.name, url: i.url, updated: i.updated, type: i.mime === MimeType.GOOGLE_SHEETS ? 'Google Sheet' : 'File Excel (.xlsx)' }; }
  catch (e) { return { id: id, error: e.message }; }
}
function actGetSettings_() {
  var c = cfg_(), at = props_().getProperty('PR_SYNCED_AT');
  var pc = pinCfg_();
  return { fotoStore: actFotoStoreInfo_(), prCanWrite: prCanWrite_(), picList: picList_(), staleFiles: staleFiles_(), pin: !!(pc && pc.hash), pinAt: pc && pc.at || null, bound: c.bound, pr: srcView_(c.prId), master: srcView_(c.masterId), db: srcView_(c.dbId), prCopiedAt: at ? +at : null, autoSync: autoSyncOn_() };
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
  res.katDropdown = ensureKatValidation_();
  ensureTab_(SpreadsheetApp.openById(dbId), 'KENDALA', TABS.KENDALA);
  res.sheetEdit = rapikanTabKendala_() && ensureEditTrigger_();
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
    console.log(ensureKatValidation_() ? 'Dropdown kategori MASTER: Material, Alat, APD.' : 'Dropdown kategori tidak dipasang (header "Nama Barang" tidak ditemukan).');
    aktifkanEditDariSheet();
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
  if (props_().getProperty('PR_SYNCED') === c.prId + ':' + info.updated + ':' + (props_().getProperty('PR_REV') || '')) { console.log('Tracking PR belum berubah.'); return; }
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
      .addItem('Pasang dropdown kategori (Material/Alat/APD)', 'pasangDropdownKategori')
      .addItem('Aktifkan edit dari Sheet (tab KENDALA)', 'aktifkanEditDariSheet')
      .addToUi();
  } catch (e) { /* bukan konteks Sheet */ }
}

/** Menu/editor: pasang dropdown kategori Material/Alat/APD di kolom C tab MASTER. */
function pasangDropdownKategori() { console.log(ensureKatValidation_() ? 'Dropdown kategori terpasang.' : 'Tab MASTER / header "Nama Barang" tidak ditemukan.'); }

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
  LOG: ['at', 'email', 'action', 'detail', 'result'],
  FOTO_SJ: ['id', 'prKey', 'prNo', 'sjNo', 'items', 'fileId', 'fileName', 'folder', 'url', 'size', 'thumb', 'note', 'status', 'uploadedAt', 'uploadedBy', 'store'],
  KENDALA: ['id', 'prKey', 'prNo', 'itemNo', 'itemId', 'itemDesc', 'kategori', 'kendala', 'action', 'pic', 'komitmen', 'status', 'selesaiAt', 'followup', 'followupAt', 'geser', 'riwayat', 'createdAt', 'createdBy', 'updatedAt', 'updatedBy']
};
// kolom yang dipaksa teks agar Sheets tidak mengubah "3/4 inch" atau tanggal jadi nilai lain
var NUM_COLS = { TX: ['qty', 'createdAt', 'void', 'voidAt'], ITEMS: ['awal', 'min', 'hidden', 'full', 'updatedAt'], LOG: ['at'], FOTO_SJ: ['size', 'uploadedAt'], KENDALA: ['komitmen', 'selesaiAt', 'followupAt', 'geser', 'createdAt', 'updatedAt'] };

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
  var rev = props_().getProperty('PR_REV') || '', info = fileInfo_(c.prId, fresh), ck = 'pr:' + c.prId + ':' + info.updated + ':' + rev;
  var hit = cacheGet_(ck);
  if (hit) return hit;
  var all = null;
  if (c.dbId) {
    if (props_().getProperty('PR_SYNCED') !== c.prId + ':' + info.updated + ':' + rev) all = syncPRCopy_(info, rev);
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
function syncPRCopy_(info, rev) {
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
    props_().setProperties({ PR_SYNCED: info.id + ':' + info.updated + ':' + (rev || ''), PR_SYNCED_AT: String(Date.now()) });
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
  var info = fileInfo_(id, fresh), ck = 'ms:' + id + ':' + info.updated + ':' + (props_().getProperty('MASTER_REV') || '');
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
  if (sh.getLastRow() > 0) {
    // tab lama dengan kolom lebih sedikit: tambahkan judul kolom baru di kanan (data lama tetap)
    var cur = sh.getRange(1, 1, 1, headers.length).getValues()[0];
    headers.forEach(function (h, i) { if (cur[i] === '' || cur[i] === null) { if (i >= cur.filter(function (x) { return x !== '' && x !== null; }).length) sh.getRange(1, i + 1).setValue(h).setFontWeight('bold'); } });
  }
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
  }).filter(function (o) { return head.some(function (h) { return o[h] !== '' && o[h] !== null && o[h] !== false; }); }); // baris kosong dilewati (baris dari Sheet boleh tanpa id)
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

// ===== Master.gs =====
/**
 * Master.gs — menulis perubahan data barang langsung ke tab MASTER (jika Master berupa Google Sheet
 * yang bisa diedit, mis. script terpasang di Master). Master menjadi sumber kebenaran: kategori,
 * stok awal, rak, minimum, catatan. Jika Master tidak bisa ditulis (.xlsx / hanya lihat), aplikasi
 * memakai tab ITEMS sebagai penimpa seperti sebelumnya.
 */
var MASTER_COLS = ['Nama Barang', 'Satuan', 'Kategori', 'Stok Awal', 'Lokasi Rak', 'Stok Minimum', 'Catatan'];

function masterSheet_() {
  var c = cfg_(); if (!c.masterId) return null;
  try {
    var info = fileInfo_(c.masterId, true);
    if (info.mime !== MimeType.GOOGLE_SHEETS) return null;
    var ss = SpreadsheetApp.openById(c.masterId), sheets = ss.getSheets();
    return sheets.filter(function (s) { return s.getName().trim().toUpperCase() === 'MASTER'; })[0] || sheets[0];
  } catch (e) { return null; }
}
function masterHeaderRow_(vals) {
  for (var i = 0; i < vals.length; i++) if (/^nama barang$/i.test(String(vals[i][0] == null ? '' : vals[i][0]).trim())) return i;
  return -1;
}
/** Dropdown kategori (Material/Alat/APD) di kolom C tab MASTER. */
function ensureKatValidation_(sh) {
  try {
    sh = sh || masterSheet_(); if (!sh) return false;
    var hi = masterHeaderRow_(sh.getDataRange().getValues()); if (hi < 0) return false;
    var start = hi + 2, n = Math.max(1, sh.getMaxRows() - start + 1);
    var rule = SpreadsheetApp.newDataValidation().requireValueInList(KATS, true).setAllowInvalid(false)
      .setHelpText('Material = dipakai habis · Alat = dipinjam & dikembalikan · APD = diserahkan ke pekerja').build();
    sh.getRange(start, 3, n, 1).setDataValidation(rule);
    return true;
  } catch (e) { return false; }
}
function bumpMasterRev_() { props_().setProperty('MASTER_REV', Date.now().toString(36)); }

/**
 * Upsert baris barang ke tab MASTER. rows: [{key,name,unit,kat?,awal?,rak?,min?,note?}]; hanya field
 * yang ada (!== undefined) yang ditulis. Mengembalikan true jika berhasil ditulis ke Master.
 */
function upsertMaster_(rows) {
  var sh = masterSheet_(); if (!sh || !rows.length) return false;
  var vals = sh.getDataRange().getValues(), hi = masterHeaderRow_(vals);
  if (hi < 0) return false;
  var idx = {};
  for (var i = hi + 1; i < vals.length; i++) { var nm = pStr_(vals[i][0]); if (nm) idx[stockKey_(nm, pStr_(vals[i][1]))] = i + 1; }
  var FIELDS = [['kat', 3], ['awal', 4], ['rak', 5], ['min', 6], ['note', 7]], add = [];
  rows.forEach(function (r) {
    var rn = idx[r.key];
    if (rn) {
      FIELDS.forEach(function (f) { if (r[f[0]] !== undefined) sh.getRange(rn, f[1]).setValue(r[f[0]] === null ? '' : r[f[0]]); });
    } else {
      add.push([r.name, r.unit, r.kat || '', r.awal == null ? '' : r.awal, r.rak || '', r.min == null ? '' : r.min, r.note || '']);
      idx[r.key] = -1;
    }
  });
  if (add.length) {
    var last = Math.max(sh.getLastRow(), hi + 1), need = last + add.length - sh.getMaxRows();
    if (need > 0) sh.insertRowsAfter(sh.getMaxRows(), need + 50);
    sh.getRange(last + 1, 1, add.length, 7).setValues(add);
  }
  ensureKatValidation_(sh);
  bumpMasterRev_();
  return true;
}

/** Setelah ditulis ke Master, kosongkan penimpa di ITEMS agar Master yang berlaku (status sembunyi tetap). */
function clearOverrides_(ss, items, keys) {
  var set = {}; keys.forEach(function (k) { set[k] = 1; });
  items.forEach(function (o) {
    if (!set[o.key]) return;
    var r = stripRow_(o); r.kat = ''; r.awal = ''; r.rak = ''; r.min = ''; r.note = ''; r.full = false;
    if (r.source === 'app') r.source = 'master';
    updateRow_(ss, 'ITEMS', o._row, r);
  });
}

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
  return { prs: pr.prs, items: pr.items, source: pr.source, readAt: pr.readAt, today: todayISO_(), kendala: listKendala_(), picList: picList_(), foto: listFoto_() };
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
    var kat = isKat_(b.kat) ? b.kat : '';
    var awal = pNum_(b.awal), min = pNum_(b.min);
    if (awal !== null && awal < 0) fail_('invalid', 'Stok awal tidak boleh minus.');
    if (min !== null && min < 0) fail_('invalid', 'Stok minimum tidak boleh minus.');
    var rak = String(b.rak || '').trim().slice(0, 60), note = String(b.note || '').trim().slice(0, 300);
    // utamakan tulis ke tab MASTER (sumber kebenaran); jika tidak bisa, simpan sebagai penimpa di ITEMS
    if (upsertMaster_([{ key: key, name: name, unit: unit, kat: kat, awal: awal === null ? 0 : awal, rak: rak, min: min, note: note }])) {
      clearOverrides_(ss, ctx.items, [key]);
      log_(me.email, isNew ? 'addItem' : 'editItem', name + ' [' + unit + '] → MASTER');
      return { key: key, master: true };
    }
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

/** Koreksi kategori cepat (1..n barang sekaligus). Hanya mengubah kolom kategori; data lain barang tetap. */
function actSetKat_(me, b) {
  var keys = Array.isArray(b.keys) ? b.keys : [];
  if (!isKat_(b.kat)) fail_('invalid', 'Kategori harus Material, Alat, atau APD.');
  if (!keys.length || keys.length > 500) fail_('invalid', 'Pilih 1–500 barang.');
  return withLock_(function () {
    var ss = db_(), ctx = stockContext_(ss, false);
    var M = buildStock_(ctx.master.rows, ctx.items, ctx.feed, ctx.tx), byKey = {}, add = [], n = 0;
    var valid = keys.filter(function (k) { return M[k]; });
    if (upsertMaster_(valid.map(function (k) { return { key: k, name: M[k].name, unit: M[k].unit, kat: b.kat }; }))) {
      // hapus kategori penimpa di ITEMS agar nilai di Master yang berlaku
      var set = {}; valid.forEach(function (k) { set[k] = 1; });
      ctx.items.forEach(function (o) { if (set[o.key] && o.kat) { var r = stripRow_(o); r.kat = ''; updateRow_(ss, 'ITEMS', o._row, r); } });
      log_(me.email, 'setKat', b.kat + ' × ' + valid.length + ' → MASTER');
      return { updated: valid.length, master: true };
    }
    ctx.items.forEach(function (o) { byKey[o.key] = o; });
    keys.forEach(function (k) {
      var it = M[k]; if (!it) return;
      var ex = byKey[k];
      if (ex) { var r = stripRow_(ex); r.kat = b.kat; r.updatedAt = Date.now(); r.updatedBy = me.email; updateRow_(ss, 'ITEMS', ex._row, r); }
      else add.push({ key: k, name: it.name, unit: it.unit, kat: b.kat, hidden: false, full: false, source: 'override', updatedAt: Date.now(), updatedBy: me.email });
      n++;
    });
    appendRows_(ss, 'ITEMS', add);
    log_(me.email, 'setKat', b.kat + ' × ' + n);
    return { updated: n };
  });
}

// ===== Kendala.gs =====
/**
 * Kendala.gs — catatan kendala & action plan Tracking PR (hanya admin yang menulis).
 * Satu catatan = KENAPA (kendala) · APA (action) · SIAPA (PIC) · KAPAN (tanggal komitmen).
 * Disimpan di tab KENDALA (Master/Data Sheet) karena Sheet Tracking PR hanya bisa dilihat.
 * Status di Sheet: open | closed | batal ("selesai" lama tetap dibaca sebagai closed). "Terlambat" dihitung di tampilan (komitmen < hari ini & open).
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
  savePics_(l); bumpDataVersion_(); rapikanTabKendala_(); log_(me.email, 'setPics', l.join(', '));
  return { picList: l };
}

var KENDALA_KAT = ['Budget/Harga', 'Approval CC', 'Vendor/Supplier', 'Spesifikasi', 'Pengiriman', 'Administrasi PO', 'Lainnya'];

/** Status baku: open | selesai (ditampilkan "Closed") | batal. Menerima ketikan Sheet: closed/close/selesai/done. */
function kStatus_(v) { var s = String(v || 'open').trim().toLowerCase(); if (/^(closed?|selesai|done|ok)$/.test(s)) return 'selesai'; if (/^(batal|cancel)/.test(s)) return 'batal'; return 'open'; }
var K_CLOSED = 'closed'; // nilai yang ditulis ke Sheet
function listKendala_() {
  var rows;
  try { rows = readTable_(db_(), 'KENDALA'); } catch (e) { return []; } // Data Sheet belum diatur: Tracking PR tetap tampil
  var t = todayISO_();
  return rows.map(function (r) {
    var k = stripRow_(r);
    // nilai yang diketik langsung di Sheet dinormalkan
    k.status = kStatus_(k.status);
    if (k.komitmen && !isISO_(String(k.komitmen))) k.komitmen = pDate_(k.komitmen, t)[0] || String(k.komitmen);
    if (!k.prKey && k.prNo) k.prKey = keyOfPR_(k.prNo);
    if (k.itemNo !== '' && k.itemNo != null) k.itemNo = String(k.itemNo);
    if (!k.id) k.id = 'row' + r._row; // baris baru dari Sheet sebelum trigger memberi ID
    return k;
  }).filter(function (k) { return k.status !== 'batal' && (k.prNo || k.kendala); });
}
/** Cari baris kendala berdasarkan id (termasuk id sementara "rowN" untuk baris yang diketik di Sheet). */
function findKendalaRow_(rows, id) {
  var m = /^row(\d+)$/.exec(String(id || ''));
  return rows.filter(function (r) { return m ? r._row === +m[1] : r.id === id; })[0];
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
      var old = findKendalaRow_(rows, b.id);
      if (!old) fail_('invalid', 'Catatan kendala tidak ditemukan.');
      var r = stripRow_(old), changes = [];
      if (!r.id) r.id = 'k' + now.toString(36) + Utilities.getUuid().slice(0, 4);
      if (r.komitmen && !isISO_(String(r.komitmen))) r.komitmen = pDate_(r.komitmen, todayISO_())[0];
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
      var stNew = b.status === 'closed' ? 'selesai' : b.status === 'open' ? 'open' : kStatus_(r.status);
      if (stNew !== kStatus_(r.status)) {
        changes.push('status ' + (kStatus_(r.status) === 'selesai' ? 'closed' : 'open') + ' → ' + (stNew === 'selesai' ? 'closed' : 'open'));
        r.status = stNew === 'selesai' ? K_CLOSED : 'open'; r.selesaiAt = stNew === 'selesai' ? now : '';
      }
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
    var ss = db_(), rows = readTable_(ss, 'KENDALA'), old = findKendalaRow_(rows, b.id);
    if (!old) fail_('invalid', 'Catatan kendala tidak ditemukan.');
    var r = stripRow_(old), now = Date.now();
    if (!r.id) r.id = 'k' + now.toString(36) + Utilities.getUuid().slice(0, 4);
    r.status = kStatus_(r.status);
    if (op === 'followup') { r.followup = note; r.followupAt = now; addRiwayat_(r, me, 'follow-up: ' + note); }
    if (op === 'selesai') { if (r.status === 'selesai') fail_('invalid', 'Kendala sudah closed.'); r.status = K_CLOSED; r.selesaiAt = now; addRiwayat_(r, me, 'CLOSED' + (note ? ': ' + note : '')); }
    if (op === 'buka') { r.status = 'open'; r.selesaiAt = ''; addRiwayat_(r, me, 'dibuka lagi: ' + note); }
    if (op === 'batal') { r.status = 'batal'; addRiwayat_(r, me, 'dibatalkan: ' + note); }
    r.updatedAt = now; r.updatedBy = me.email;
    updateRow_(ss, 'KENDALA', old._row, r);
    log_(me.email, 'kendala:' + op, r.prNo + ' ' + note.slice(0, 80));
    return { id: r.id, status: r.status };
  });
}

/** Hapus permanen satu catatan kendala (baris dihapus dari tab KENDALA; isinya disimpan di LOG). */
function actHapusKendala_(me, b) {
  return withLock_(function () {
    var ss = db_(), rows = readTable_(ss, 'KENDALA'), old = findKendalaRow_(rows, b.id);
    if (!old) fail_('invalid', 'Catatan kendala tidak ditemukan (mungkin sudah dihapus).');
    var snap = stripRow_(old);
    ss.getSheetByName('KENDALA').deleteRow(old._row);
    log_(me.email, 'hapusKendala', JSON.stringify({ prNo: snap.prNo, itemNo: snap.itemNo, kendala: snap.kendala, action: snap.action, pic: snap.pic, komitmen: snap.komitmen, status: snap.status, alasan: pStr_(b.reason) }).slice(0, 480));
    return { id: snap.id };
  });
}

// ===== SheetEdit.gs =====
/**
 * SheetEdit.gs — supaya data bisa diedit DUA ARAH: dari aplikasi dan langsung dari Google Sheet.
 * - Tab KENDALA dirapikan: dropdown status/kategori/PIC, kolom tanggal komitmen berupa tanggal,
 *   kolom teknis disembunyikan.
 * - Trigger "saat Sheet diedit": baris kendala baru dari Sheet otomatis diberi ID, setiap perubahan
 *   dicatat di riwayat, dan aplikasi langsung membaca data terbaru (cache dibersihkan).
 * - Tab TX, ITEMS, LOG, PR_DATA diberi peringatan sebelum diedit (sebaiknya lewat aplikasi).
 */
var K_HIDE = ['prKey', 'itemId', 'selesaiAt', 'followupAt', 'createdAt', 'updatedAt'];
var K_STATUS = ['open', 'closed', 'batal'];

function colOf_(name, h) { return TABS[name].indexOf(h) + 1; }

/** Rapikan tab KENDALA untuk diedit manusia (aman dijalankan berulang). */
function rapikanTabKendala_() {
  try {
    var ss = db_(), sh = ss.getSheetByName('KENDALA'); if (!sh) return false;
    var n = Math.max(1, sh.getMaxRows() - 1), V = SpreadsheetApp.newDataValidation;
    var list = function (col, vals, help) { sh.getRange(2, colOf_('KENDALA', col), n, 1).setDataValidation(V().requireValueInList(vals, true).setAllowInvalid(col === 'pic').setHelpText(help).build()); };
    list('status', K_STATUS, 'open = belum selesai · closed = sudah selesai · batal');
    list('kategori', KENDALA_KAT, 'Kategori kendala');
    list('pic', picList_(), 'Pilih PIC; nama lain boleh diketik (akan ditambahkan ke daftar)');
    var kc = colOf_('KENDALA', 'komitmen'), kr = sh.getRange(2, kc, n, 1);
    kr.setDataValidation(V().requireDate().setAllowInvalid(false).setHelpText('Tanggal komitmen (klik dua kali untuk kalender)').build());
    // ubah teks "2026-11-15" (format lama) menjadi tanggal sungguhan
    var lr = sh.getLastRow();
    if (lr >= 2) {
      var vals = sh.getRange(2, kc, lr - 1, 1).getValues(), changed = false;
      vals = vals.map(function (r) { var v = r[0]; if (typeof v === 'string' && isISO_(v.trim())) { changed = true; var p = v.trim().split('-'); return [new Date(+p[0], +p[1] - 1, +p[2])]; } return [v]; });
      kr.setNumberFormat('yyyy-mm-dd');
      if (changed) sh.getRange(2, kc, lr - 1, 1).setValues(vals);
    } else kr.setNumberFormat('yyyy-mm-dd');
    var sc = colOf_('KENDALA', 'status');
    if (lr >= 2) { var sv = sh.getRange(2, sc, lr - 1, 1).getValues(), ch = false; sv = sv.map(function (r) { if (String(r[0]).trim().toLowerCase() === 'selesai') { ch = true; return [K_CLOSED]; } return r; }); if (ch) sh.getRange(2, sc, lr - 1, 1).setValues(sv); }
    K_HIDE.forEach(function (h) { try { sh.hideColumns(colOf_('KENDALA', h)); } catch (e) { /* abaikan */ } });
    [['kendala', 260], ['action', 260], ['riwayat', 320], ['itemDesc', 200], ['pic', 120], ['followup', 220]].forEach(function (w) { try { sh.setColumnWidth(colOf_('KENDALA', w[0]), w[1]); } catch (e) { } });
    sh.setFrozenRows(1);
    ['TX', 'ITEMS', 'LOG', 'PR_DATA'].forEach(function (t) {
      var s2 = ss.getSheetByName(t); if (!s2) return;
      try { if (!s2.getProtections || !s2.getProtections(SpreadsheetApp.ProtectionType.SHEET).length) s2.protect().setDescription('Diisi oleh aplikasi LoGistic Tracking').setWarningOnly(true); } catch (e) { }
    });
    return true;
  } catch (e) { return false; }
}

/** Pasang trigger "saat Sheet diedit" (sekali; aman dijalankan berulang). */
function ensureEditTrigger_() {
  try {
    var id = cfg_().dbId; if (!id) return false;
    var has = ScriptApp.getProjectTriggers().some(function (t) { return t.getHandlerFunction() === 'saatSheetDiedit'; });
    if (!has) ScriptApp.newTrigger('saatSheetDiedit').forSpreadsheet(id).onEdit().create();
    return true;
  } catch (e) { return false; }
}

/** Trigger edit: dipanggil Google setiap ada sel yang diedit langsung di Sheet. */
function saatSheetDiedit(e) {
  if (!e || !e.range) return;
  var sh = e.range.getSheet(), name = sh.getName(), row = e.range.getRow();
  if (name.trim().toUpperCase() === 'MASTER') { bumpMasterRev_(); bumpDataVersion_(); return; }
  if (name === 'TX' || name === 'ITEMS') { bumpDataVersion_(); return; }
  if (name !== 'KENDALA' || row < 2) return;
  var cols = TABS.KENDALA, nr = e.range.getNumRows ? e.range.getNumRows() : 1;
  var rng = sh.getRange(row, 1, nr, cols.length), vals = rng.getValues(), now = Date.now(), changed = false;
  var editedCol = e.range.getColumn(), header = cols[editedCol - 1] || '';
  vals.forEach(function (r) {
    var o = {}; cols.forEach(function (c, i) { o[c] = r[i]; });
    if (!o.prNo && !o.kendala) return; // baris kosong
    if (!o.id) { o.id = 'k' + now.toString(36) + Utilities.getUuid().slice(0, 4); o.createdAt = now; o.createdBy = 'Sheet'; o.riwayat = stamp_() + ' · Sheet: dibuat dari Sheet'; o.geser = 0; }
    if (o.prNo) o.prKey = keyOfPR_(o.prNo);
    if (!o.status) o.status = 'open';
    o.status = String(o.status).trim().toLowerCase(); if (kStatus_(o.status) === 'selesai') o.status = K_CLOSED;
    if (o.pic) o.pic = ensurePic_(cleanPic_(o.pic));
    if (header && header !== 'riwayat' && nr === 1 && e.oldValue !== undefined && String(e.oldValue) !== String(e.value)) {
      var old = e.oldValue, nv = e.value;
      if (header === 'komitmen') { o.geser = (+o.geser || 0) + 1; old = sheetDate_(old); nv = sheetDate_(nv); }
      if (header === 'status' && kStatus_(o.status) === 'selesai' && !o.selesaiAt) o.selesaiAt = now;
      o.riwayat = (String(o.riwayat || '') + '\n' + stamp_() + ' · Sheet: ' + header + ' ' + (old || '-') + ' → ' + (nv || '-')).trim().slice(-4000);
    }
    o.updatedAt = now; o.updatedBy = 'Sheet';
    cols.forEach(function (c, i) { if (r[i] !== o[c]) { r[i] = o[c]; changed = true; } });
  });
  if (changed) rng.setValues(vals);
  bumpDataVersion_();
}
/** Nilai tanggal dari event edit (angka serial Sheets / teks) → yyyy-mm-dd. */
function sheetDate_(v) {
  if (v === undefined || v === null || v === '') return '';
  var n = Number(v);
  if (!isNaN(n) && n > 20000 && n < 80000) return Utilities.formatDate(new Date(Math.round((n - 25569) * 864e5)), 'UTC', 'yyyy-MM-dd');
  return pDate_(v, todayISO_())[0] || String(v);
}

/** Menu / editor: rapikan tab KENDALA & pasang trigger edit. */
function aktifkanEditDariSheet() {
  var a = rapikanTabKendala_(), b = ensureEditTrigger_();
  console.log((a ? 'Tab KENDALA dirapikan (dropdown, tanggal, kolom teknis disembunyikan). ' : 'Tab KENDALA belum ada. ') + (b ? 'Trigger edit Sheet aktif.' : 'Trigger edit gagal dipasang.'));
}

// ===== PrEdit.gs =====
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

// ===== Foto.gs =====
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
  var day = todayISO_(), now = Date.now(), rows = [];
  var hhmmss = Utilities.formatDate(new Date(), tz_(), 'HHmmss'), safe = function (s) { return String(s).replace(/[^A-Za-z0-9-]+/g, ''); };
  var rc = relayCfg_(), store = rc.url ? 'relay' : 'local', desc = 'Surat jalan ' + prNo + (sj ? ' · SJ ' + sj : '') + (note ? ' · ' + note : '') + ' · diunggah ' + me.email;
  var prepared = files.map(function (f, i) {
    var mime = /^image\/(jpeg|png|webp)$/.test(f.mime) ? f.mime : 'image/jpeg';
    var bytes; try { bytes = Utilities.base64Decode(String(f.data || '')); } catch (e) { fail_('invalid', 'Foto ' + (i + 1) + ' rusak.'); }
    if (!bytes.length || bytes.length > FOTO_MAX_BYTES) fail_('invalid', 'Foto ' + (i + 1) + ' terlalu besar (maks 6 MB).');
    return { mime: mime, bytes: bytes, data: String(f.data), thumb: String(f.thumb || '').slice(0, 45000), name: 'SJ_' + safe(prNo) + (sj ? '_' + safe(sj) : '') + '_' + hhmmss + '_' + (i + 1) + (mime === 'image/png' ? '.png' : '.jpg') };
  });
  var saved; // [{fileId, url, name, size}]
  if (store === 'relay') {
    var res = relayCall_({ action: 'upload', day: day, description: desc, publicLink: rc.pub, files: prepared.map(function (x) { return { data: x.data, mime: x.mime, name: x.name }; }) });
    saved = res.files; day = res.folder || day;
  } else {
    var folder = folderPath_(['LoGistic Tracking', 'Surat Jalan', day]);
    saved = prepared.map(function (x) {
      var file = folder.createFile(Utilities.newBlob(x.bytes, x.mime, x.name));
      try { file.setDescription(desc); } catch (e) { }
      if (rc.pub) { try { file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW); } catch (e) { } }
      return { fileId: file.getId(), url: file.getUrl(), name: x.name, size: x.bytes.length };
    });
  }
  saved.forEach(function (sv, i) {
    rows.push({ id: 'f' + now.toString(36) + i + Utilities.getUuid().slice(0, 4), prKey: keyOfPR_(prNo), prNo: prNo, sjNo: sj, items: pStr_(b.items).slice(0, 200),
      fileId: sv.fileId, fileName: sv.name, folder: day, url: sv.url, size: sv.size, thumb: prepared[i].thumb,
      note: note, status: 'aktif', uploadedAt: now, uploadedBy: me.email, store: store });
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
  if (store === 'local' && !rc.pub) shareFotoWithPRTeam_(rows.map(function (r) { return r.fileId; }));
  log_(me.email, 'uploadSJ', prNo + (sj ? ' SJ ' + sj : '') + ' · ' + rows.length + ' foto → Surat Jalan/' + day + (link.ok ? ' · link di kolom V' : ' · link tidak ditulis: ' + link.reason));
  return { saved: rows.length, store: store, owner: store === 'relay' ? rc.owner : '', folder: 'LoGistic Tracking / Surat Jalan / ' + day, linkWritten: link.ok, linkNote: link.reason || '' };
}
/** Thumbnail semua foto 1 PR (untuk galeri). */
function actFotoThumbs_(b) {
  var key = keyOfPR_(pStr_(b.prNo));
  return readTable_(db_(), 'FOTO_SJ').filter(function (r) { return r.prKey === key && r.status !== 'dihapus'; })
    .map(function (r) { return { id: r.id, url: r.url, thumb: r.thumb, sjNo: r.sjNo, note: r.note, uploadedAt: r.uploadedAt, uploadedBy: r.uploadedBy, folder: r.folder }; });
}
/** Gambar ukuran penuh (base64) — dikirim lewat script agar file Drive tetap privat. */
function actFotoFull_(b) {
  var r = readTable_(db_(), 'FOTO_SJ').filter(function (x) { return x.id === b.id && x.status !== 'dihapus'; })[0];
  if (!r) fail_('invalid', 'Foto tidak ditemukan.');
  if (r.store === 'relay') { var x = relayCall_({ action: 'full', fileId: r.fileId }); return { id: r.id, mime: x.mime, data: x.data, name: r.fileName }; }
  var blob = DriveApp.getFileById(r.fileId).getBlob();
  return { id: r.id, mime: blob.getContentType(), data: Utilities.base64Encode(blob.getBytes()), name: r.fileName };
}
function actHapusFoto_(me, b) {
  var reason = pStr_(b.reason); if (!reason) fail_('invalid', 'Alasan wajib diisi.');
  return withLock_(function () {
    var ss = db_(), r = readTable_(ss, 'FOTO_SJ').filter(function (x) { return x.id === b.id; })[0];
    if (!r) fail_('invalid', 'Foto tidak ditemukan.');
    try { if (r.store === 'relay') relayCall_({ action: 'trash', fileId: r.fileId }); else DriveApp.getFileById(r.fileId).setTrashed(true); } catch (e) { }
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

// ---------- penyimpanan foto di Drive akun lain (relay, mis. prc.citrakd) ----------
function relayCfg_() {
  var p = props_();
  return { url: p.getProperty('FOTO_RELAY_URL') || '', key: p.getProperty('FOTO_RELAY_KEY') || '', owner: p.getProperty('FOTO_RELAY_OWNER') || '', pub: p.getProperty('FOTO_PUBLIC') !== '0' };
}
function relayCall_(body, cfg) {
  var c = cfg || relayCfg_();
  if (!c.url || !c.key) fail_('not_configured', 'Penyimpanan foto (relay) belum diatur.');
  var resp, j;
  try {
    resp = UrlFetchApp.fetch(c.url, { method: 'post', contentType: 'text/plain;charset=utf-8', payload: JSON.stringify(Object.assign({ key: c.key }, body)), muteHttpExceptions: true, followRedirects: true });
    j = JSON.parse(resp.getContentText());
  } catch (e) { fail_('relay', 'Script foto di akun penyimpan tidak bisa dihubungi. Periksa URL relay / deployment-nya. (' + (e.message || e) + ')'); }
  if (!j.ok) fail_('relay', 'Penyimpanan foto menolak: ' + j.message);
  return j.data;
}
function actFotoStoreInfo_() {
  var c = relayCfg_(), n = 0;
  try { n = readTable_(db_(), 'FOTO_SJ').filter(function (r) { return r.status !== 'dihapus' && r.store !== 'relay'; }).length; } catch (e) { }
  return { mode: c.url ? 'relay' : 'local', owner: c.owner, relayUrl: c.url ? c.url.replace(/\/s\/(.{6}).+(.{4})\/exec/, '/s/$1…$2/exec') : '', publicLink: c.pub, localCount: n };
}
/** Admin: pakai relay (url+key, diuji dulu dengan ping) atau kembali ke Drive pemilik script (mode local). */
function actSetFotoStore_(me, b) {
  var p = props_();
  if (typeof b.publicLink === 'boolean') p.setProperty('FOTO_PUBLIC', b.publicLink ? '1' : '0');
  if (b.mode === 'local') { ['FOTO_RELAY_URL', 'FOTO_RELAY_KEY', 'FOTO_RELAY_OWNER'].forEach(function (k) { p.deleteProperty(k); }); log_(me.email, 'fotoStore', 'local'); return actFotoStoreInfo_(); }
  if (b.mode === 'relay') {
    var url = pStr_(b.url) || relayCfg_().url, key = pStr_(b.key) || relayCfg_().key;
    if (!/^https:\/\/script\.google\.com\/macros\/s\/[\w-]+\/exec$/.test(url)) fail_('invalid', 'URL relay harus URL Web App Apps Script (…/exec).');
    if (!key) fail_('invalid', 'Kunci relay wajib diisi.');
    var ping = relayCall_({ action: 'ping' }, { url: url, key: key });
    p.setProperties({ FOTO_RELAY_URL: url, FOTO_RELAY_KEY: key, FOTO_RELAY_OWNER: ping.owner || '' });
    log_(me.email, 'fotoStore', 'relay → ' + ping.owner);
  }
  return actFotoStoreInfo_();
}
/** Admin: pindahkan foto lama (Drive pemilik script) ke penyimpanan relay, bertahap (maks 10 per panggilan). */
function actMigrateFoto_(me) {
  var c = relayCfg_(); if (!c.url) fail_('not_configured', 'Atur penyimpanan relay dulu.');
  return withLock_(function () {
    var ss = db_(), rows = readTable_(ss, 'FOTO_SJ').filter(function (r) { return r.status !== 'dihapus' && r.store !== 'relay'; });
    var batch = rows.slice(0, 10), prs = {}, moved = 0;
    batch.forEach(function (r) {
      var f = DriveApp.getFileById(r.fileId), blob = f.getBlob();
      var res = relayCall_({ action: 'upload', day: r.folder, publicLink: c.pub, description: 'Surat jalan ' + r.prNo + (r.sjNo ? ' · SJ ' + r.sjNo : '') + ' (dipindahkan)', files: [{ data: Utilities.base64Encode(blob.getBytes()), mime: blob.getContentType(), name: r.fileName }] });
      var o = stripRow_(r), sv = res.files[0]; o.fileId = sv.fileId; o.url = sv.url; o.store = 'relay';
      updateRow_(ss, 'FOTO_SJ', r._row, o);
      try { f.setTrashed(true); } catch (e) { }
      prs[r.prKey] = 1; moved++;
    });
    Object.keys(prs).forEach(writeFotoLinks_);
    log_(me.email, 'migrateFoto', moved + ' foto → ' + c.owner);
    return { moved: moved, remaining: rows.length - moved };
  });
}

// ===== Logic.gs =====
/**
 * Logic.gs — fungsi murni (tanpa layanan Google) untuk parsing log book PR,
 * perhitungan stok, dan validasi transaksi. Diporting dari artefak lama
 * Tracking PR & Tracking Stok agar hasil hitung identik.
 * File ini juga dipakai test runner Node (tests/run-tests.js).
 */

var STATUSES = ['Belum Release PR', 'Belum PO', 'Belum Terkirim', 'Close', 'Cancel'];
var TX_TYPES = ['pakai', 'pinjam', 'kembali', 'koreksi', 'serah'];
var KATS = ['Material', 'Alat', 'APD'];
function isKat_(k) { return KATS.indexOf(k) >= 0; }
/** Kategori dari teks Master/override: "alat…" → Alat, "apd…" → APD, lainnya → Material. */
function katFrom_(v) { var k = String(v || '').trim().toLowerCase(); if (!k) return ''; if (k.indexOf('alat') === 0) return 'Alat'; if (k.indexOf('apd') === 0) return 'APD'; return 'Material'; }
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
var APD_RE = /\b(apd|safety ?boot|sepatu safety|sepatu safty|safety shoes?|helm\b|helmet|sarung tangan|gloves?|rompi|vest|masker|respirator|kacamata|safety glass|goggles?|ear ?plug|ear ?muff|full ?body ?harn|body harness|harness|faceshield|face shield|kedok las|apron|wearpack|coverall|jas hujan|safety ?belt)/i;
function guessKat_(name) {
  if (APD_RE.test(name)) return 'APD';
  return /^(mata |kawat|batu )/i.test(name) ? 'Material' : (ALAT_RE.test(name) ? 'Alat' : 'Material');
}

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
        status: normStatus_(pStr_(r[19])), remarks: pStr_(r[20]), r: ri
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
    out.push({ key: key, name: name, unit: unit, kat: katFrom_(kr), awal: pNum_(r[3]) || 0, rak: pStr_(r[4]), min: pNum_(r[5]), note: pStr_(r[6]) });
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
    if (!M[key]) M[key] = { key: key, name: name, unit: unit, kat: '', katSrc: '', awal: 0, rak: '', min: null, note: '', inMaster: false, inApp: false, hidden: false, inQty: 0, outQty: 0, serahQty: 0, loanQty: 0, retQty: 0, adj: 0, last: '', ins: [], reqs: [] };
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
    if (isKat_(o.kat)) { it.kat = o.kat; it.katSrc = 'app'; }
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
    else if (t.type === 'serah') it.serahQty += q;
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
    it.stok = round3_(it.awal + it.inQty - it.outQty - it.serahQty - it.loanQty + it.retQty + it.adj);
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
  if ((type === 'pakai' || type === 'pinjam' || type === 'serah') && !pStr_(t.person)) return { error: (type === 'pinjam' ? 'Nama peminjam' : type === 'serah' ? 'Nama penerima APD' : 'Nama penerima') + ' wajib diisi.' };
  return {
    tx: {
      type: type, key: it.key, name: it.name, unit: it.unit, kat: it.kat, qty: round3_(qty), date: date,
      person: pStr_(t.person).slice(0, 80), purpose: pStr_(t.purpose).slice(0, 120), cond: pStr_(t.cond).slice(0, 80),
      note: pStr_(t.note).slice(0, 300), loanId: pStr_(t.loanId), reason: pStr_(t.reason).slice(0, 200)
    }
  };
}

if (typeof module !== 'undefined') {
  module.exports = { guessKat_, katFrom_, pDate_, pNum_, parsePR_, parseMaster_, prToStockFeed_, buildStock_, openLoans_, validateLedgerChange_, cleanTx_, stockKey_, findHeaderRow_, isVoid_ };
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
