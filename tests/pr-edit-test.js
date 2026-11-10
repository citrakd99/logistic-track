/* Test integrasi RF-016 (edit/tambah Tracking PR) & RF-017 (foto surat jalan) di emulator Apps Script.
 * Jalankan: node tests/pr-edit-test.js [path-pr.xlsx]   (tanpa argumen: data contoh) */
const assert = require('assert');
const { createEnv, prRowsFromXlsx } = require('./gas-emulator');
let pass = 0, fail = 0;
function t(name, fn) { try { fn(); pass++; console.log('🟩 PASS', name); } catch (e) { fail++; console.log('🟥 FAIL', name, '\n   ', e.stack.split('\n').slice(0, 3).join('\n    ')); } }
const D = s => new Date(s + 'T00:00:00+07:00');
const SAMPLE = [
  ['', '', 'TRACKING PURCHASE REQUEST (LOG BOOK MATERIAL)'], [],
  ['No.', 'Deskripsi', 'Qty', 'Sat', 'Tanggal PR', 'No. PR', 'Tanggal Permintaan', 'QTY', 'Sat', 'Balance', 'Tanggal Release', 'Tanggal PO', 'No. PO', 'Estimasi Pengiriman', 'QTY', 'Sat', 'Tanggal Terima', 'NO. SJ', 'SUPPLIER', 'STATUS', 'REMARKS'],
  [1, 'Sepatu Safety uk 41', 65, 'Pasang', D('2026-09-25'), 'PR - 001', 'INFO LAPANGAN', 30, 'psg', '(35)', D('2026-10-14'), '26-okt ', '077,26-009', '', 30, 'Pasang', D('2026-11-03'), '1180 A', 'CITRA KARSA DUNIA', 'Close', ''],
  [], [1, 'Hand Pallet 3 Ton', 2, 'unit', D('2026-11-07'), 'PR-077', '', 1, 'Unit', '', '', D('2026-11-10'), '077.26-061', '', '', '', '', '', 'MB SEJAHTERA', 'Belum Terkirim', ''],
  ['', '- kapasitas 3 ton'], ['', 'U/ Dismantling'], ['', 'Note * Pemakaian 6 Bulan'],
  [], [1, 'Wire Mesh 4mm', 40, 'lembar', D('2026-11-07'), 'PR-078', D('2026-11-11'), 40, 'lbr', '', '', D('2026-11-10'), '077.26-60', '', '', '', '', '', 'CV. BAJA', 'Belum Terkirim', ''],
  [2, 'Kawat Galvanis 2mm', 10, 'Kg', D('2026-11-07'), 'PR-078', D('2026-11-11'), 10, 'kg', '', '', D('2026-11-10'), '077.26-067', '', '', '', '', '', 'AVIN TEKNIK', 'Belum Terkirim', ''],
  ['', 'U/pemasangan bener'],
  [], [1, 'Laptop spek Admin', 1, 'Unit', D('2026-11-10'), 'PR-079', D('2026-11-12'), '', '', '', '', '', '', '', '', '', '', '', '', 'Belum Release PR', '']
];
const prRows = process.argv[2] ? prRowsFromXlsx(process.argv[2]) : SAMPLE;
const MID = 'MASTERGSHEET0000000000000000000000000000PR', PID = 'PRSHEETEDIT0000000000000000000000000000001';
const g = createEnv({ boundId: MID }), env = g.__env;
env.__addSheetFile(MID, 'Master Stok', 'MASTER', [['Nama Barang', 'Satuan', 'Kategori', 'Stok Awal', 'Lokasi Rak', 'Stok Minimum', 'Catatan'], ['Wire Mesh 4mm', 'lembar', 'Material', 0, '', '', '']]);
env.__addSheetFile(PID, 'TRACKING PR SAFRAN', 'Tracking PR', prRows);
const prSh = () => env.SpreadsheetApp.openById(PID).getSheets()[0];
g.setup();
const tok = g.post({ action: 'setupAdmin', setupKey: env.__props.SETUP_KEY, email: 'a@x.co', password: 'rahasia123' }).data.token;
assert.ok(g.post({ action: 'setSources', token: tok, prUrl: PID }).ok);
let pr = g.get({ action: 'pr' }).data;
const find = (prNo, desc) => pr.items.find(i => i.prNo.replace(/\s/g, '') === prNo && i.desc.startsWith(desc));

