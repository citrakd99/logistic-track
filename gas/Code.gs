/**
 * LoGistic Tracking — API (Google Apps Script Web App)
 * Deploy: Execute as = Me, Who has access = Anyone.
 *
 * GET  ?action=status | pr | stock         → publik (viewer)
 * POST {action, token?, ...} (text/plain)   → login, setupAdmin, dan aksi admin
 */

var APP_VERSION = '1.0.0';
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
      case 'setAutoSync': setAutoSync_(b.on !== false); log_(me.email, 'setAutoSync', String(b.on !== false)); return actGetSettings_();
    }
    fail_('invalid', 'Aksi tidak dikenal.');
  });
}

function actStatus_() {
  var c = cfg_();
  return { app: 'LoGistic Tracking', version: APP_VERSION, bound: c.bound, needsSetup: needsSetup_(), configured: { pr: !!c.prId, master: !!c.masterId, db: !!c.dbId }, today: todayISO_() };
}

function srcView_(id) {
  if (!id) return null;
  try { var i = fileInfo_(id, true); return { id: id, name: i.name, url: i.url, updated: i.updated, type: i.mime === MimeType.GOOGLE_SHEETS ? 'Google Sheet' : 'File Excel (.xlsx)' }; }
  catch (e) { return { id: id, error: e.message }; }
}
function actGetSettings_() {
  var c = cfg_(), at = props_().getProperty('PR_SYNCED_AT');
  return { bound: c.bound, pr: srcView_(c.prId), master: srcView_(c.masterId), db: srcView_(c.dbId), prCopiedAt: at ? +at : null, autoSync: autoSyncOn_() };
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
