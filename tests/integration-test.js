/* Test integrasi: menjalankan kode gas/*.gs asli di emulator Apps Script.
 * Jalankan: node tests/integration-test.js [path-pr.xlsx] */
const assert = require('assert');
const { createEnv, prRowsFromXlsx } = require('./gas-emulator');
let pass = 0, fail = 0;
function t(name, fn) { try { fn(); pass++; console.log('🟩 PASS', name); } catch (e) { fail++; console.log('🟥 FAIL', name, '\n   ', e.message); } }

const g = createEnv(), env = g.__env;
const prFile = process.argv[2];
const prRows = [
  ['No.', 'Deskripsi', 'Qty', 'Sat', 'Tanggal', 'PR'], [],
  [1, 'Helm Orange + Tali Dagu NSA', 20, 'pcs', '2026-11-01', 'PR-001', '', '', '', '', '', '', '', '', 12, 'pcs', '2026-11-05', 'SJ1', 'Toko A', 'Close', ''],
  [2, 'Mesin Bor', 2, 'unit', '2026-11-01', 'PR-001', '', '', '', '', '', '', '', '', '', '', '', '', '', 'Belum PO', '']
];
const MASTER = [['MASTER'], ['Nama Barang', 'Satuan', 'Kategori', 'Stok Awal', 'Lokasi Rak', 'Stok Minimum', 'Catatan'],
  ['Sepatu Safety Boot Kuning uk. 41', 'Pasang', 'Material', 4, 'A1', 2, ''], ['Mesin Bor', 'Unit', 'Alat', 3, 'B2', '', ''], ['Sub Panel 3&4', 'unit', '', 1, '', '', '']];
env.__addSheetFile('PRSHEETID00000000000000000000000000000000001', 'TRACKING PR SAFRAN', 'TRACKING PR', prRows);
env.__addXlsxFile('MASTERXLSX00000000000000000001', 'Master Stok.xlsx', MASTER);

