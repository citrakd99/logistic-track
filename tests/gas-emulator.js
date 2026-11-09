/* Emulator minimal layanan Google Apps Script untuk menguji kode gas/*.gs apa adanya di Node.
 * Bukan untuk produksi — hanya untuk test integrasi & server lokal (tests/mock-server.js). */
const fs = require('fs'), path = require('path'), vm = require('vm'), crypto = require('crypto');

function toBuf(x) { if (typeof x === 'string') return Buffer.from(x, 'utf8'); return Buffer.from(x.map(b => b & 255)); }
const toSigned = buf => [...buf].map(b => (b > 127 ? b - 256 : b));

class Sheet {
  constructor(name, rows) { this.name = name; this.data = rows ? rows.map(r => r.slice()) : []; this.maxRows = Math.max(1000, this.data.length); }
  getName() { return this.name; }
  getLastRow() { for (let i = this.data.length - 1; i >= 0; i--) if ((this.data[i] || []).some(v => v !== '' && v != null)) return i + 1; return 0; }
  getMaxRows() { return this.maxRows; }
  getMaxColumns() { return 26; }
  insertColumnsAfter() { }
  clearContents() { this.data = []; }
  insertRowsAfter(_, n) { this.maxRows += n; }
  setFrozenRows() { }
  getDataRange() { const lr = this.getLastRow(), lc = Math.max(1, ...this.data.map(r => r.length)); return this.getRange(1, 1, Math.max(1, lr), lc); }
  getRange(r, c, nr = 1, nc = 1) {
    const sh = this;
    if (r + nr - 1 > sh.maxRows) throw new Error('Range di luar batas sheet');
    return {
      getValues() { const out = []; for (let i = 0; i < nr; i++) { const row = []; for (let j = 0; j < nc; j++) { const v = (sh.data[r - 1 + i] || [])[c - 1 + j]; row.push(v === undefined || v === null ? '' : v); } out.push(row); } return out; },
      setValues(v) { if (v.length !== nr || v[0].length !== nc) throw new Error('Ukuran setValues tidak cocok'); for (let i = 0; i < nr; i++) { sh.data[r - 1 + i] = sh.data[r - 1 + i] || []; for (let j = 0; j < nc; j++) sh.data[r - 1 + i][c - 1 + j] = v[i][j]; } return this; },
      setValue(v) { sh.data[r - 1] = sh.data[r - 1] || []; sh.data[r - 1][c - 1] = v; return this; },
      setDataValidation(rule) { sh.validation = { row: r, col: c, n: nr, rule }; return this; },
      setFontWeight() { return this; }, setNumberFormat() { return this; }
    };
  }
}
class Spreadsheet {
  constructor(id, name, sheets, tz) { this.id = id; this.name = name; this.sheets = sheets || [new Sheet('Sheet1')]; this.tz = tz === undefined ? 'Asia/Jakarta' : tz; }
  getId() { return this.id; } getName() { return this.name; } getUrl() { return 'https://docs.google.com/spreadsheets/d/' + this.id + '/edit'; }
  getSpreadsheetTimeZone() { return this.tz; }
  getSheets() { return this.sheets; }
  getSheetByName(n) { return this.sheets.find(s => s.name === n) || null; }
  insertSheet(n) { const s = new Sheet(n); this.sheets.push(s); return s; }
  deleteSheet(s) { this.sheets = this.sheets.filter(x => x !== s); }
}