t('Pengaturan menampilkan status akses tulis PR', () => { assert.strictEqual(typeof g.post({ action: 'getSettings', token: tok }).data.prCanWrite, 'boolean'); });
t('Edit item: kedatangan (qty, tgl terima, SJ, status) tertulis ke sel yang benar + PR_DATA ikut diperbarui', () => {
  const it = find('PR-078', 'Kawat Galvanis');
  const r = g.post({ action: 'editPR', token: tok, changes: [{ id: it.id, fields: { recvQty: '10', recvUnit: 'Kg', recvDate: '2026-11-12', sjNo: '1301', status: 'Close' }, orig: { recvQty: it.recvQty, recvUnit: it.recvUnit, recvDate: it.recvDate, sjNo: it.sjNo, status: it.status } }] });
  assert.ok(r.ok, r.message); assert.strictEqual(r.data.updated, 5);
  const row = prSh().data.find(x => x[1] === 'Kawat Galvanis 2mm');
  assert.strictEqual(row[14], 10); assert.strictEqual(row[17], '1301'); assert.strictEqual(row[19], 'Close');
  assert.strictEqual(Object.prototype.toString.call(row[16]), '[object Date]', 'tanggal ditulis sebagai tanggal');
  assert.strictEqual(prSh().data.find(x => x[1] === 'Wire Mesh 4mm')[19], 'Belum Terkirim', 'baris lain tidak tersentuh');
  pr = g.get({ action: 'pr' }).data; const it2 = find('PR-078', 'Kawat Galvanis');
  assert.strictEqual(it2.status, 'Close'); assert.strictEqual(it2.recvDate, '2026-11-12'); assert.strictEqual(it2.sjNo, '1301');
  const copy = env.SpreadsheetApp.openById(MID).getSheetByName('PR_DATA'); assert.ok(copy.data.some(x => x[1] === 'Kawat Galvanis 2mm' && x[17] === '1301'), 'PR_DATA tersalin ulang');
});
t('Cek bentrok: nilai di Sheet diubah orang lain → ditolak & tidak menulis', () => {
  const it = find('PR-078', 'Wire Mesh');
  prSh().data.find(x => x[1] === 'Wire Mesh 4mm')[17] = 'SJ-ORANG-LAIN';
  const r = g.post({ action: 'editPR', token: tok, changes: [{ id: it.id, fields: { sjNo: '1302' }, orig: { sjNo: it.sjNo } }] });
  assert.strictEqual(r.code, 'conflict', r.message); assert.ok(/SJ-ORANG-LAIN/.test(r.message));
  assert.strictEqual(prSh().data.find(x => x[1] === 'Wire Mesh 4mm')[17], 'SJ-ORANG-LAIN');
});
t('Validasi: kolom kunci / status / tanggal / angka salah ditolak; viewer ditolak', () => {
  const it = find('PR-079', 'Laptop');
  assert.strictEqual(g.post({ action: 'editPR', token: tok, changes: [{ id: it.id, fields: { desc: 'X' } }] }).code, 'invalid');
  assert.strictEqual(g.post({ action: 'editPR', token: tok, changes: [{ id: it.id, fields: { status: 'Selesai' } }] }).code, 'invalid');
  assert.strictEqual(g.post({ action: 'editPR', token: tok, changes: [{ id: it.id, fields: { poDate: '12/11' } }] }).code, 'invalid');
  assert.strictEqual(g.post({ action: 'editPR', token: tok, changes: [{ id: it.id, fields: { recvQty: 'abc' } }] }).code, 'invalid');
  assert.strictEqual(g.post({ action: 'editPR', changes: [{ id: it.id, fields: { poNo: 'x' } }] }).code, 'unauthorized');
});
t('Edit massal: 1 SJ untuk beberapa item satu PR', () => {
  pr = g.get({ action: 'pr', fresh: '1' }).data;
  const items = pr.items.filter(i => i.prNo === 'PR-078');
  const r = g.post({ action: 'editPR', token: tok, changes: items.map(i => ({ id: i.id, fields: { poNo: '077.26-099' }, orig: { poNo: i.poNo } })) });
  assert.ok(r.ok, r.message); assert.strictEqual(r.data.updated, items.length);
  assert.ok(prSh().data.filter(x => x[5] === 'PR-078').every(x => x[12] === '077.26-099'));
});
t('Tambah item ke PR yang ada: disisipkan setelah item terakhir & spesifikasinya, nomor lanjut', () => {
  const before = prSh().data.length;
  const r = g.post({ action: 'addPRItems', token: tok, prNo: 'PR-077', items: [{ desc: 'Troli Barang', qty: 2, unit: 'Unit', spec: 'roda karet' }] });
  assert.ok(r.ok, r.message);
  const d = prSh().data, iHP = d.findIndex(x => x[1] === 'Hand Pallet 3 Ton'), iNew = d.findIndex(x => x[1] === 'Troli Barang');
  assert.strictEqual(d[iHP + 1][1], '- kapasitas 3 ton', 'spesifikasi item lama tetap menempel'); assert.strictEqual(iNew, iHP + 2);
  assert.strictEqual(d[iNew][0], 2); assert.strictEqual(d[iNew][5], 'PR-077'); assert.strictEqual(d[iNew][19], 'Belum Release PR'); assert.strictEqual(d[iNew + 1][1], '- roda karet');
  assert.strictEqual(d.length, before + 2);
  pr = g.get({ action: 'pr' }).data;
  const p77 = pr.items.filter(i => i.prNo === 'PR-077'); assert.strictEqual(p77.length, 2); assert.strictEqual(p77[1].spec, 'roda karet');
  assert.strictEqual(pr.prs.find(p => p.prNo === 'PR-077').purpose, 'Dismantling', 'keperluan PR tetap terbaca');
  assert.strictEqual(pr.items.filter(i => i.prNo === 'PR-078').length, 2, 'PR berikutnya utuh');
});
t('Tambah PR baru: nomor otomatis, item + U/ + Note di akhir log book', () => {
  const nx = g.post({ action: 'nextPRNo', token: tok }).data.prNo;
  assert.ok(/^PR-\d{3}$/.test(nx), nx);
  assert.strictEqual(g.post({ action: 'addPR', token: tok, prNo: 'PR-078', items: [{ desc: 'x', qty: 1, unit: 'u' }] }).code, 'invalid', 'nomor ganda ditolak');
  assert.strictEqual(g.post({ action: 'addPR', token: tok, items: [{ desc: 'x', qty: 0, unit: 'u' }] }).code, 'invalid');
  const r = g.post({ action: 'addPR', token: tok, prDate: '2026-11-10', reqDate: '2026-11-15', purpose: 'Pekerjaan pagar', note: 'urgent', items: [{ desc: 'Seng Gelombang', qty: 20, unit: 'Lembar' }, { desc: 'Paku Seng', qty: 2, unit: 'Kg' }] });
  assert.ok(r.ok, r.message); assert.strictEqual(r.data.prNo, nx);
  const gp = g.get({ action: 'pr' }); assert.ok(gp.ok, gp.message); pr = gp.data; const p = pr.prs.find(x => x.prNo === nx);
  assert.ok(p); assert.strictEqual(p.purpose, 'Pekerjaan pagar'); assert.strictEqual(p.notes, 'urgent'); assert.strictEqual(p.prDate, '2026-11-10');
  const its = pr.items.filter(i => i.prNo === nx); assert.strictEqual(its.length, 2); assert.strictEqual(its[0].status, 'Belum Release PR'); assert.strictEqual(its[0].reqDate, '2026-11-15');
});
t('Sheet PR tanpa akses Editor → pesan jelas, tidak ada perubahan', () => {
  prSh().readOnly = true;
  const it = find('PR-079', 'Laptop');
  const r = g.post({ action: 'editPR', token: tok, changes: [{ id: it.id, fields: { poNo: 'X' }, orig: { poNo: it.poNo } }] });
  assert.strictEqual(r.code, 'forbidden'); assert.ok(/Editor/.test(r.message));
  prSh().readOnly = false;
});
const JPG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4, 0xff, 0xd9]).toString('base64');
let fotoId;
t('Upload foto SJ: masuk Drive LoGistic Tracking/Surat Jalan/<tanggal>, tercatat di FOTO_SJ', () => {
  assert.strictEqual(g.post({ action: 'uploadSJ', token: tok, prNo: 'PR-078', files: [] }).code, 'invalid');
  assert.strictEqual(g.post({ action: 'uploadSJ', prNo: 'PR-078', files: [{ data: JPG }] }).code, 'unauthorized');
  const r = g.post({ action: 'uploadSJ', token: tok, prNo: 'PR-078', sjNo: '1301', note: 'kawat', files: [{ data: JPG, thumb: 'dGh1bWI=', mime: 'image/jpeg' }, { data: JPG, thumb: 'dGh1bWI=' }] });
  assert.ok(r.ok, r.message); assert.strictEqual(r.data.saved, 2);
  const today = g.get({ action: 'status' }).data.today; assert.strictEqual(r.data.folder, 'LoGistic Tracking / Surat Jalan / ' + today);
  const F = Object.values(env.__folders), day = F.find(f => f.name === today), sj = F.find(f => f.name === 'Surat Jalan'), root = F.find(f => f.name === 'LoGistic Tracking');
  assert.ok(day && sj && root && day.parent === sj.id && sj.parent === root.id, 'struktur folder per hari');
  const files = Object.values(env.__files).filter(f => f.folder === day.id); assert.strictEqual(files.length, 2); assert.ok(/^SJ_PR-078_1301_\d{6}_1\.jpg$/.test(files[0].name), files[0].name);
  pr = g.get({ action: 'pr' }).data; assert.strictEqual(pr.foto.length, 2); assert.ok(!('thumb' in pr.foto[0]), 'thumbnail tidak ikut data PR (hemat)');
  fotoId = pr.foto[0].id;
  // upload kedua di hari yang sama memakai folder yang sama
  g.post({ action: 'uploadSJ', token: tok, prNo: 'PR-077', files: [{ data: JPG }] });
  assert.strictEqual(Object.values(env.__folders).filter(f => f.name === today).length, 1);
});
t('Lihat foto: thumbnail & ukuran penuh lewat script (PIN berlaku), hapus → Sampah Drive', () => {
  const th = g.post({ action: 'fotoThumbs', prNo: 'PR-078' }); assert.ok(th.ok); assert.strictEqual(th.data.length, 2); assert.strictEqual(th.data[0].thumb, 'dGh1bWI=');
  const full = g.post({ action: 'fotoFull', id: fotoId }); assert.ok(full.ok, full.message); assert.strictEqual(full.data.data, JPG);
  assert.ok(g.post({ action: 'setViewerPin', token: tok, pin: '246810' }).ok);
  assert.strictEqual(g.post({ action: 'fotoFull', id: fotoId }).code, 'pin_required');
  assert.ok(g.post({ action: 'fotoFull', token: tok, id: fotoId }).ok);
  assert.strictEqual(g.post({ action: 'hapusFoto', token: tok, id: fotoId }).code, 'invalid', 'alasan wajib');
  assert.ok(g.post({ action: 'hapusFoto', token: tok, id: fotoId, reason: 'buram' }).ok);
  assert.strictEqual(g.post({ action: 'getPR', token: tok }).data.foto.filter(f => f.prNo === 'PR-078').length, 1);
  assert.ok(Object.values(env.__files).some(f => f.trashed), 'file dipindah ke Sampah');
});
console.log(`\nHasil: ${pass} PASS, ${fail} FAIL`);
process.exit(fail ? 1 : 0);
