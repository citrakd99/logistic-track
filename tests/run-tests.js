/* Test runner Node untuk gas/Logic.gs — jalankan: node tests/run-tests.js [path-pr.xlsx]
 * Memuat Logic.gs apa adanya (file yang sama yang di-deploy ke Apps Script). */
const fs = require('fs'), path = require('path'), assert = require('assert');
const L = require(path.join(__dirname, '..', 'gas', 'Logic.gs'));
let pass = 0, fail = 0;
function t(name, fn) { try { fn(); pass++; console.log('🟩 PASS', name); } catch (e) { fail++; console.log('🟥 FAIL', name, '\n   ', e.message); } }
const TODAY = '2026-11-09';

// ---- parser tanggal & angka ----
t('pDate: 5-Nov-26 / 05/11/2026 / ISO / teks', () => {
  assert.deepStrictEqual(L.pDate_('5-Nov-26', TODAY), ['2026-11-05', '']);
  assert.deepStrictEqual(L.pDate_('05/11/2026', TODAY), ['2026-11-05', '']);
  assert.deepStrictEqual(L.pDate_('2026-10-01', TODAY), ['2026-10-01', '']);
  assert.deepStrictEqual(L.pDate_('menunggu', TODAY), ['', 'menunggu']);
});
t('pNum: 1.000 / 2,5 / angka', () => { assert.strictEqual(L.pNum_('1.000'), 1000); assert.strictEqual(L.pNum_('2,5'), 2.5); assert.strictEqual(L.pNum_(7), 7); assert.strictEqual(L.pNum_(''), null); });

// ---- data nyata Tracking PR (opsional) ----
const prFile = process.argv[2];
let pr = null;
if (prFile && fs.existsSync(prFile)) {
  const XLSX = require('xlsx');
  const wb = XLSX.readFile(prFile, { cellDates: true });
  const name = wb.SheetNames.find(n => n.trim().toUpperCase() === 'TRACKING PR') || wb.SheetNames[0];
  const pad = n => String(n).padStart(2, '0');
  const rows = XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, raw: true, defval: '' })
    .map(r => r.map(v => v instanceof Date ? `${v.getFullYear()}-${pad(v.getMonth() + 1)}-${pad(v.getDate())}` : v));
  t('Tracking PR nyata: header "Deskripsi" ditemukan', () => assert.ok(L.findHeaderRow_(rows) >= 0));
  pr = L.parsePR_(rows.slice(L.findHeaderRow_(rows) + 1), TODAY);
  t(`Tracking PR nyata: ${pr.items.length} item, ${pr.prs.length} PR terbaca`, () => { assert.ok(pr.items.length >= 10); assert.ok(pr.prs.length >= 1); });
  t('Tracking PR nyata: semua status valid', () => {
    const ok = ['Belum Release PR', 'Belum PO', 'Belum Terkirim', 'Close', 'Cancel'];
    const bad = pr.items.filter(i => !ok.includes(i.status)); assert.strictEqual(bad.length, 0, JSON.stringify(bad.slice(0, 2)));
  });
  t('Tracking PR nyata: id item unik', () => assert.strictEqual(new Set(pr.items.map(i => i.id)).size, pr.items.length));
  t('Tracking PR nyata: tanggal ter-parse ke ISO', () => { const d = pr.items.filter(i => i.recvDate); assert.ok(d.every(i => /^\d{4}-\d{2}-\d{2}$/.test(i.recvDate))); });
  const cnt = {}; pr.items.forEach(i => cnt[i.status] = (cnt[i.status] || 0) + 1);
  console.log('   Distribusi status:', JSON.stringify(cnt));
}

// ---- master & stok ----
const masterRows = [['Nama Barang', 'Satuan', 'Kategori', 'Stok Awal', 'Lokasi Rak', 'Stok Minimum', 'Catatan'],
  ['Sepatu Safety Boot Kuning uk. 41', 'Pasang', 'Material', '', '', '', ''],
  ['Helm Orange + Tali Dagu NSA', 'Pcs', 'Material', 10, 'R1', 3, ''],
  ['Mesin Bor', 'Unit', 'Alat', 2, 'R2', '', ''],
  ['Helm Orange + Tali Dagu NSA', 'pcs', '', '', '', '', 'duplikat']];
