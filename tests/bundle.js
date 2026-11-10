/* Gabungkan gas/*.gs menjadi satu file dist/LoGistic.gs agar mudah ditempel ke editor Apps Script.
 * Jalankan: node tests/bundle.js */
const fs = require('fs'), path = require('path');
const dir = path.join(__dirname, '..', 'gas'), out = path.join(__dirname, '..', 'dist');
fs.mkdirSync(out, { recursive: true });
const order = ['Code.gs', 'Auth.gs', 'Data.gs', 'Master.gs', 'Stock.gs', 'Kendala.gs', 'Logic.gs', 'Seed.gs'];
const body = order.map(f => `// ===== ${f} =====\n` + fs.readFileSync(path.join(dir, f), 'utf8')).join('\n');
fs.writeFileSync(path.join(out, 'LoGistic.gs'), `/* LoGistic Tracking — backend Apps Script (file gabungan, dibuat oleh tests/bundle.js).\n * Tempel seluruh isi file ini ke Code.gs di editor Apps Script. Jangan edit di sini; edit di folder gas/. */\n\n` + body);
fs.copyFileSync(path.join(dir, 'appsscript.json'), path.join(out, 'appsscript.json'));
console.log('dist/LoGistic.gs', fs.statSync(path.join(out, 'LoGistic.gs')).size, 'byte');
