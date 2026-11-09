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
