/**
 * Stock.gs — data PR & stok untuk viewer, dan CRUD stok untuk admin.
 * Transaksi bersifat append-only: edit = batalkan (void) + catat ulang, hapus = void.
 */

function stockContext_(ss, fresh) {
  var pr = loadPR_(fresh), master = loadMaster_(fresh);
  var tx = readTable_(ss, 'TX'), items = readTable_(ss, 'ITEMS');
  var feed = prToStockFeed_(pr.items);
  return { pr: pr, master: master, tx: tx, items: items, feed: feed };
}

function actPR_(fresh) {
  var pr = loadPR_(!!fresh);
  return { prs: pr.prs, items: pr.items, source: pr.source, readAt: pr.readAt, today: todayISO_(), kendala: listKendala_() };
}

function actStock_(fresh) {
  var ss = db_(), ctx = stockContext_(ss, !!fresh);
  var M = buildStock_(ctx.master.rows, ctx.items, ctx.feed, ctx.tx);
  var list = Object.keys(M).map(function (k) { return M[k]; });
  return {
    items: list,
    tx: ctx.tx.map(stripRow_),
    loans: openLoans_(ctx.tx),
    sources: { pr: ctx.pr.source, master: ctx.master.source, db: { url: ss.getUrl(), name: ss.getName() } },
    today: todayISO_()
  };
}

function withLock_(fn) {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(20000)) fail_('busy', 'Server sedang memproses simpanan lain. Coba lagi sebentar.');
  try { var r = fn(); bumpDataVersion_(); return r; } finally { lock.releaseLock(); }
}

function newId_() { return 't' + Date.now().toString(36) + Utilities.getUuid().slice(0, 6); }

/** Catat 1..n transaksi (pakai/pinjam multi-baris, kembali, koreksi). */
function actSaveTx_(me, b) {
  var lines = Array.isArray(b.lines) ? b.lines : [];
  if (!lines.length || lines.length > 50) fail_('invalid', 'Isi 1–50 baris transaksi.');
  return withLock_(function () {
    var ss = db_(), ctx = stockContext_(ss, true);
    var M = buildStock_(ctx.master.rows, ctx.items, ctx.feed, ctx.tx);
    var now = Date.now(), add = [], keys = {};
    lines.forEach(function (l, i) {
      var c = cleanTx_(l, M);
      if (c.error) fail_('invalid', (lines.length > 1 ? 'Baris ' + (i + 1) + ': ' : '') + c.error);
      if (c.tx.type === 'kembali') {
        var loan = ctx.tx.filter(function (t) { return t.id === c.tx.loanId && t.type === 'pinjam' && !isVoid_(t); })[0];
        if (!loan) fail_('invalid', 'Catatan pinjam tidak ditemukan atau sudah dibatalkan.');
        if (loan.key !== c.tx.key) fail_('invalid', 'Barang pengembalian berbeda dengan barang yang dipinjam.');
      }
      var t = c.tx; t.id = newId_() + i; t.createdAt = now; t.createdBy = me.email; t.void = false; t.replaces = '';
      add.push(t); keys[t.key] = 1;
    });
    var err = validateLedgerChange_(ctx.master.rows, ctx.items, ctx.feed, ctx.tx, ctx.tx.concat(add), Object.keys(keys));
    if (err) fail_('invalid', err);
    appendRows_(ss, 'TX', add);
    log_(me.email, 'saveTx', add.map(function (t) { return t.type + ' ' + t.qty + ' ' + t.name; }).join('; '));
    return { saved: add.length };
  });
}

