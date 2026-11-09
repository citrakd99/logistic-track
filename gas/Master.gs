/**
 * Master.gs — menulis perubahan data barang langsung ke tab MASTER (jika Master berupa Google Sheet
 * yang bisa diedit, mis. script terpasang di Master). Master menjadi sumber kebenaran: kategori,
 * stok awal, rak, minimum, catatan. Jika Master tidak bisa ditulis (.xlsx / hanya lihat), aplikasi
 * memakai tab ITEMS sebagai penimpa seperti sebelumnya.
 */
var MASTER_COLS = ['Nama Barang', 'Satuan', 'Kategori', 'Stok Awal', 'Lokasi Rak', 'Stok Minimum', 'Catatan'];

function masterSheet_() {
  var c = cfg_(); if (!c.masterId) return null;
  try {
    var info = fileInfo_(c.masterId, true);
    if (info.mime !== MimeType.GOOGLE_SHEETS) return null;
    var ss = SpreadsheetApp.openById(c.masterId), sheets = ss.getSheets();
    return sheets.filter(function (s) { return s.getName().trim().toUpperCase() === 'MASTER'; })[0] || sheets[0];
  } catch (e) { return null; }
}
function masterHeaderRow_(vals) {
  for (var i = 0; i < vals.length; i++) if (/^nama barang$/i.test(String(vals[i][0] == null ? '' : vals[i][0]).trim())) return i;
  return -1;
}
/** Dropdown kategori (Material/Alat/APD) di kolom C tab MASTER. */
function ensureKatValidation_(sh) {
  try {
    sh = sh || masterSheet_(); if (!sh) return false;
    var hi = masterHeaderRow_(sh.getDataRange().getValues()); if (hi < 0) return false;
    var start = hi + 2, n = Math.max(1, sh.getMaxRows() - start + 1);
    var rule = SpreadsheetApp.newDataValidation().requireValueInList(KATS, true).setAllowInvalid(false)
      .setHelpText('Material = dipakai habis · Alat = dipinjam & dikembalikan · APD = diserahkan ke pekerja').build();
    sh.getRange(start, 3, n, 1).setDataValidation(rule);
    return true;
  } catch (e) { return false; }
}
function bumpMasterRev_() { props_().setProperty('MASTER_REV', Date.now().toString(36)); }

/**
 * Upsert baris barang ke tab MASTER. rows: [{key,name,unit,kat?,awal?,rak?,min?,note?}]; hanya field
 * yang ada (!== undefined) yang ditulis. Mengembalikan true jika berhasil ditulis ke Master.
 */
function upsertMaster_(rows) {
  var sh = masterSheet_(); if (!sh || !rows.length) return false;
  var vals = sh.getDataRange().getValues(), hi = masterHeaderRow_(vals);
  if (hi < 0) return false;
  var idx = {};
  for (var i = hi + 1; i < vals.length; i++) { var nm = pStr_(vals[i][0]); if (nm) idx[stockKey_(nm, pStr_(vals[i][1]))] = i + 1; }
  var FIELDS = [['kat', 3], ['awal', 4], ['rak', 5], ['min', 6], ['note', 7]], add = [];
  rows.forEach(function (r) {
    var rn = idx[r.key];
    if (rn) {
      FIELDS.forEach(function (f) { if (r[f[0]] !== undefined) sh.getRange(rn, f[1]).setValue(r[f[0]] === null ? '' : r[f[0]]); });
    } else {
      add.push([r.name, r.unit, r.kat || '', r.awal == null ? '' : r.awal, r.rak || '', r.min == null ? '' : r.min, r.note || '']);
      idx[r.key] = -1;
    }
  });
  if (add.length) {
    var last = Math.max(sh.getLastRow(), hi + 1), need = last + add.length - sh.getMaxRows();
    if (need > 0) sh.insertRowsAfter(sh.getMaxRows(), need + 50);
    sh.getRange(last + 1, 1, add.length, 7).setValues(add);
  }
  ensureKatValidation_(sh);
  bumpMasterRev_();
  return true;
}

/** Setelah ditulis ke Master, kosongkan penimpa di ITEMS agar Master yang berlaku (status sembunyi tetap). */
function clearOverrides_(ss, items, keys) {
  var set = {}; keys.forEach(function (k) { set[k] = 1; });
  items.forEach(function (o) {
    if (!set[o.key]) return;
    var r = stripRow_(o); r.kat = ''; r.awal = ''; r.rak = ''; r.min = ''; r.note = ''; r.full = false;
    if (r.source === 'app') r.source = 'master';
    updateRow_(ss, 'ITEMS', o._row, r);
  });
}
