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