/** Edit transaksi: void baris lama + tulis baris pengganti (riwayat tetap utuh). */
function actEditTx_(me, b) {
  return withLock_(function () {
    var ss = db_(), ctx = stockContext_(ss, true);
    var old = ctx.tx.filter(function (t) { return t.id === b.id; })[0];
    if (!old) fail_('invalid', 'Transaksi tidak ditemukan.');
    if (isVoid_(old)) fail_('invalid', 'Transaksi ini sudah dibatalkan.');
    var M = buildStock_(ctx.master.rows, ctx.items, ctx.feed, ctx.tx);
    var patch = b.tx || {}; patch.type = old.type; patch.loanId = old.loanId;
    if (!patch.key) patch.key = old.key;
    if (old.type === 'pinjam' && patch.key !== old.key) fail_('invalid', 'Barang pada catatan pinjam tidak bisa diganti. Batalkan lalu catat ulang.');
    var c = cleanTx_(patch, M);
    if (c.error) fail_('invalid', c.error);
    var now = Date.now(), nt = c.tx;
    // pinjam yang diedit tetap memakai id lama agar pengembalian tetap terhubung
    var voided = stripRow_(old); voided.void = true; voided.voidReason = 'Diedit: ' + (String(b.reason || '').trim() || 'koreksi data'); voided.voidAt = now; voided.voidBy = me.email;
    if (old.type === 'pinjam') { voided.id = old.id + '~' + now.toString(36); nt.id = old.id; } else nt.id = newId_();
    nt.createdAt = now; nt.createdBy = me.email; nt.void = false; nt.replaces = voided.id;
    var after = ctx.tx.filter(function (t) { return t.id !== old.id; }).concat([voided, nt]);
    var err = validateLedgerChange_(ctx.master.rows, ctx.items, ctx.feed, ctx.tx, after, uniq_([old.key, nt.key]));
    if (err) fail_('invalid', err);
    updateRow_(ss, 'TX', old._row, voided);
    appendRows_(ss, 'TX', [nt]);
    log_(me.email, 'editTx', old.id + ' → ' + nt.id);
    return { id: nt.id };
  });
}

function actVoidTx_(me, b) {
  var reason = String(b.reason || '').trim();
  if (!reason) fail_('invalid', 'Alasan pembatalan wajib diisi.');
  return withLock_(function () {
    var ss = db_(), ctx = stockContext_(ss, true);
    var old = ctx.tx.filter(function (t) { return t.id === b.id; })[0];
    if (!old) fail_('invalid', 'Transaksi tidak ditemukan.');
    if (isVoid_(old)) fail_('invalid', 'Transaksi ini sudah dibatalkan.');
    if (old.type === 'pinjam' && ctx.tx.some(function (t) { return !isVoid_(t) && t.type === 'kembali' && t.loanId === old.id; }))
      fail_('invalid', 'Pinjaman ini sudah punya catatan kembali. Batalkan catatan kembalinya dulu.');
    var v = stripRow_(old); v.void = true; v.voidReason = reason.slice(0, 200); v.voidAt = Date.now(); v.voidBy = me.email;
    var after = ctx.tx.map(function (t) { return t.id === old.id ? v : t; });
    var err = validateLedgerChange_(ctx.master.rows, ctx.items, ctx.feed, ctx.tx, after, [old.key]);
    if (err) fail_('invalid', err);
    updateRow_(ss, 'TX', old._row, v);
    log_(me.email, 'voidTx', old.id + ' ' + reason);
    return { id: old.id };
  });
}

/** Tambah barang baru (source=app) atau ubah data barang (kategori, stok awal, rak, minimum, catatan). */
function actSaveItem_(me, b) {
  return withLock_(function () {
    var ss = db_(), ctx = stockContext_(ss, true);
    var M = buildStock_(ctx.master.rows, ctx.items, ctx.feed, ctx.tx);
    var isNew = !b.key, key, name, unit;
    if (isNew) {
      name = String(b.name || '').trim(); unit = String(b.unit || '').trim();
      if (!name || !unit) fail_('invalid', 'Nama barang dan satuan wajib diisi.');
      key = stockKey_(name, unit);
      if (M[key]) fail_('invalid', 'Barang "' + M[key].name + '" (' + M[key].unit + ') sudah ada.');
    } else {
      key = String(b.key); if (!M[key]) fail_('invalid', 'Barang tidak ditemukan.');
      name = M[key].name; unit = M[key].unit;
    }
    var kat = isKat_(b.kat) ? b.kat : '';
    var awal = pNum_(b.awal), min = pNum_(b.min);
    if (awal !== null && awal < 0) fail_('invalid', 'Stok awal tidak boleh minus.');
    if (min !== null && min < 0) fail_('invalid', 'Stok minimum tidak boleh minus.');
    var rak = String(b.rak || '').trim().slice(0, 60), note = String(b.note || '').trim().slice(0, 300);
    // utamakan tulis ke tab MASTER (sumber kebenaran); jika tidak bisa, simpan sebagai penimpa di ITEMS
    if (upsertMaster_([{ key: key, name: name, unit: unit, kat: kat, awal: awal === null ? 0 : awal, rak: rak, min: min, note: note }])) {
      clearOverrides_(ss, ctx.items, [key]);
      log_(me.email, isNew ? 'addItem' : 'editItem', name + ' [' + unit + '] → MASTER');
      return { key: key, master: true };
    }
    var exist = ctx.items.filter(function (o) { return o.key === key; })[0];
    var row = {
      key: key, name: name, unit: unit, kat: kat, awal: awal === null ? 0 : awal, rak: String(b.rak || '').trim().slice(0, 60),
      min: min === null ? '' : min, note: String(b.note || '').trim().slice(0, 300), hidden: false, full: true,
      source: exist ? exist.source : (isNew ? 'app' : 'override'), updatedAt: Date.now(), updatedBy: me.email
    };
    if (exist) updateRow_(ss, 'ITEMS', exist._row, row); else appendRows_(ss, 'ITEMS', [row]);
    log_(me.email, isNew ? 'addItem' : 'editItem', name + ' [' + unit + ']');
    return { key: key };
  });
}