const master = L.parseMaster_(masterRows);
t('parseMaster: header dikenali, duplikat (nama+satuan alias) dibuang', () => { assert.strictEqual(master.length, 3); assert.strictEqual(master[2].kat, 'Alat'); });

const feed = { rows: [{ id: 'x', key: L.stockKey_('Helm Orange + Tali Dagu NSA', 'pcs'), name: 'Helm Orange + Tali Dagu NSA', unit: 'pcs', qty: 5, date: '2026-11-01', prNo: 'PR-1' }],
  req: [{ key: L.stockKey_('Helm Orange + Tali Dagu NSA', 'pcs'), prNo: 'PR-1', qty: 8, unit: 'pcs', recvQty: 5, recvUnit: 'pcs', status: 'Close' }] };
const helm = L.stockKey_('Helm Orange + Tali Dagu NSA', 'Pcs'), bor = L.stockKey_('Mesin Bor', 'Unit');
const tx0 = [];
t('buildStock: awal 10 + masuk PR 5 = 15, sisa PR 3, status ok', () => {
  const M = L.buildStock_(master, [], feed, tx0); const h = M[helm];
  assert.strictEqual(h.stok, 15); assert.strictEqual(h.sisaPR, 3); assert.strictEqual(h.status, 'ok');
});
t('buildStock: override kategori (ITEMS full=false) hanya ubah kategori', () => {
  const M = L.buildStock_(master, [{ key: helm, kat: 'Alat', full: false }], feed, tx0);
  assert.strictEqual(M[helm].kat, 'Alat'); assert.strictEqual(M[helm].rak, 'R1'); assert.strictEqual(M[helm].min, 3);
});
t('buildStock: override full=true menimpa rak & min', () => {
  const M = L.buildStock_(master, [{ key: helm, kat: 'Material', awal: 0, rak: '', min: '', note: '', full: true }], feed, tx0);
  assert.strictEqual(M[helm].stok, 5); assert.strictEqual(M[helm].rak, ''); assert.strictEqual(M[helm].min, null);
});
const pakai = { id: 'a1', type: 'pakai', key: helm, name: 'Helm', unit: 'pcs', qty: 13, date: TODAY, void: false };
t('buildStock: pakai 13 → stok 2 ≤ min 3 → menipis', () => { const M = L.buildStock_(master, [], feed, [pakai]); assert.strictEqual(M[helm].stok, 2); assert.strictEqual(M[helm].status, 'low'); });
t('validasi: pakai melebihi stok ditolak', () => {
  const big = Object.assign({}, pakai, { id: 'a2', qty: 16 });
  assert.ok(/tidak cukup/.test(L.validateLedgerChange_(master, [], feed, [], [big], [helm])));
});
t('validasi: pakai pas sama dengan stok diterima', () => {
  const ok = Object.assign({}, pakai, { id: 'a3', qty: 15 }); assert.strictEqual(L.validateLedgerChange_(master, [], feed, [], [ok], [helm]), null);
});
const loan = { id: 'L1', type: 'pinjam', key: bor, name: 'Mesin Bor', unit: 'Unit', qty: 2, date: '2026-11-01', person: 'Budi', void: false };
t('pinjam 2 bor → stok 0, dipinjam 2, open loan 1', () => {
  const M = L.buildStock_(master, [], feed, [loan]); assert.strictEqual(M[bor].stok, 0); assert.strictEqual(M[bor].dipinjam, 2); assert.strictEqual(L.openLoans_([loan]).length, 1);
});
t('kembali 1 → sisa pinjam 1; kembali melebihi ditolak', () => {
  const r1 = { id: 'R1', type: 'kembali', loanId: 'L1', key: bor, qty: 1, date: TODAY, void: false };
  assert.strictEqual(L.openLoans_([loan, r1])[0].sisa, 1);
  const r2 = Object.assign({}, r1, { id: 'R2', qty: 2 });
  assert.ok(L.validateLedgerChange_(master, [], feed, [loan, r1], [loan, r1, r2], [bor]));
});
t('void pinjam membuat kembali yatim → ditolak', () => {
  const r1 = { id: 'R1', type: 'kembali', loanId: 'L1', key: bor, qty: 1, date: TODAY, void: false };
  const lv = Object.assign({}, loan, { void: true });
  assert.ok(L.validateLedgerChange_(master, [], feed, [loan, r1], [lv, r1], [bor]));
});
t('void koreksi yang membuat stok minus ditolak', () => {
  const k = { id: 'K1', type: 'koreksi', key: bor, qty: 3, date: TODAY, reason: 'opname', void: false };
  const p = { id: 'P1', type: 'pakai', key: bor, qty: 5, date: TODAY, person: 'A', void: false };
  assert.ok(L.validateLedgerChange_(master, [], feed, [k, p], [Object.assign({}, k, { void: true }), p], [bor]));
});
t('cleanTx: wajib penerima, tanggal, alasan koreksi, qty>0', () => {
  const M = L.buildStock_(master, [], feed, []);
  assert.ok(L.cleanTx_({ type: 'pakai', key: helm, qty: 1, date: TODAY }, M).error);
  assert.ok(L.cleanTx_({ type: 'pakai', key: helm, qty: 0, date: TODAY, person: 'A' }, M).error);
  assert.ok(L.cleanTx_({ type: 'koreksi', key: helm, qty: -1, date: TODAY }, M).error);
  assert.ok(L.cleanTx_({ type: 'hapus', key: helm, qty: 1, date: TODAY }, M).error);
  assert.ok(!L.cleanTx_({ type: 'pakai', key: helm, qty: '1,5', date: TODAY, person: 'A' }, M).error);
});
t('Seed: 27 key kategori lama cocok dengan stockKey(nama, satuan)', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'gas', 'Seed.gs'), 'utf8');
  const names = eval('(' + /LEGACY_NAMES = (\{[\s\S]*?\});/.exec(src)[1] + ')');
  const bad = Object.keys(names).filter(k => L.stockKey_(names[k], k.split('|')[1]) !== k);
  assert.strictEqual(Object.keys(names).length, 27); assert.deepStrictEqual(bad, []);
});
if (pr) t('Integrasi: stok dari PR nyata terhitung tanpa error', () => {
  const f = L.prToStockFeed_(pr.items); const M = L.buildStock_([], [], f, []);
  console.log(`    ${f.rows.length} baris barang masuk → ${Object.keys(M).length} jenis barang`);
  assert.ok(Object.values(M).every(i => isFinite(i.stok)));
});
t('Kategori APD: tebakan nama & teks Master', () => {
  ['Sepatu Safety Boot Kuning uk. 41', 'Helm Orange + Tali Dagu NSA', 'Sarung Tangan Las', 'Rompi Jaring Hijau', 'Ear Plug', 'Full Body Harnes Double Hock', 'Kacamata Be Safe Clear', 'Masker Medis 3 Ply']
    .forEach(n => assert.strictEqual(L.guessKat_(n), 'APD', n));
  assert.strictEqual(L.guessKat_('M/C Bor Beton'), 'Alat'); assert.strictEqual(L.guessKat_('Kabel NYM 3x2,5'), 'Material');
  assert.strictEqual(L.katFrom_('APD'), 'APD'); assert.strictEqual(L.katFrom_('alat kerja'), 'Alat'); assert.strictEqual(L.katFrom_('Material'), 'Material'); assert.strictEqual(L.katFrom_(''), '');
});
t('Serah APD mengurangi stok permanen & wajib nama penerima', () => {
  const s1 = { id: 'S1', type: 'serah', key: helm, qty: 4, date: TODAY, person: 'Joko', void: false };
  const M = L.buildStock_(master, [], feed, [s1]); assert.strictEqual(M[helm].stok, 11); assert.strictEqual(M[helm].serahQty, 4); assert.strictEqual(M[helm].dipinjam, 0);
  assert.ok(/penerima APD/.test(L.cleanTx_({ type: 'serah', key: helm, qty: 1, date: TODAY }, M).error));
  assert.ok(L.validateLedgerChange_(master, [], feed, [], [Object.assign({}, s1, { qty: 99 })], [helm]));
});
t('Override kategori APD diterima', () => { const M = L.buildStock_(master, [{ key: bor, kat: 'APD', full: false }], feed, []); assert.strictEqual(M[bor].kat, 'APD'); });
console.log(`\nHasil: ${pass} PASS, ${fail} FAIL`);
process.exit(fail ? 1 : 0);
