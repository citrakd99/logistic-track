/* Server lokal untuk mencoba UI tanpa deploy: menjalankan gas/*.gs di emulator.
 * Jalankan: node tests/mock-server.js [path-pr.xlsx] [port]
 * Buka http://localhost:8787/?api=local  → login admin: admin@demo.id / demo12345 */
const http = require('http'), fs = require('fs'), path = require('path');
const { createEnv, prRowsFromXlsx } = require('./gas-emulator');
const ROOT = path.join(__dirname, '..'), PORT = +process.argv[3] || 8787;
const MID = 'DEMOMASTERGSHEET0000000000000000000000001';
const g = createEnv({ boundId: MID }), env = g.__env;
const prRows = process.argv[2] ? prRowsFromXlsx(process.argv[2]) : [['No.', 'Deskripsi', 'Qty', 'Sat', 'Tanggal', 'PR'], [1, 'Helm Orange', 20, 'pcs', '2026-11-01', 'PR-001', '', '', '', '', '', '', '', '', 12, 'pcs', '2026-11-05', 'SJ1', 'Toko A', 'Close', '']];
env.__addSheetFile('DEMOPRSHEET00000000000000000000000000000001', 'TRACKING PR (demo)', 'TRACKING PR', prRows);
env.__addSheetFile(MID, 'Master Stok (demo)', 'MASTER', [['Nama Barang', 'Satuan', 'Kategori', 'Stok Awal', 'Lokasi Rak', 'Stok Minimum', 'Catatan'],
  ['Sepatu Safety Boot Kuning uk. 41', 'Pasang', 'Material', 6, 'A1', 2, ''], ['Helm Orange + Tali Dagu NSA', 'Pcs', 'Material', 10, 'A2', 3, ''], ['Mesin Bor', 'Unit', 'Alat', 3, 'B1', 1, '']]);
g.setup();
const a = g.post({ action: 'setupAdmin', setupKey: env.__props.SETUP_KEY, name: 'Admin Demo', email: 'admin@demo.id', password: 'demo12345' });
g.post({ action: 'setSources', token: a.data.token, prUrl: 'DEMOPRSHEET00000000000000000000000000000001' });

const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.webmanifest': 'application/manifest+json' };
http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x');
  if (u.pathname === '/api') {
    const send = o => { res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }); res.end(JSON.stringify(o)); };
    if (req.method === 'GET') return send(g.get(Object.fromEntries(u.searchParams)));
    let body = ''; req.on('data', c => body += c); req.on('end', () => { try { send(g.post(JSON.parse(body || '{}'))); } catch (e) { send({ ok: false, code: 'invalid', message: 'Body bukan JSON' }); } });
    return;
  }
  let p = u.pathname === '/' ? '/index.html' : u.pathname;
  const f = path.join(ROOT, path.normalize(p));
  if (!f.startsWith(ROOT) || !fs.existsSync(f)) { res.writeHead(404); return res.end('not found'); }
  let txt = fs.readFileSync(f);
  if (p === '/assets/config.js') txt = `window.LT_CONFIG={API_URL:location.origin+'/api'};`;
  res.writeHead(200, { 'Content-Type': TYPES[path.extname(f)] || 'application/octet-stream' }); res.end(txt);
}).listen(PORT, () => console.log(`LoGistic Tracking lokal: http://localhost:${PORT}  (admin@demo.id / demo12345)`));