/** Sembunyikan barang dari daftar (hanya jika stok 0 dan tidak sedang dipinjam). */
function actHideItem_(me, b) {
  return withLock_(function () {
    var ss = db_(), ctx = stockContext_(ss, true);
    var M = buildStock_(ctx.master.rows, ctx.items, ctx.feed, ctx.tx), it = M[b.key];
    if (!it) fail_('invalid', 'Barang tidak ditemukan.');
    var hide = b.hidden !== false;
    if (hide && (it.stok !== 0 || it.dipinjam > 0)) fail_('invalid', 'Barang masih punya stok ' + fmtQ_(it.stok) + ' atau sedang dipinjam. Koreksi stok ke 0 dulu.');
    var exist = ctx.items.filter(function (o) { return o.key === it.key; })[0];
    if (exist) { var r = stripRow_(exist); r.hidden = hide; r.updatedAt = Date.now(); r.updatedBy = me.email; updateRow_(ss, 'ITEMS', exist._row, r); }
    else appendRows_(ss, 'ITEMS', [{ key: it.key, name: it.name, unit: it.unit, hidden: hide, full: false, source: 'override', updatedAt: Date.now(), updatedBy: me.email }]);
    log_(me.email, hide ? 'hideItem' : 'showItem', it.name);
    return { key: it.key, hidden: hide };
  });
}

function uniq_(a) { var o = {}; a.forEach(function (x) { o[x] = 1; }); return Object.keys(o); }

/** Koreksi kategori cepat (1..n barang sekaligus). Hanya mengubah kolom kategori; data lain barang tetap. */
function actSetKat_(me, b) {
  var keys = Array.isArray(b.keys) ? b.keys : [];
  if (!isKat_(b.kat)) fail_('invalid', 'Kategori harus Material, Alat, atau APD.');
  if (!keys.length || keys.length > 500) fail_('invalid', 'Pilih 1–500 barang.');
  return withLock_(function () {
    var ss = db_(), ctx = stockContext_(ss, false);
    var M = buildStock_(ctx.master.rows, ctx.items, ctx.feed, ctx.tx), byKey = {}, add = [], n = 0;
    var valid = keys.filter(function (k) { return M[k]; });
    if (upsertMaster_(valid.map(function (k) { return { key: k, name: M[k].name, unit: M[k].unit, kat: b.kat }; }))) {
      // hapus kategori penimpa di ITEMS agar nilai di Master yang berlaku
      var set = {}; valid.forEach(function (k) { set[k] = 1; });
      ctx.items.forEach(function (o) { if (set[o.key] && o.kat) { var r = stripRow_(o); r.kat = ''; updateRow_(ss, 'ITEMS', o._row, r); } });
      log_(me.email, 'setKat', b.kat + ' × ' + valid.length + ' → MASTER');
      return { updated: valid.length, master: true };
    }
    ctx.items.forEach(function (o) { byKey[o.key] = o; });
    keys.forEach(function (k) {
      var it = M[k]; if (!it) return;
      var ex = byKey[k];
      if (ex) { var r = stripRow_(ex); r.kat = b.kat; r.updatedAt = Date.now(); r.updatedBy = me.email; updateRow_(ss, 'ITEMS', ex._row, r); }
      else add.push({ key: k, name: it.name, unit: it.unit, kat: b.kat, hidden: false, full: false, source: 'override', updatedAt: Date.now(), updatedBy: me.email });
      n++;
    });
    appendRows_(ss, 'ITEMS', add);
    log_(me.email, 'setKat', b.kat + ' × ' + n);
    return { updated: n };
  });
}
