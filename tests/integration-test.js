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
t('setKat: koreksi cepat 2 barang ke APD, kategori tidak valid ditolak, data lain tetap', () => {
  const k1 = key('Sepatu Safety Boot Kuning uk. 41'), k2 = key('Kabel NYM 3x2.5');
  assert.strictEqual(g.post({ action: 'setKat', token: tok, keys: [k1], kat: 'Barang' }).code, 'invalid');
  const r = g.post({ action: 'setKat', token: tok, keys: [k1, k2], kat: 'APD' }); assert.ok(r.ok, r.message); assert.strictEqual(r.data.updated, 2);
  st = g.get({ action: 'stock' }).data;
  const a = st.items.find(i => i.key === k1), b = st.items.find(i => i.key === k2);
  assert.strictEqual(a.kat, 'APD'); assert.strictEqual(a.katSrc, 'app'); assert.strictEqual(a.rak, 'A1', 'rak dari Master tetap');
  assert.strictEqual(b.kat, 'APD'); assert.strictEqual(b.rak, 'C3', 'rak hasil edit tetap');
  const sv = g.post({ action: 'saveTx', token: tok, lines: [{ type: 'serah', key: k1, qty: 1, date: T, person: 'Joko', purpose: 'Rigger' }] }); assert.ok(sv.ok, sv.message);
});
t('Kendala PR: buat, validasi, geser komitmen wajib alasan, follow-up, selesai, batal', () => {
  const it = pr.items[0];
  const base = { action: 'saveKendala', token: tok, prNo: it.prNo, itemNo: it.no, itemId: it.id, itemDesc: it.desc, kategori: 'Vendor/Supplier', kendala: 'Stok supplier kosong', rencana: 'Cari vendor alternatif', pic: 'Rina (Procurement)', komitmen: '2026-11-12' };
  assert.strictEqual(g.post(Object.assign({}, base, { pic: '' })).code, 'invalid');
  assert.strictEqual(g.post(Object.assign({}, base, { komitmen: '' })).code, 'invalid');
  assert.strictEqual(g.post(Object.assign({}, base, { token: undefined })).code, 'unauthorized', 'viewer tidak bisa menulis');
  const c = g.post(base); assert.ok(c.ok, c.message);
  const prLvl = g.post(Object.assign({}, base, { itemNo: '', itemId: '', kendala: 'Budget belum release', kategori: 'Budget/Harga' })); assert.ok(prLvl.ok);
  let k = g.get({ action: 'pr' }).data.kendala; assert.strictEqual(k.length, 2);
  assert.strictEqual(k.find(x => x.id === c.data.id).status, 'open');
  assert.strictEqual(g.post(Object.assign({}, base, { id: c.data.id, komitmen: '2026-11-15' })).code, 'invalid', 'geser tanpa alasan ditolak');
  assert.ok(g.post(Object.assign({}, base, { id: c.data.id, komitmen: '2026-11-15', alasanGeser: 'vendor minta tambahan 3 hari' })).ok);
  assert.strictEqual(g.post({ action: 'kendalaStatus', token: tok, id: c.data.id, op: 'followup', note: '' }).code, 'invalid');
  assert.ok(g.post({ action: 'kendalaStatus', token: tok, id: c.data.id, op: 'followup', note: 'Vendor B sanggup kirim 14 Nov' }).ok);
  assert.ok(g.post({ action: 'kendalaStatus', token: tok, id: c.data.id, op: 'selesai', note: 'barang datang' }).ok);
  assert.ok(g.post({ action: 'kendalaStatus', token: tok, id: prLvl.data.id, op: 'batal', note: 'salah input' }).ok);
  k = g.get({ action: 'pr' }).data.kendala; const one = k.find(x => x.id === c.data.id);
  assert.strictEqual(k.length, 1, 'yang batal tidak tampil'); assert.strictEqual(one.status, 'selesai'); assert.strictEqual(+one.geser, 1);
  assert.strictEqual(one.komitmen, '2026-11-15'); assert.strictEqual(one.followup, 'Vendor B sanggup kirim 14 Nov');
  assert.ok(/komitmen 2026-11-12 → 2026-11-15 \(vendor minta tambahan 3 hari\)/.test(one.riwayat), one.riwayat);
  assert.strictEqual(String(one.itemNo), String(it.no));
});
t('Kendala: edit status open/closed, Sheet berisi "closed", hapus permanen + LOG', () => {
  const it = pr.items[1], ss = env.SpreadsheetApp.openById(env.__props.DB_ID);
  const c = g.post({ action: 'saveKendala', token: tok, prNo: it.prNo, itemNo: it.no, kategori: 'Lainnya', kendala: 'Uji close', rencana: 'cek', pic: 'Ahad', komitmen: '2026-11-20' }); assert.ok(c.ok, c.message);
  const kf = () => g.get({ action: 'pr' }).data.kendala.find(x => x.id === c.data.id);
  const base = { action: 'saveKendala', token: tok, id: c.data.id, kategori: 'Lainnya', kendala: 'Uji close', rencana: 'cek', pic: 'Ahad', komitmen: '2026-11-20' };
  assert.ok(g.post(Object.assign({}, base, { status: 'closed' })).ok);
  let k = kf(); assert.strictEqual(k.status, 'selesai'); assert.ok(+k.selesaiAt > 0); assert.ok(/status open → closed/.test(k.riwayat), k.riwayat);
  const sh = ss.getSheetByName('KENDALA'), st = sh.getRange(1, 1, sh.getLastRow(), 21).getValues(), ci = st[0].indexOf('status');
  assert.strictEqual(st.find(r => r[0] === c.data.id)[ci], 'closed', 'Sheet menulis "closed"');
  assert.ok(g.post(Object.assign({}, base, { status: 'open' })).ok); k = kf(); assert.strictEqual(k.status, 'open'); assert.strictEqual(String(k.selesaiAt), '');
  assert.ok(g.post({ action: 'kendalaStatus', token: tok, id: c.data.id, op: 'selesai' }).ok); assert.strictEqual(kf().status, 'selesai');
  assert.strictEqual(g.post({ action: 'hapusKendala', id: c.data.id }).code, 'unauthorized', 'viewer tidak bisa hapus');
  const n0 = sh.getLastRow(), l0 = ss.getSheetByName('LOG').getLastRow();
  assert.ok(g.post({ action: 'hapusKendala', token: tok, id: c.data.id, reason: 'dobel' }).ok);
  assert.strictEqual(sh.getLastRow(), n0 - 1, 'baris dihapus'); assert.ok(!kf(), 'tidak tampil lagi');
  assert.ok(ss.getSheetByName('LOG').getLastRow() > l0, 'tercatat di LOG');
  assert.strictEqual(g.post({ action: 'hapusKendala', token: tok, id: c.data.id }).code, 'invalid', 'hapus dua kali ditolak');
});
t('Daftar PIC: default 4 nama, PIC baru otomatis masuk daftar, admin bisa atur ulang', () => {
  let pl = g.get({ action: 'pr' }).data.picList; assert.strictEqual(JSON.stringify(pl.slice(0, 4)), '["Fitri","Aqsha","Ahad","Anggun"]');
  assert.ok(pl.includes('Rina (Procurement)'), 'PIC dari kendala sebelumnya ikut masuk');
  const it = pr.items[1];
  assert.ok(g.post({ action: 'saveKendala', token: tok, prNo: it.prNo, itemNo: it.no, kategori: 'Lainnya', kendala: 'x', rencana: 'y', pic: '  fitri ', komitmen: '2026-11-20' }).ok);
  const kk = g.get({ action: 'pr' }).data.kendala.find(k => k.kendala === 'x'); assert.strictEqual(kk.pic, 'Fitri', 'nama dibakukan ke daftar');
  assert.strictEqual(g.post({ action: 'setPics', token: tok, pics: [] }).code, 'invalid');
  assert.strictEqual(g.post({ action: 'setPics', pics: ['A'] }).code, 'unauthorized');
  assert.ok(g.post({ action: 'setPics', token: tok, pics: ['Ahad', 'Fitri', 'fitri', ' Budi '] }).ok);
  pl = g.get({ action: 'pr' }).data.picList; assert.strictEqual(JSON.stringify(pl), '["Ahad","Fitri","Budi"]');
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
  // file PR dibuka sebagai Pelihat: zona waktu spreadsheet kosong + sel tanggal berupa Date (kasus error produksi 9 Nov)
  const prRowsDates = prRows.map(r => r.map(v => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v)) ? new Date(v + 'T00:00:00+07:00') : v));
  e3.__addSheetFile('PRSHEETID00000000000000000000000000000000002', 'TRACKING PR SAFRAN', 'Tracking PR', prRowsDates, '');
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
  // kategori & data barang dari aplikasi ditulis langsung ke tab MASTER
  const msh = ms.getSheetByName('MASTER');
  assert.strictEqual(JSON.stringify(msh.validation && msh.validation.rule.list), '["Material","Alat","APD"]', 'dropdown kategori MASTER berisi APD');
  const sep = st2.items.find(i => i.name.startsWith('Sepatu')), helmIt = st2.items.find(i => /^Helm Orange/.test(i.name));
  const k1 = h.post({ action: 'setKat', token: a, keys: [sep.key, helmIt.key], kat: 'APD' }); assert.ok(k1.ok && k1.data.master, k1.message);
  const rowOf = n => msh.data.find(r => r[0] === n);
  assert.strictEqual(rowOf('Sepatu Safety Boot Kuning uk. 41')[2], 'APD', 'baris Master diperbarui');
  assert.ok(rowOf('Helm Orange + Tali Dagu NSA'), 'barang dari PR ditambahkan ke Master'); assert.strictEqual(rowOf('Helm Orange + Tali Dagu NSA')[2], 'APD');
  const st3 = h.get({ action: 'stock' }).data; const sep3 = st3.items.find(i => i.key === sep.key);
  assert.strictEqual(sep3.kat, 'APD'); assert.strictEqual(sep3.katSrc, 'master', 'kategori kini dari Master');
  assert.ok(h.post({ action: 'saveItem', token: a, key: sep.key, kat: 'APD', awal: 7, min: 2, rak: 'R9', note: 'uk 41' }).data.master);
  assert.strictEqual(JSON.stringify(rowOf('Sepatu Safety Boot Kuning uk. 41').slice(2, 7)), '["APD",7,"R9",2,"uk 41"]');
  assert.ok(h.post({ action: 'saveItem', token: a, name: 'Wearpack Biru', unit: 'pcs', kat: 'APD', awal: 10 }).data.master);
  assert.ok(rowOf('Wearpack Biru'), 'barang baru masuk Master');
  // admin mengubah Master langsung (dropdown) → aplikasi mengikuti
  rowOf('Sepatu Safety Boot Kuning uk. 41')[2] = 'Material'; e3.__files[MID].updated = Date.now() + 5000;
  const st4 = h.get({ action: 'stock', fresh: '1' }).data; assert.strictEqual(st4.items.find(i => i.key === sep.key).kat, 'Material', 'edit langsung di Master berlaku');
  h.syncPR(); // tidak error saat tidak ada perubahan
});
t('PIN viewer: data terkunci tanpa PIN, terbuka dengan PIN/admin, ganti PIN membatalkan token lama', () => {
  const h = createEnv(), e4 = h.__env; h.setup();
  e4.__addSheetFile('PRSHEETID00000000000000000000000000000000003', 'PR', 'TRACKING PR', prRows);
  const a = h.post({ action: 'setupAdmin', setupKey: e4.__props.SETUP_KEY, email: 'a@x.co', password: 'rahasia123' }).data.token;
  assert.ok(h.post({ action: 'setSources', token: a, prUrl: 'PRSHEETID00000000000000000000000000000000003' }).ok);
  assert.ok(h.post({ action: 'getPR' }).ok, 'tanpa PIN: publik');
  assert.strictEqual(h.post({ action: 'setViewerPin', token: a, pin: '12ab' }).code, 'invalid');
  assert.ok(h.post({ action: 'setViewerPin', token: a, pin: '246810' }).ok);
  assert.strictEqual(h.get({ action: 'status' }).data.pin, true);
  assert.strictEqual(h.post({ action: 'getPR' }).code, 'pin_required');
  assert.strictEqual(h.post({ action: 'getStock' }).code, 'pin_required');
  assert.strictEqual(h.get({ action: 'pr' }).code, 'pin_required', 'GET lama juga terkunci');
  assert.strictEqual(h.post({ action: 'viewerLogin', pin: '111111' }).code, 'unauthorized');
  const v = h.post({ action: 'viewerLogin', pin: '246810' }).data.token; assert.ok(v);
  assert.ok(h.post({ action: 'getPR', token: v }).ok); assert.ok(h.post({ action: 'getStock', token: v }).ok);
  assert.ok(h.post({ action: 'getPR', token: a }).ok, 'admin tetap bisa');
  assert.strictEqual(h.post({ action: 'saveTx', token: v, lines: [] }).code, 'forbidden', 'token viewer bukan admin');
  assert.ok(h.post({ action: 'setViewerPin', token: a, pin: '135790' }).ok);
  assert.strictEqual(h.post({ action: 'getPR', token: v }).code, 'pin_required', 'token lama gugur');
  assert.ok(h.post({ action: 'setViewerPin', token: a, off: true }).ok);
  assert.ok(h.post({ action: 'getPR' }).ok, 'PIN dimatikan: publik lagi');
});
t('Edit dua arah: tab KENDALA bisa diedit dari Sheet & App (dropdown, tanggal, baris baru, riwayat)', () => {
  const MID = 'MASTERGSHEET000000000000000000000000000009';
  const h = createEnv({ boundId: MID }), e5 = h.__env;
  e5.__addSheetFile(MID, 'Master Stok', 'MASTER', MASTER.slice(1));
  e5.__addSheetFile('PRSHEETID00000000000000000000000000000000009', 'PR', 'TRACKING PR', prRows);
  h.setup();
  const a = h.post({ action: 'setupAdmin', setupKey: e5.__props.SETUP_KEY, email: 'a@x.co', password: 'rahasia123' }).data.token;
  const ss = h.post({ action: 'setSources', token: a, prUrl: 'PRSHEETID00000000000000000000000000000000009' }); assert.ok(ss.ok, ss.message); assert.ok(ss.data.sheetEdit, 'tab dirapikan & trigger terpasang');
  const sh = e5.SpreadsheetApp.openById(MID).getSheetByName('KENDALA'), C = n => ['id', 'prKey', 'prNo', 'itemNo', 'itemId', 'itemDesc', 'kategori', 'kendala', 'action', 'pic', 'komitmen', 'status'].indexOf(n) + 1;
  assert.ok(sh.validations[C('status')] && sh.validations[C('komitmen')].date && sh.validations[C('pic')].list.includes('Anggun'), 'dropdown status/PIC & validasi tanggal');
  assert.ok(sh.hidden.has(C('prKey')), 'kolom teknis disembunyikan');
  assert.ok(e5.ScriptApp.getProjectTriggers().some(t => t.getHandlerFunction() === 'saatSheetDiedit'));
  // 1) baris baru diketik langsung di Sheet (tanpa id, tanggal sebagai Date, status kosong, PIC huruf kecil)
  const row = Array(21).fill(''); row[C('prNo') - 1] = 'PR-001'; row[C('itemNo') - 1] = 1; row[C('kategori') - 1] = 'Pengiriman'; row[C('kendala') - 1] = 'Truk belum tersedia'; row[C('action') - 1] = 'Sewa truk'; row[C('pic') - 1] = 'aqsha'; row[C('komitmen') - 1] = new Date('2026-11-18T00:00:00+07:00');
  sh.data[1] = row;
  let k = h.get({ action: 'pr', fresh: '1' }).data.kendala; assert.strictEqual(k.length, 1, 'baris dari Sheet terbaca walau belum ber-id');
  assert.strictEqual(k[0].komitmen, '2026-11-18'); assert.strictEqual(k[0].status, 'open'); assert.ok(/^row2$/.test(k[0].id));
  // trigger edit memberi id, membakukan PIC, mencatat riwayat
  h.saatSheetDiedit({ range: sh.getRange(2, C('kendala')), value: 'Truk belum tersedia', oldValue: '' });
  assert.ok(String(sh.data[1][0]).startsWith('k'), 'id diberikan'); assert.strictEqual(sh.data[1][C('pic') - 1], 'Aqsha'); assert.strictEqual(sh.data[1][C('prKey') - 1], 'PR-001');
  // 2) aplikasi follow-up baris itu (pakai id baru)
  k = h.get({ action: 'pr' }).data.kendala; assert.ok(h.post({ action: 'kendalaStatus', token: a, id: k[0].id, op: 'followup', note: 'Vendor truk konfirmasi' }).ok);
  // 3) geser tanggal langsung di Sheet → geser+1 & riwayat
  sh.data[1][C('komitmen') - 1] = new Date('2026-11-20T00:00:00+07:00');
  h.saatSheetDiedit({ range: sh.getRange(2, C('komitmen')), value: '46346', oldValue: '46344' });
  // 4) tandai selesai lewat dropdown status di Sheet
  sh.data[1][C('status') - 1] = 'Selesai';
  h.saatSheetDiedit({ range: sh.getRange(2, C('status')), value: 'Selesai', oldValue: 'open' });
  k = h.get({ action: 'pr' }).data.kendala[0];
  assert.strictEqual(k.status, 'selesai'); assert.strictEqual(+k.geser, 1); assert.strictEqual(k.komitmen, '2026-11-20');
  assert.ok(/Sheet: komitmen 2026-11-18 → 2026-11-20/.test(k.riwayat), k.riwayat); assert.ok(/follow-up: Vendor truk konfirmasi/.test(k.riwayat));
  // 5) edit MASTER di Sheet langsung terbaca tanpa menunggu cache
  const m = e5.SpreadsheetApp.openById(MID).getSheetByName('MASTER'); const before = h.get({ action: 'stock' }).data.items.find(i => i.name === 'Mesin Bor').awal;
  m.data.find(r => r[0] === 'Mesin Bor')[3] = 9; h.saatSheetDiedit({ range: m.getRange(3, 4), value: '9', oldValue: '3' });
  assert.strictEqual(h.get({ action: 'stock' }).data.items.find(i => i.name === 'Mesin Bor').awal, 9, 'sebelumnya ' + before);
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
