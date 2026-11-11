/* Test Opsi B: foto disimpan & dimiliki akun lain (prc.citrakd) lewat script relay.
 * Dua emulator: aplikasi utama (ahadaja) dan relay (prc.citrakd), dihubungkan UrlFetchApp. */
const assert = require('assert');
const { createEnv } = require('./gas-emulator');
let pass = 0, fail = 0;
function t(name, fn) { try { fn(); pass++; console.log('🟩 PASS', name); } catch (e) { fail++; console.log('🟥 FAIL', name, '\n   ', e.stack.split('\n').slice(0, 3).join('\n    ')); } }
const D = s => new Date(s + 'T00:00:00+07:00');
const relay = createEnv({ dir: 'relay', email: 'prc.citrakd@gmail.com' }), renv = relay.__env;
let calls = 0;
const MID = 'MASTERGSHEET0000000000000000000000000000RL', PID = 'PRSHEETRELAY000000000000000000000000000001';
const g = createEnv({ boundId: MID, email: 'ahadaja@gmail.com', urlFetch: (url, p) => { calls++; return relay.doPost({ postData: { contents: p.payload } }).content; } }), env = g.__env;
env.__addSheetFile(MID, 'Master', 'MASTER', [['Nama Barang', 'Satuan']]);
env.__addSheetFile(PID, 'TRACKING PR', 'Tracking PR', [
  ['No.', 'Deskripsi', 'Qty', 'Sat', 'Tanggal PR', 'No. PR', 'Tgl', 'QTY', 'Sat', 'Balance', 'Rel', 'PO', 'No. PO', 'ETA', 'QTY', 'Sat', 'Terima', 'NO. SJ', 'SUPPLIER', 'STATUS', 'REMARKS'],
  [1, 'Wire Mesh', 40, 'lbr', D('2026-11-07'), 'PR-078', '', '', '', '', '', '', '', '', 40, 'lbr', D('2026-11-11'), '1301', 'CV BAJA', 'Close', ''],
  [2, 'Kawat', 10, 'kg', D('2026-11-07'), 'PR-078', '', '', '', '', '', '', '', '', '', '', '', '', '', 'Belum Terkirim', '']]);
g.setup();
const tok = g.post({ action: 'setupAdmin', setupKey: env.__props.SETUP_KEY, email: 'ahadaja@gmail.com', password: 'rahasia123' }).data.token;
g.post({ action: 'setSources', token: tok, prUrl: PID });
const JPG = Buffer.from([0xff, 0xd8, 1, 2, 3, 0xff, 0xd9]).toString('base64');
const URL_ = 'https://script.google.com/macros/s/AKfycbRELAY123456789/exec';