let tok;
t('status awal: perlu setup, belum dikonfigurasi', () => { const r = g.get({ action: 'status' }); assert.ok(r.ok); assert.strictEqual(r.data.needsSetup, true); assert.strictEqual(r.data.configured.pr, false); });
t('GET pr sebelum dikonfigurasi → not_configured', () => { const r = g.get({ action: 'pr' }); assert.strictEqual(r.code, 'not_configured'); });
t('setup() membuat kode; kode salah ditolak', () => { g.setup(); assert.ok(env.__props.SETUP_KEY); const r = g.post({ action: 'setupAdmin', setupKey: 'SALAH', email: 'a@x.co', password: 'rahasia123' }); assert.strictEqual(r.code, 'unauthorized'); });
t('setupAdmin dengan kode benar → token; kode setup terhapus', () => {
  const r = g.post({ action: 'setupAdmin', setupKey: env.__props.SETUP_KEY, name: 'Ahad', email: 'Ahad@Example.com', password: 'rahasia123' });
  assert.ok(r.ok, r.message); tok = r.data.token; assert.ok(!env.__props.SETUP_KEY); assert.strictEqual(r.data.email, 'ahad@example.com');
});
t('setupAdmin kedua ditolak', () => assert.strictEqual(g.post({ action: 'setupAdmin', setupKey: 'X', email: 'b@x.co', password: 'rahasia123' }).code, 'forbidden'));
t('aksi admin tanpa token / token palsu → unauthorized', () => {
  assert.strictEqual(g.post({ action: 'saveTx', lines: [] }).code, 'unauthorized');
  assert.strictEqual(g.post({ action: 'saveTx', token: tok.split('.')[0] + '.AAAA', lines: [] }).code, 'unauthorized');
});
t('setSources: link tidak valid ditolak', () => assert.strictEqual(g.post({ action: 'setSources', token: tok, prUrl: 'bukan link' }).code, 'invalid'));
t('setSources: PR (Google Sheet) + Master (.xlsx) → Data Sheet dibuat otomatis', () => {
  const r = g.post({ action: 'setSources', token: tok, prUrl: 'https://docs.google.com/spreadsheets/d/PRSHEETID00000000000000000000000000000000001/edit', masterUrl: 'https://docs.google.com/spreadsheets/d/MASTERXLSX00000000000000000001/edit?rtpof=true' });
  assert.ok(r.ok, r.message); assert.ok(r.data.dbCreated); assert.strictEqual(r.data.master.items, 3);
  assert.ok(!Object.keys(env.__files).some(k => k.startsWith('tmp')), 'file sementara konversi .xlsx harus terhapus');
});
let pr, st;
t('GET pr publik', () => { const r = g.get({ action: 'pr' }); assert.ok(r.ok, r.message); pr = r.data; assert.ok(pr.items.length >= 2); console.log('    ' + pr.items.length + ' item, ' + pr.prs.length + ' PR'); });
t('GET stock publik: master + PR tergabung', () => {
  const r = g.get({ action: 'stock' }); assert.ok(r.ok, r.message); st = r.data;
  const bor = st.items.find(i => i.name === 'Mesin Bor'); assert.ok(bor); assert.strictEqual(bor.awal, 3); assert.strictEqual(bor.kat, 'Alat');
});
const key = n => st.items.find(i => i.name === n).key;
const T = '2026-11-09';
t('saveTx: pakai melebihi stok ditolak dengan pesan jelas', () => {
  const r = g.post({ action: 'saveTx', token: tok, lines: [{ type: 'pakai', key: key('Sepatu Safety Boot Kuning uk. 41'), qty: 5, date: T, person: 'Budi' }] });
  assert.strictEqual(r.code, 'invalid'); assert.ok(/tidak cukup/.test(r.message), r.message);
});
t('saveTx multi-baris: pakai 3 sepatu + pinjam 2 bor', () => {
  const r = g.post({ action: 'saveTx', token: tok, lines: [{ type: 'pakai', key: key('Sepatu Safety Boot Kuning uk. 41'), qty: 3, date: T, person: 'Budi', purpose: 'Area B' }, { type: 'pinjam', key: key('Mesin Bor'), qty: 2, date: T, person: 'Andi' }] });
  assert.ok(r.ok, r.message); assert.strictEqual(r.data.saved, 2);
});
t('cache publik ter-invalidasi setelah simpan: stok sepatu 1 (menipis), bor dipinjam 2', () => {
  st = g.get({ action: 'stock' }).data;
  const s = st.items.find(i => i.name.startsWith('Sepatu')); assert.strictEqual(s.stok, 1); assert.strictEqual(s.status, 'low');
  assert.strictEqual(st.items.find(i => i.name === 'Mesin Bor').dipinjam, 2); assert.strictEqual(st.loans.length, 1);
});
t('kembali 1 bor → sisa pinjam 1; kembali 5 ditolak', () => {
  const loan = st.loans[0];
  assert.ok(g.post({ action: 'saveTx', token: tok, lines: [{ type: 'kembali', loanId: loan.id, key: loan.key, qty: 1, date: T, person: 'Andi', cond: 'Baik' }] }).ok);
  assert.strictEqual(g.post({ action: 'saveTx', token: tok, lines: [{ type: 'kembali', loanId: loan.id, key: loan.key, qty: 5, date: T, person: 'Andi' }] }).code, 'invalid');
  st = g.get({ action: 'stock' }).data; assert.strictEqual(st.loans[0].sisa, 1);
});
t('void pinjam yang sudah punya kembali ditolak', () => assert.strictEqual(g.post({ action: 'voidTx', token: tok, id: st.loans[0].id, reason: 'salah' }).code, 'invalid'));
t('editTx pinjam: id tetap → pengembalian tetap terhubung', () => {
  const loan = st.loans[0];
  const r = g.post({ action: 'editTx', token: tok, id: loan.id, tx: { key: loan.key, qty: 3, date: T, person: 'Andi S.' }, reason: 'salah jumlah' });
  assert.ok(r.ok, r.message); assert.strictEqual(r.data.id, loan.id);
  st = g.get({ action: 'stock' }).data; assert.strictEqual(st.loans[0].sisa, 2); assert.strictEqual(st.items.find(i => i.name === 'Mesin Bor').stok, 1);
  assert.strictEqual(st.tx.filter(x => x.void === true).length, 1);
});
t('editTx pakai sepatu 3→5 ditolak (stok kurang), 3→2 diterima', () => {
  const p = st.tx.find(x => x.type === 'pakai' && x.void !== true);
  assert.strictEqual(g.post({ action: 'editTx', token: tok, id: p.id, tx: { key: p.key, qty: 5, date: T, person: 'Budi' }, reason: 'x' }).code, 'invalid');
  assert.ok(g.post({ action: 'editTx', token: tok, id: p.id, tx: { key: p.key, qty: 2, date: T, person: 'Budi' }, reason: 'x' }).ok);
  st = g.get({ action: 'stock' }).data; assert.strictEqual(st.items.find(i => i.name.startsWith('Sepatu')).stok, 2);
});
t('koreksi tanpa alasan ditolak; koreksi -1 dengan alasan diterima', () => {
  const k = key('Sub Panel 3&4');
  assert.strictEqual(g.post({ action: 'saveTx', token: tok, lines: [{ type: 'koreksi', key: k, qty: -1, date: T }] }).code, 'invalid');
  assert.ok(g.post({ action: 'saveTx', token: tok, lines: [{ type: 'koreksi', key: k, qty: -1, date: T, reason: 'opname' }] }).ok);
});
t('saveItem: tambah barang baru, duplikat ditolak, edit kategori+min', () => {
  assert.ok(g.post({ action: 'saveItem', token: tok, name: 'Kabel NYM 3x2.5', unit: 'roll', kat: 'Material', awal: 5, min: 2 }).ok);
  assert.strictEqual(g.post({ action: 'saveItem', token: tok, name: 'kabel nym 3x2,5', unit: 'Rol', kat: 'Material' }).code, 'invalid');
  st = g.get({ action: 'stock' }).data;
  const kb = st.items.find(i => i.name === 'Kabel NYM 3x2.5'); assert.strictEqual(kb.stok, 5); assert.ok(kb.inApp);
  assert.ok(g.post({ action: 'saveItem', token: tok, key: kb.key, kat: 'Alat', awal: 5, min: 1, rak: 'C3' }).ok);
  st = g.get({ action: 'stock' }).data; const k2 = st.items.find(i => i.key === kb.key); assert.strictEqual(k2.kat, 'Alat'); assert.strictEqual(k2.rak, 'C3');
});
t('hideItem: barang masih ada stok ditolak; stok 0 boleh', () => {
  assert.strictEqual(g.post({ action: 'hideItem', token: tok, key: key('Kabel NYM 3x2.5') }).code, 'invalid');
  assert.ok(g.post({ action: 'hideItem', token: tok, key: key('Sub Panel 3&4') }).ok);
  st = g.get({ action: 'stock' }).data; assert.ok(st.items.find(i => i.name === 'Sub Panel 3&4').hidden);
});
t('seed kategori lama: 27 penanda masuk, dijalankan 2x tidak dobel', () => {
  g.seedKategoriAlatDariAppLama(); g.seedKategoriAlatDariAppLama();
  const ss = env.SpreadsheetApp.openById(env.__props.DB_ID); const rows = ss.getSheetByName('ITEMS').getLastRow() - 1;
  assert.ok(rows >= 27 && rows <= 30, 'baris ITEMS: ' + rows);
});
t('admin: tambah admin ke-2, login, hapus diri sendiri ditolak', () => {
  assert.ok(g.post({ action: 'addAdmin', token: tok, name: 'Rina', email: 'rina@x.co', password: 'password99' }).ok);
  const l = g.post({ action: 'login', email: 'rina@x.co', password: 'password99' }); assert.ok(l.ok);
  assert.strictEqual(g.post({ action: 'removeAdmin', token: l.data.token, email: 'rina@x.co' }).code, 'invalid');
});
t('login salah 5x → terkunci', () => {
  for (let i = 0; i < 5; i++) g.post({ action: 'login', email: 'rina@x.co', password: 'salah' });
  assert.strictEqual(g.post({ action: 'login', email: 'rina@x.co', password: 'password99' }).code, 'locked');
});
t('ganti password → token lama tidak berlaku', () => {
  const r = g.post({ action: 'changePassword', token: tok, oldPassword: 'rahasia123', newPassword: 'rahasiaBaru1' }); assert.ok(r.ok, r.message);
  assert.strictEqual(g.post({ action: 'me', token: tok }).code, 'forbidden'); assert.ok(g.post({ action: 'me', token: r.data.token }).ok);
});
t('LOG mencatat aksi admin', () => { const ss = env.SpreadsheetApp.openById(env.__props.DB_ID); assert.ok(ss.getSheetByName('LOG').getLastRow() > 10); });
t('Mode script di Master: cukup link PR → PR disalin ke tab PR_DATA di Master', () => {
  const MID = 'MASTERGSHEET000000000000000000000000000001';
  const h = createEnv({ boundId: MID }), e3 = h.__env;
  e3.__addSheetFile(MID, 'Master Stok', 'MASTER', MASTER.slice(1));
  e3.__addSheetFile('PRSHEETID00000000000000000000000000000000002', 'TRACKING PR SAFRAN', 'Tracking PR', prRows);
  h.setup();
  const ms = e3.SpreadsheetApp.openById(MID);
  assert.ok(['TX', 'ITEMS', 'LOG'].every(n => ms.getSheetByName(n)), 'tab TX/ITEMS/LOG dibuat di Master');
  const a = h.post({ action: 'setupAdmin', setupKey: e3.__props.SETUP_KEY, email: 'a@x.co', password: 'rahasia123' }).data.token;
  assert.strictEqual(h.get({ action: 'status' }).data.bound, true);
  const r = h.post({ action: 'setSources', token: a, prUrl: 'https://docs.google.com/spreadsheets/d/PRSHEETID00000000000000000000000000000000002/edit?usp=sharing' });
  assert.ok(r.ok, r.message); assert.ok(!r.data.dbCreated, 'tidak boleh membuat Data Sheet baru'); assert.ok(!e3.__props.DB_ID && !e3.__props.MASTER_ID);
  const copy = ms.getSheetByName('PR_DATA'); assert.ok(copy && copy.getLastRow() >= 4, 'PR_DATA terisi');
  const st = h.get({ action: 'stock' }); assert.ok(st.ok, st.message);
  assert.strictEqual(st.data.items.find(i => i.name === 'Mesin Bor').awal, 3, 'master dibaca dari tab MASTER file ini');
  const helm = st.data.items.find(i => /^Helm Orange/.test(i.name)); assert.strictEqual(helm.inQty, 12, 'barang masuk dari PR');
  // sumber PR berubah → muat ulang (fresh) menyalin ulang
  const src = e3.__files.PRSHEETID00000000000000000000000000000000002; src.ss.sheets[0].data[2][14] = 20; src.updated = Date.now() + 1000;
  const st2 = h.get({ action: 'stock', fresh: '1' }).data; assert.strictEqual(st2.items.find(i => /^Helm Orange/.test(i.name)).inQty, 20);
  assert.strictEqual(String(copy.data[3][14]), '20', 'PR_DATA ikut diperbarui');
  const s2 = h.post({ action: 'setAutoSync', token: a, on: true }); assert.ok(s2.data.autoSync);
  h.syncPR(); // tidak error saat tidak ada perubahan
});
if (prFile) t('Smoke data nyata: Tracking PR SAFRAN lewat setSources + GET pr/stock', () => {
  const h = createEnv(), e2 = h.__env; h.setup();
  e2.__addSheetFile('REALPRSHEET000000000000000000000000000000001', 'TRACKING PR SAFRAN', 'TRACKING PR', prRowsFromXlsx(prFile));
  const a = h.post({ action: 'setupAdmin', setupKey: e2.__props.SETUP_KEY, email: 'a@x.co', password: 'rahasia123' }).data.token;
  const s = h.post({ action: 'setSources', token: a, prUrl: 'REALPRSHEET000000000000000000000000000000001' }); assert.ok(s.ok, s.message);
  const p = h.get({ action: 'pr' }), k = h.get({ action: 'stock' }); assert.ok(p.ok && k.ok);
  console.log(`    ${p.data.items.length} item PR, ${k.data.items.length} jenis barang stok, payload stok ${Math.round(JSON.stringify(k.data).length / 1024)} KB`);
});
console.log(`\nHasil: ${pass} PASS, ${fail} FAIL`);
process.exit(fail ? 1 : 0);
