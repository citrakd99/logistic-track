/**
 * SheetEdit.gs — supaya data bisa diedit DUA ARAH: dari aplikasi dan langsung dari Google Sheet.
 * - Tab KENDALA dirapikan: dropdown status/kategori/PIC, kolom tanggal komitmen berupa tanggal,
 *   kolom teknis disembunyikan.
 * - Trigger "saat Sheet diedit": baris kendala baru dari Sheet otomatis diberi ID, setiap perubahan
 *   dicatat di riwayat, dan aplikasi langsung membaca data terbaru (cache dibersihkan).
 * - Tab TX, ITEMS, LOG, PR_DATA diberi peringatan sebelum diedit (sebaiknya lewat aplikasi).
 */
var K_HIDE = ['prKey', 'itemId', 'selesaiAt', 'followupAt', 'createdAt', 'updatedAt'];
var K_STATUS = ['open', 'selesai', 'batal'];

function colOf_(name, h) { return TABS[name].indexOf(h) + 1; }

/** Rapikan tab KENDALA untuk diedit manusia (aman dijalankan berulang). */
function rapikanTabKendala_() {
  try {
    var ss = db_(), sh = ss.getSheetByName('KENDALA'); if (!sh) return false;
    var n = Math.max(1, sh.getMaxRows() - 1), V = SpreadsheetApp.newDataValidation;
    var list = function (col, vals, help) { sh.getRange(2, colOf_('KENDALA', col), n, 1).setDataValidation(V().requireValueInList(vals, true).setAllowInvalid(col === 'pic').setHelpText(help).build()); };
    list('status', K_STATUS, 'open = belum selesai · selesai · batal');
    list('kategori', KENDALA_KAT, 'Kategori kendala');
    list('pic', picList_(), 'Pilih PIC; nama lain boleh diketik (akan ditambahkan ke daftar)');
    var kc = colOf_('KENDALA', 'komitmen'), kr = sh.getRange(2, kc, n, 1);
    kr.setDataValidation(V().requireDate().setAllowInvalid(false).setHelpText('Tanggal komitmen (klik dua kali untuk kalender)').build());
    // ubah teks "2026-11-15" (format lama) menjadi tanggal sungguhan
    var lr = sh.getLastRow();
    if (lr >= 2) {
      var vals = sh.getRange(2, kc, lr - 1, 1).getValues(), changed = false;
      vals = vals.map(function (r) { var v = r[0]; if (typeof v === 'string' && isISO_(v.trim())) { changed = true; var p = v.trim().split('-'); return [new Date(+p[0], +p[1] - 1, +p[2])]; } return [v]; });
      kr.setNumberFormat('yyyy-mm-dd');
      if (changed) sh.getRange(2, kc, lr - 1, 1).setValues(vals);
    } else kr.setNumberFormat('yyyy-mm-dd');
    K_HIDE.forEach(function (h) { try { sh.hideColumns(colOf_('KENDALA', h)); } catch (e) { /* abaikan */ } });
    [['kendala', 260], ['action', 260], ['riwayat', 320], ['itemDesc', 200], ['pic', 120], ['followup', 220]].forEach(function (w) { try { sh.setColumnWidth(colOf_('KENDALA', w[0]), w[1]); } catch (e) { } });
    sh.setFrozenRows(1);
    ['TX', 'ITEMS', 'LOG', 'PR_DATA'].forEach(function (t) {
      var s2 = ss.getSheetByName(t); if (!s2) return;
      try { if (!s2.getProtections || !s2.getProtections(SpreadsheetApp.ProtectionType.SHEET).length) s2.protect().setDescription('Diisi oleh aplikasi LoGistic Tracking').setWarningOnly(true); } catch (e) { }
    });
    return true;
  } catch (e) { return false; }
}

/** Pasang trigger "saat Sheet diedit" (sekali; aman dijalankan berulang). */
function ensureEditTrigger_() {
  try {
    var id = cfg_().dbId; if (!id) return false;
    var has = ScriptApp.getProjectTriggers().some(function (t) { return t.getHandlerFunction() === 'saatSheetDiedit'; });
    if (!has) ScriptApp.newTrigger('saatSheetDiedit').forSpreadsheet(id).onEdit().create();
    return true;
  } catch (e) { return false; }
}

/** Trigger edit: dipanggil Google setiap ada sel yang diedit langsung di Sheet. */
function saatSheetDiedit(e) {
  if (!e || !e.range) return;
  var sh = e.range.getSheet(), name = sh.getName(), row = e.range.getRow();
  if (name.trim().toUpperCase() === 'MASTER') { bumpMasterRev_(); bumpDataVersion_(); return; }
  if (name === 'TX' || name === 'ITEMS') { bumpDataVersion_(); return; }
  if (name !== 'KENDALA' || row < 2) return;
  var cols = TABS.KENDALA, nr = e.range.getNumRows ? e.range.getNumRows() : 1;
  var rng = sh.getRange(row, 1, nr, cols.length), vals = rng.getValues(), now = Date.now(), changed = false;
  var editedCol = e.range.getColumn(), header = cols[editedCol - 1] || '';
  vals.forEach(function (r) {
    var o = {}; cols.forEach(function (c, i) { o[c] = r[i]; });
    if (!o.prNo && !o.kendala) return; // baris kosong
    if (!o.id) { o.id = 'k' + now.toString(36) + Utilities.getUuid().slice(0, 4); o.createdAt = now; o.createdBy = 'Sheet'; o.riwayat = stamp_() + ' · Sheet: dibuat dari Sheet'; o.geser = 0; }
    if (o.prNo) o.prKey = keyOfPR_(o.prNo);
    if (!o.status) o.status = 'open';
    o.status = String(o.status).trim().toLowerCase();
    if (o.pic) o.pic = ensurePic_(cleanPic_(o.pic));
    if (header && header !== 'riwayat' && nr === 1 && e.oldValue !== undefined && String(e.oldValue) !== String(e.value)) {
      var old = e.oldValue, nv = e.value;
      if (header === 'komitmen') { o.geser = (+o.geser || 0) + 1; old = sheetDate_(old); nv = sheetDate_(nv); }
      if (header === 'status' && o.status === 'selesai' && !o.selesaiAt) o.selesaiAt = now;
      o.riwayat = (String(o.riwayat || '') + '\n' + stamp_() + ' · Sheet: ' + header + ' ' + (old || '-') + ' → ' + (nv || '-')).trim().slice(-4000);
    }
    o.updatedAt = now; o.updatedBy = 'Sheet';
    cols.forEach(function (c, i) { if (r[i] !== o[c]) { r[i] = o[c]; changed = true; } });
  });
  if (changed) rng.setValues(vals);
  bumpDataVersion_();
}
/** Nilai tanggal dari event edit (angka serial Sheets / teks) → yyyy-mm-dd. */
function sheetDate_(v) {
  if (v === undefined || v === null || v === '') return '';
  var n = Number(v);
  if (!isNaN(n) && n > 20000 && n < 80000) return Utilities.formatDate(new Date(Math.round((n - 25569) * 864e5)), 'UTC', 'yyyy-MM-dd');
  return pDate_(v, todayISO_())[0] || String(v);
}

/** Menu / editor: rapikan tab KENDALA & pasang trigger edit. */
function aktifkanEditDariSheet() {
  var a = rapikanTabKendala_(), b = ensureEditTrigger_();
  console.log((a ? 'Tab KENDALA dirapikan (dropdown, tanggal, kolom teknis disembunyikan). ' : 'Tab KENDALA belum ada. ') + (b ? 'Trigger edit Sheet aktif.' : 'Trigger edit gagal dipasang.'));
}