let oldId;
t('Sebelum relay: foto tersimpan di Drive pemilik script (mode local) & link publik default', () => {
  const r = g.post({ action: 'uploadSJ', token: tok, prNo: 'PR-078', sjNo: '1301', files: [{ data: JPG, thumb: 'eA==' }] });
  assert.ok(r.ok, r.message); assert.strictEqual(r.data.store, 'local');
  const f = Object.values(env.__files).find(x => /^SJ_PR-078/.test(x.name)); assert.strictEqual(f.owner, 'ahadaja@gmail.com'); assert.strictEqual(f.sharing, 'ANYONE_WITH_LINK:VIEW');
  oldId = g.post({ action: 'getPR', token: tok }).data.foto[0].id;
});
t('Relay: setup membuat kunci & folder di Drive prc.citrakd; kunci salah ditolak', () => {
  relay.setup(); assert.ok(renv.__props.RELAY_KEY);
  assert.ok(Object.values(renv.__folders).some(f => f.name === 'Surat Jalan'));
  assert.strictEqual(g.post({ action: 'setFotoStore', token: tok, mode: 'relay', url: URL_, key: 'salah' }).code, 'relay');
  assert.strictEqual(g.post({ action: 'setFotoStore', token: tok, mode: 'relay', url: 'https://contoh.com/x', key: 'k' }).code, 'invalid');
  assert.strictEqual(g.post({ action: 'setFotoStore', mode: 'relay', url: URL_, key: 'k' }).code, 'unauthorized', 'hanya admin');
});
t('Pengaturan relay: diuji dengan ping, pemilik terdeteksi prc.citrakd', () => {
  const r = g.post({ action: 'setFotoStore', token: tok, mode: 'relay', url: URL_, key: renv.__props.RELAY_KEY });
  assert.ok(r.ok, r.message); assert.strictEqual(r.data.mode, 'relay'); assert.strictEqual(r.data.owner, 'prc.citrakd@gmail.com'); assert.strictEqual(r.data.localCount, 1);
  const st = g.post({ action: 'getSettings', token: tok }).data.fotoStore; assert.ok(!JSON.stringify(st).includes(renv.__props.RELAY_KEY), 'kunci tidak dikirim ke browser');
});
let newId;
t('Upload baru: file DIMILIKI prc.citrakd, di folder Surat Jalan/<hari>, link publik, link kolom V tertulis', () => {
  const before = Object.keys(env.__files).length;
  const r = g.post({ action: 'uploadSJ', token: tok, prNo: 'PR-078', sjNo: '1301', files: [{ data: JPG, thumb: 'eQ==' }, { data: JPG }] });
  assert.ok(r.ok, r.message); assert.strictEqual(r.data.store, 'relay'); assert.strictEqual(r.data.owner, 'prc.citrakd@gmail.com'); assert.ok(r.data.linkWritten);
  assert.strictEqual(Object.keys(env.__files).length, before, 'tidak ada file baru di Drive ahadaja');
  const rf = Object.values(renv.__files).filter(f => /^SJ_PR-078_1301/.test(f.name)); assert.strictEqual(rf.length, 2);
  assert.ok(rf.every(f => f.owner === 'prc.citrakd@gmail.com' && f.sharing === 'ANYONE_WITH_LINK:VIEW'));
  const today = g.get({ action: 'status' }).data.today, day = Object.values(renv.__folders).find(f => f.name === today); assert.ok(day && rf.every(f => f.folder === day.id));
  const foto = g.post({ action: 'getPR', token: tok }).data.foto.filter(f => f.store === 'relay'); assert.strictEqual(foto.length, 2); newId = foto[0].id;
  const v = env.SpreadsheetApp.openById(PID).getSheets()[0].data.find(x => x[1] === 'Wire Mesh')[21]; assert.ok(/SJ 1301 .* \| .*#2 \| .*#3/.test(v), v);
});
t('Viewer (PIN) & admin bisa melihat foto ukuran penuh dari Drive prc.citrakd', () => {
  assert.ok(g.post({ action: 'setViewerPin', token: tok, pin: '246810' }).ok);
  const vt = g.post({ action: 'viewerLogin', pin: '246810' }).data.token;
  const full = g.post({ action: 'fotoFull', token: vt, id: newId }); assert.ok(full.ok, full.message); assert.strictEqual(full.data.data, JPG);
  assert.ok(g.post({ action: 'fotoThumbs', token: vt, prNo: 'PR-078' }).data.length === 3);
  assert.ok(g.post({ action: 'fotoFull', token: tok, id: oldId }).ok, 'foto lama (local) tetap bisa dibuka');
});
t('Pindahkan foto lama ke Drive prc.citrakd: file lama ke Sampah, catatan & link diperbarui', () => {
  const r = g.post({ action: 'migrateFoto', token: tok }); assert.ok(r.ok, r.message); assert.strictEqual(r.data.moved, 1); assert.strictEqual(r.data.remaining, 0);
  const f = g.post({ action: 'getPR', token: tok }).data.foto.find(x => x.id === oldId); assert.strictEqual(f.store, 'relay');
  assert.ok(Object.values(env.__files).find(x => /^SJ_PR-078/.test(x.name)).trashed);
  assert.strictEqual(Object.values(renv.__files).filter(x => /^SJ_PR-078/.test(x.name)).length, 3);
  assert.strictEqual(g.post({ action: 'getSettings', token: tok }).data.fotoStore.localCount, 0);
});
t('Hapus foto relay → file di Drive prc.citrakd ke Sampah', () => {
  assert.ok(g.post({ action: 'hapusFoto', token: tok, id: newId, reason: 'buram' }).ok);
  assert.strictEqual(Object.values(renv.__files).filter(x => x.trashed).length, 1);
});
t('Relay mati → upload gagal dengan pesan jelas; mode local bisa dipulihkan', () => {
  renv.__props.RELAY_KEY = 'diganti';
  const r = g.post({ action: 'uploadSJ', token: tok, prNo: 'PR-078', files: [{ data: JPG }] }); assert.strictEqual(r.code, 'relay'); assert.ok(/menolak/.test(r.message));
  assert.ok(g.post({ action: 'setFotoStore', token: tok, mode: 'local' }).data.mode === 'local');
  assert.strictEqual(g.post({ action: 'uploadSJ', token: tok, prNo: 'PR-078', files: [{ data: JPG }] }).data.store, 'local');
});
t('Link publik bisa dimatikan', () => {
  assert.strictEqual(g.post({ action: 'setFotoStore', token: tok, publicLink: false }).data.publicLink, false);
  g.post({ action: 'uploadSJ', token: tok, prNo: 'PR-078', sjNo: 'X9', files: [{ data: JPG }] });
  const f = Object.values(env.__files).find(x => /_X9_/.test(x.name)); assert.ok(!f.sharing, 'tidak publik');
});
console.log(`\nHasil: ${pass} PASS, ${fail} FAIL  (panggilan relay: ${calls})`);
process.exit(fail ? 1 : 0);