function createEnv(opts = {}) {
  const files = {};   // id -> {name, mime, updated, ss?, rows?}
  const props = {}, cache = new Map();
  const env = {
    MimeType: { GOOGLE_SHEETS: 'application/vnd.google-apps.spreadsheet' },
    console,
    PropertiesService: { getScriptProperties: () => ({
      getProperty: k => (k in props ? props[k] : null), setProperty: (k, v) => { props[k] = String(v); }, setProperties: o => { for (const k in o) props[k] = String(o[k]); }, deleteProperty: k => { delete props[k]; }
    }) },
    CacheService: { getScriptCache: () => ({
      get: k => { const e = cache.get(k); return e && e.x > Date.now() ? e.v : null; },
      getAll: ks => { const o = {}; ks.forEach(k => { const e = cache.get(k); if (e && e.x > Date.now()) o[k] = e.v; }); return o; },
      put: (k, v, t) => cache.set(k, { v: String(v), x: Date.now() + (t || 600) * 1000 }),
      putAll: (m, t) => { for (const k in m) cache.set(k, { v: String(m[k]), x: Date.now() + (t || 600) * 1000 }); },
      remove: k => cache.delete(k)
    }) },
    LockService: { getScriptLock: () => ({ tryLock: () => true, waitLock: () => { }, releaseLock: () => { } }) },
    Session: { getScriptTimeZone: () => 'Asia/Jakarta' },
    Utilities: {
      Charset: { UTF_8: 'utf8' },
      getUuid: () => crypto.randomUUID(),
      computeHmacSha256Signature: (v, k) => toSigned(crypto.createHmac('sha256', toBuf(k)).update(toBuf(v)).digest()),
      base64Encode: b => toBuf(b).toString('base64'),
      base64EncodeWebSafe: b => toBuf(b).toString('base64').replace(/\+/g, '-').replace(/\//g, '_'),
      base64DecodeWebSafe: s => toSigned(Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64')),
      newBlob: x => ({ getBytes: () => toSigned(toBuf(x)), getDataAsString: () => toBuf(x).toString('utf8') }),
      formatDate: (d, tz, fmt) => {
        if (typeof tz !== 'string' || !tz) throw new Error('Argumen tak valid: timeZone. Seharusnya bertipe: String');
        const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(d).map(x => [x.type, x.value]));
        return String(fmt).replace('yyyy', p.year).replace('MM', p.month).replace('dd', p.day).replace('HH', p.hour).replace('mm', p.minute);
      }
    },
    ContentService: { MimeType: { JSON: 'json' }, createTextOutput: s => ({ content: s, setMimeType() { return this; } }) },
    DriveApp: {
      getRootFolder: () => ({}),
      getFileById: id => { const f = files[id]; if (!f) throw new Error('File not found: ' + id);
        return { getName: () => f.name, getMimeType: () => f.mime, getLastUpdated: () => new Date(f.updated), getUrl: () => 'https://docs.google.com/spreadsheets/d/' + id + '/edit', getBlob: () => ({ rows: f.rows }), setTrashed: () => { delete files[id]; } }; }
    },
    Drive: { Files: {
      create: (res, blob) => { const id = 'tmp' + crypto.randomUUID().replace(/-/g, ''); files[id] = { name: res.name, mime: res.mimeType, updated: Date.now(), ss: new Spreadsheet(id, res.name, [new Sheet('MASTER', blob.rows)]) }; return { id }; },
      remove: id => { delete files[id]; }
    } },
    ScriptApp: (() => { const tr = []; return {
      getProjectTriggers: () => tr.slice(),
      deleteTrigger: t => { const i = tr.indexOf(t); if (i >= 0) tr.splice(i, 1); },
      newTrigger: fn => ({ timeBased: () => ({ everyMinutes: () => ({ create: () => { const t = { getHandlerFunction: () => fn }; tr.push(t); return t; } }) }) })
    }; })(),
    SpreadsheetApp: {
      newDataValidation: () => { const rule = {}; const b = { requireValueInList: (l) => { rule.list = l.slice(); return b; }, setAllowInvalid: (x) => { rule.allowInvalid = x; return b; }, setHelpText: () => b, build: () => rule }; return b; },
      getActiveSpreadsheet: () => (opts.boundId && files[opts.boundId] ? files[opts.boundId].ss : null),
      getUi: () => { throw new Error('no ui'); },
      openById: id => { const f = files[id]; if (!f || !f.ss) throw new Error('Spreadsheet tidak bisa dibuka: ' + id); return f.ss; },
      create: name => { const id = 'db' + crypto.randomUUID().replace(/-/g, '').slice(0, 30); const ss = new Spreadsheet(id, name); files[id] = { name, mime: env.MimeType.GOOGLE_SHEETS, updated: Date.now(), ss }; return ss; }
    }
  };
  // helper untuk test
  env.__files = files; env.__props = props; env.__cache = cache;
  env.__addSheetFile = (id, name, tab, rows, tz) => { files[id] = { name, mime: env.MimeType.GOOGLE_SHEETS, updated: Date.now(), ss: new Spreadsheet(id, name, [new Sheet(tab, rows)], tz) }; };
  env.__addXlsxFile = (id, name, rows) => { files[id] = { name, mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', updated: Date.now(), rows }; };

  const ctx = vm.createContext(Object.assign({}, env));
  const dir = path.join(__dirname, '..', 'gas');
  const code = fs.readdirSync(dir).filter(f => f.endsWith('.gs')).sort().map(f => fs.readFileSync(path.join(dir, f), 'utf8')).join('\n;\n');
  vm.runInContext(code, ctx, { filename: 'gas-bundle.js' });
  ctx.__env = env;
  ctx.get = (params) => JSON.parse(ctx.doGet({ parameter: params || {} }).content);
  ctx.post = (body) => JSON.parse(ctx.doPost({ postData: { contents: JSON.stringify(body) } }).content);
  return ctx;
}

function prRowsFromXlsx(file) {
  const XLSX = require('xlsx');
  const wb = XLSX.readFile(file, { cellDates: true });
  const name = wb.SheetNames.find(n => n.trim().toUpperCase() === 'TRACKING PR') || wb.SheetNames[0];
  return XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, raw: true, defval: '' });
}

module.exports = { createEnv, prRowsFromXlsx };
