/* LoGistic Tracking — frontend (tanpa build step).
 * Viewer: lihat Tracking PR & Stok tanpa login. Admin: login → CRUD stok + Pengaturan.
 * Semua perhitungan stok & validasi dilakukan di server (gas/Logic.gs); frontend hanya menampilkan. */
(function () {
  'use strict';

  // ---------- util ----------
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];
  const isISO = s => /^\d{4}-\d{2}-\d{2}$/.test(s || '');
  const isEmpty = v => v === null || v === undefined || v === '';
  const fmtN = n => isEmpty(n) ? '' : (typeof n === 'number' ? (+n.toFixed(3)).toLocaleString('id-ID') : String(n));
  const fmtDT = v => { if (!v) return '–'; const d = new Date(v); return isNaN(d) ? '–' : d.toLocaleString('id-ID', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }); };
  const today = () => state.today || new Date().toISOString().slice(0, 10);
  function fmtD(iso, withYear) { if (!isISO(iso)) return iso || ''; const [y, m, d] = iso.split('-').map(Number); return `${d} ${MON[m - 1]}${withYear || String(y) !== today().slice(0, 4) ? ' ' + y : ''}`; }
  const daysSince = iso => isISO(iso) ? Math.floor((Date.parse(today()) - Date.parse(iso)) / 864e5) : null;
  const unitKey = u => { const A = { psg: 'pasang', pc: 'pcs', buah: 'pcs', bh: 'pcs', lsn: 'lusin', btg: 'batang', m: 'meter', mtr: 'meter', unt: 'unit', rol: 'roll', lot: 'ls', lbr: 'lembar', orang: 'org', pak: 'pack' }; const k = String(u || '').toLowerCase().replace(/[^a-z0-9]/g, ''); return A[k] || k; };
  const val = id => { const el = document.getElementById(id); return el ? el.value.trim() : ''; };
  function store(k, v) { try { v === null ? localStorage.removeItem(k) : localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* storage tidak tersedia */ } }
  function load(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch (e) { return d; } }
  let toastT;
  function toast(msg, err) { const r = $('#toastRoot'); r.innerHTML = `<div class="toast ${err ? 'err' : ''}">${esc(msg)}</div>`; clearTimeout(toastT); toastT = setTimeout(() => { r.innerHTML = ''; }, err ? 6000 : 3000); }

  const STATUSES = [
    { k: 'Belum Release PR', cls: 'st-rel', who: 'Cost Control' },
    { k: 'Belum PO', cls: 'st-po', who: 'Procurement' },
    { k: 'Belum Terkirim', cls: 'st-otw', who: 'Supplier / kedatangan' },
    { k: 'Close', cls: 'st-close', who: 'Diterima di site' },
    { k: 'Cancel', cls: 'st-cancel', who: 'Dibatalkan' }
  ];
  const SCLS = Object.fromEntries(STATUSES.map(s => [s.k, s.cls]));
  const AGING_DAYS = 14, LOAN_LATE_DAYS = 7;
  const TYPES = { in: ['Masuk', 'p-in'], pakai: ['Keluar', 'p-pakai'], serah: ['Serah APD', 'p-serah'], pinjam: ['Pinjam', 'p-pinjam'], kembali: ['Kembali', 'p-kembali'], koreksi: ['Koreksi', 'p-koreksi'] };
  const ST_LABEL = { ok: ['Ada', 'p-ok'], low: ['Menipis', 'p-low'], out: ['Habis', 'p-out'] };

  // ---------- state ----------
  const state = {
    route: 'pr', sub: 'stok', today: '', status: null, auth: load('lt_auth', null), vtok: load('lt_vtok', null),
    pr: null, prErr: null, stock: null, stockErr: null, loading: {},
    prf: Object.assign({ q: '', st: '', supplier: '', flag: '', hideDone: true, sort: 'desc' }, load('lt_prf', {})), open: new Set(),
    sf: Object.assign({ q: '', kat: '', filter: '', sort: 'nama', onlySisa: false, showHidden: false, htype: '', hfrom: '', hto: '', hq: '' }, load('lt_sf', {}))
  };
  if (state.auth && state.auth.exp < Date.now()) { state.auth = null; store('lt_auth', null); }
  const isAdmin = () => !!state.auth;
  const API = () => (window.LT_CONFIG && window.LT_CONFIG.API_URL) || load('lt_api', '');

  // ---------- API ----------
  const viewToken = () => (state.auth && state.auth.token) || (state.vtok && state.vtok.exp > Date.now() ? state.vtok.token : '');
  async function apiGet(action, fresh) {
    if (action === 'status') {
      let j;
      try { const r = await fetch(API() + '?action=status&_=' + Date.now(), { redirect: 'follow' }); j = await r.json(); }
      catch (e) { throw { code: 'network', message: 'Tidak bisa menghubungi server. Periksa koneksi internet.' }; }
      if (!j.ok) throw j;
      return j.data;
    }
    // data PR/stok lewat POST: token (PIN viewer / admin) ada di body, bukan di URL
    if (!navigator.onLine) return offlineData(action);
    let j;
    try {
      const r = await fetch(API(), { method: 'POST', redirect: 'follow', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify({ action: action === 'pr' ? 'getPR' : 'getStock', token: viewToken(), fresh: !!fresh }) });
      j = await r.json();
    } catch (e) { return offlineData(action); }
    if (!j.ok) {
      if (j.code === 'pin_required') { state.vtok = null; store('lt_vtok', null); store('lt_last_pr', null); store('lt_last_stock', null); }
      throw j;
    }
    j.data.offlineAt = null;
    try { localStorage.setItem('lt_last_' + action, JSON.stringify({ at: Date.now(), data: j.data })); } catch (e) { /* penyimpanan penuh: abaikan */ }
    return j.data;
  }
  /** Data terakhir yang tersimpan di perangkat, dipakai saat offline. */
  function offlineData(action) {
    const c = load('lt_last_' + action, null);
    if (!c) throw { code: 'network', message: 'Sedang offline dan belum ada data tersimpan di perangkat ini. Buka sekali saat online.' };
    c.data.offlineAt = c.at; return c.data;
  }
  async function apiPost(action, body) {
    if (!navigator.onLine) throw { code: 'network', message: 'Sedang offline. Simpan perubahan saat koneksi tersedia.' };
    let j;
    try {
      const r = await fetch(API(), { method: 'POST', redirect: 'follow', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify(Object.assign({ action, token: state.auth && state.auth.token }, body || {})) });
      j = await r.json();
    } catch (e) { throw { code: 'network', message: 'Tidak bisa menghubungi server. Coba lagi.' }; }
    if (!j.ok) {
      if (j.code === 'unauthorized' || j.code === 'forbidden') { if (!['login', 'setupAdmin', 'changePassword', 'viewerLogin'].includes(action)) logout(true); }
      throw j;
    }
    return j.data;
  }

  // ---------- data ----------
  async function loadPR(fresh) {
    state.loading.pr = true; renderSrc();
    try { state.pr = await apiGet('pr', fresh); state.prErr = null; state.today = state.pr.today || state.today; }
    catch (e) { state.prErr = e; }
    state.loading.pr = false; render();
  }
  async function loadStock(fresh) {
    state.loading.stock = true; renderSrc();
    try { state.stock = await apiGet('stock', fresh); state.stockErr = null; state.today = state.stock.today || state.today; indexStock(); }
    catch (e) { state.stockErr = e; }
    state.loading.stock = false; render();
  }
  function indexStock() {
    const s = state.stock; s.map = new Map(s.items.map(i => [i.key, i]));
    s.txById = new Map(s.tx.map(t => [t.id, t]));
  }
  function reloadCurrent(fresh) { if (state.route === 'pr') loadPR(fresh); else if (state.route === 'stok') loadStock(fresh); }
  async function afterWrite(msg) { toast(msg); closeDrawer(); await loadStock(true); }

  // ---------- routing ----------
  function route() {
    const h = (location.hash || '#pr').slice(1).split('/');
    state.route = ['pr', 'stok', 'pengaturan'].includes(h[0]) ? h[0] : 'pr';
    if (state.route === 'stok') state.sub = ['stok', 'riwayat', 'dipinjam'].includes(h[1]) ? h[1] : 'stok';
    if (state.route === 'pengaturan' && !isAdmin()) { location.hash = '#pr'; return; }
    $$('#nav a[data-nav]').forEach(a => a.classList.toggle('on', a.dataset.nav === state.route));
    $$('#nav a[data-sub]').forEach(a => a.classList.toggle('on', state.route === 'stok' && a.dataset.sub === state.sub));
    if (API() && state.route === 'pr' && !state.pr && !state.loading.pr) loadPR();
    if (API() && state.route === 'stok' && !state.stock && !state.loading.stock) loadStock();
    render();
  }
  window.addEventListener('hashchange', route);

  // ---------- header ----------
  function renderWho() {
    $('#navSet').hidden = !isAdmin();
    if (!API()) { $('#who').innerHTML = '<span class="dim">Mode sementara</span>'; return; }
    $('#who').innerHTML = isAdmin()
      ? `<span class="badge">Admin</span><span>${esc(state.auth.name || state.auth.email)}</span><button class="btn sm ghost" id="btnLogout">Keluar</button>`
      : `<span class="dim">Mode lihat</span><button class="btn sm" id="btnLogin">Login admin</button>`;
    const lo = $('#btnLogout'); if (lo) lo.onclick = () => logout();
    const li = $('#btnLogin'); if (li) li.onclick = openLogin;
  }
  function renderSrc() {
    const el = $('#srcbar'); const busy = state.loading.pr || state.loading.stock;
    if (state.route === 'pengaturan' || !API()) { el.className = 'srcbar'; el.innerHTML = ''; return; }
    let cls = busy ? 'busy' : '', parts = [];
    const src = state.route === 'stok' ? state.stock && state.stock.sources : state.pr && { pr: state.pr.source };
    const err = state.route === 'stok' ? state.stockErr : state.route === 'pr' ? state.prErr : null;
    if (err) cls = 'err';
    if (src && src.pr) parts.push(`<span><span class="sdot"></span><b>Tracking PR</b>: diubah ${esc(fmtDT(src.pr.updated))}</span>`);
    if (src && src.master) parts.push(`<span><b>Master Stok</b>: diubah ${esc(fmtDT(src.master.updated))}</span>`);
    const cur = state.route === 'stok' ? state.stock : state.pr;
    if (cur && cur.offlineAt) parts.unshift(`<span class="offline">Offline · menampilkan data tersimpan ${esc(fmtDT(cur.offlineAt))}</span>`);
    if (busy) parts.push('<span>Memuat data…</span>');
    if (state.route !== 'pengaturan') parts.push(`<button class="btn sm ghost" id="btnReload" ${busy ? 'disabled' : ''}>↻ Muat ulang</button>`);
    el.className = 'srcbar ' + cls; el.innerHTML = parts.join('');
    const b = $('#btnReload'); if (b) b.onclick = () => reloadCurrent(true);
  }

  function render() {
    renderWho(); renderSrc();
    const v = $('#view');
    if (!API()) { renderNoApi(v); return; }
    if (state.route === 'pr') renderPR(v);
    else if (state.route === 'stok') renderStock(v);
    else renderSettings(v);
  }
  function errView(e, retry) {
    if (e && e.code === 'pin_required') return pinView();
    const nc = e && e.code === 'not_configured';
    return `<div class="empty"><h3>${nc ? 'Sumber data belum diatur' : 'Data belum bisa dimuat'}</h3>${esc(e && e.message || 'Kesalahan tidak diketahui')}
      ${nc && isAdmin() ? '<p><a class="btn primary" href="#pengaturan">Buka Pengaturan</a></p>' : nc ? '<p class="hint">Hubungi admin untuk mengatur link Google Sheet.</p>' : `<p><button class="btn" id="${retry}">Coba lagi</button></p>`}</div>`;
  }
  function pinView() {
    setTimeout(bindPin, 0);
    return `<div class="card" style="max-width:420px;margin:24px auto;text-align:center">
      <span class="eyebrow">Akses terbatas</span><h2>Masukkan PIN</h2>
      <p class="hint">Data ini hanya untuk tim yang punya PIN. Minta PIN ke admin logistik.</p>
      <input class="inp mono" id="pinIn" type="password" inputmode="numeric" autocomplete="one-time-code" maxlength="12" placeholder="••••••" style="text-align:center;font-size:22px;letter-spacing:.3em" aria-label="PIN">
      <div id="pinErr"></div><button class="btn primary" id="pinGo">Buka</button>
      <span class="hint">PIN diingat di perangkat ini selama 30 hari.</span></div>`;
  }
  function bindPin() {
    const go = $('#pinGo'), inp = $('#pinIn'); if (!go || go.dataset.b) return; go.dataset.b = 1; inp.focus();
    const run = async () => {
      go.disabled = true;
      try {
        const r = await apiPost('viewerLogin', { pin: inp.value });
        state.vtok = r.token ? { token: r.token, exp: r.exp } : null; store('lt_vtok', state.vtok);
        state.prErr = state.stockErr = null; state.pr = state.stock = null; route();
      } catch (e) { showErr('pinErr', e.message); go.disabled = false; inp.select(); }
    };
    go.onclick = run; inp.onkeydown = e => { if (e.key === 'Enter') run(); };
  }
  function renderNoApi(v) {
    const L = (window.LT_CONFIG && window.LT_CONFIG.LEGACY) || {};
    const which = state.route === 'stok' ? 'stok' : 'pr', label = which === 'stok' ? 'Stok Gudang' : 'Tracking PR';
    const ok = /^https:\/\/claude\.ai\//.test(L[which] || '');
    v.innerHTML = `<div class="card" style="max-width:620px">
      <span class="eyebrow">Mode sementara</span><h2>${esc(label)}</h2>
      <p class="hint">Server aplikasi belum tersambung. Selama masa transisi, data ${esc(label)} dibuka di aplikasi versi sebelumnya (claude.ai) yang sudah berjalan dan membaca Google Sheet yang sama.</p>
      ${ok ? `<div><a class="btn primary" href="${esc(L[which])}" target="_blank" rel="noopener">Buka ${esc(label)} ↗</a></div>` : '<div class="err-box">Link aplikasi sementara belum diatur di assets/config.js.</div>'}
      <details><summary class="hint" style="cursor:pointer">Admin: hubungkan server (Apps Script)</summary>
        <p class="hint">Isi <span class="mono">API_URL</span> di <span class="mono">assets/config.js</span> agar berlaku untuk semua orang, atau tempel di sini untuk mencoba di browser ini saja.</p>
        <div class="f"><label for="apiUrl">URL Web App</label><input class="inp" id="apiUrl" placeholder="https://script.google.com/macros/s/…/exec"></div>
        <div style="margin-top:8px"><button class="btn" id="apiSave">Simpan & muat</button></div></details></div>`;
    $('#apiSave').onclick = () => { const u = val('apiUrl'); if (!/^https:\/\/script\.google(usercontent)?\.com\/.+/.test(u)) { toast('URL harus dari script.google.com', true); return; } store('lt_api', u); boot(); };
  }

  // =====================================================================
  // TRACKING PR (lihat saja)
  // =====================================================================
  function cmpQty(have, hu, base, bu) {
    if (typeof have !== 'number' || typeof base !== 'number') return null;
    if (unitKey(hu) && unitKey(bu) && unitKey(hu) !== unitKey(bu)) return { diff: null, unit: hu };
    return { diff: +(have - base).toFixed(3), unit: hu || bu };
  }
  function recvBal(it) {
    if (typeof it.recvQty !== 'number') return null;
    const a = cmpQty(it.recvQty, it.recvUnit, it.qty, it.unit); if (a && a.diff !== null) return Object.assign(a, { base: 'Qty PR' });
    const b = cmpQty(it.recvQty, it.recvUnit, it.ccQty, it.ccUnit); if (b && b.diff !== null) return Object.assign(b, { base: 'Qty release' });
    return { diff: null, base: 'satuan beda' };
  }
  function balBadge(b, short) {
    if (!b) return '';
    if (b.diff === null) return '<span class="bal na">Cek satuan</span>';
    if (b.diff < 0) return `<span class="bal neg">Kurang ${esc(fmtN(-b.diff))}${short ? '' : ' ' + esc(b.unit || '')}</span>`;
    if (b.diff > 0) return `<span class="bal pos">Lebih ${esc(fmtN(b.diff))}${short ? '' : ' ' + esc(b.unit || '')}</span>`;
    return '<span class="bal ok">Lengkap</span>';
  }
  const FLAG_TXT = { needed: 'Lewat tgl dibutuhkan', late: 'Lewat estimasi kirim', aging: `PR > ${AGING_DAYS} hari`, short: 'Diterima kurang' };
  function flagsOf(it, prMap) {
    const f = [], rb = recvBal(it);
    if (rb && rb.diff !== null && rb.diff < 0 && it.status !== 'Cancel') f.push('short');
    if (it.status === 'Close' || it.status === 'Cancel') return f;
    if (isISO(it.eta) && it.eta < today()) f.push('late');
    const age = daysSince(prMap.get(it.pr)?.prDate); if (age !== null && age > AGING_DAYS) f.push('aging');
    if (isISO(it.reqDate) && it.reqDate < today()) f.push('needed');
    return f;
  }
  function prMatches(it, prMap, ignoreStatus) {
    const f = state.prf;
    if (!ignoreStatus && f.st && it.status !== f.st) return false;
    if (f.hideDone && !f.st && (it.status === 'Close' || it.status === 'Cancel')) return false;
    if (f.supplier && it.supplier !== f.supplier) return false;
    if (f.flag && !flagsOf(it, prMap).includes(f.flag)) return false;
    if (f.q) {
      const p = prMap.get(it.pr) || {};
      const hay = [it.desc, it.spec, it.prNo, it.poNo, it.supplier, it.remarks, it.sjNo, p.purpose, p.notes].join(' ').toLowerCase();
      if (!f.q.toLowerCase().split(/\s+/).filter(Boolean).every(w => hay.includes(w))) return false;
    }
    return true;
  }
  function savePrf() { store('lt_prf', { hideDone: state.prf.hideDone, sort: state.prf.sort }); }

  function renderPR(v) {
    if (!state.pr) { v.innerHTML = state.prErr ? errView(state.prErr, 'retryPR') : '<div class="loading">Memuat Tracking PR…</div>'; const r = $('#retryPR'); if (r) r.onclick = () => loadPR(true); return; }
    const { prs, items } = state.pr, f = state.prf;
    const prMap = new Map(prs.map(p => [p.key, p]));
    const cnt = Object.fromEntries(STATUSES.map(s => [s.k, 0])); items.forEach(i => { if (cnt[i.status] !== undefined) cnt[i.status]++; });
    const fc = { needed: 0, late: 0, aging: 0, short: 0 }; items.forEach(i => flagsOf(i, prMap).forEach(x => fc[x]++));
    const open = items.filter(i => i.status !== 'Close' && i.status !== 'Cancel').length;
    const sups = [...new Set(items.map(i => i.supplier).filter(Boolean))].sort((a, b) => a.localeCompare(b));
    const active = !!(f.q || f.st || f.supplier || f.flag);

    const byPR = new Map(); items.forEach(i => { if (!byPR.has(i.pr)) byPR.set(i.pr, []); byPR.get(i.pr).push(i); });
    const order = prs.slice().sort((a, b) => f.sort === 'asc' ? a.seq - b.seq : b.seq - a.seq);
    let shownItems = 0, shownPR = 0; const out = [];
    for (const p of order) {
      const all = byPR.get(p.key) || [], vis = all.filter(i => prMatches(i, prMap));
      const prHit = f.q && [p.prNo, p.purpose, p.notes].join(' ').toLowerCase().includes(f.q.toLowerCase());
      if (active) { if (!vis.length && !(prHit && !f.st && !f.supplier && !f.flag)) continue; }
      else if (f.hideDone && all.length && !vis.length) continue;
      shownPR++; shownItems += vis.length;
      const isOpen = state.open.has(p.key) || state.printAll || (active && vis.length > 0);
      const c = {}; all.forEach(i => c[i.status] = (c[i.status] || 0) + 1);
      const bar = STATUSES.map(s => c[s.k] ? `<span class="${s.cls}" style="width:${c[s.k] / all.length * 100}%" title="${esc(s.k)}: ${c[s.k]}"></span>` : '').join('');
      const openCnt = all.filter(i => i.status !== 'Close' && i.status !== 'Cancel').length, age = daysSince(p.prDate);
      out.push(`<section class="pr ${isOpen ? 'open' : ''}">
        <div class="prh" data-toggle="${esc(p.key)}" role="button" tabindex="0" aria-expanded="${isOpen}">
          <span class="prno">${esc(p.prNo)}</span>
          <div class="prmid"><span class="t">${esc(p.purpose || (all[0] && all[0].desc) || '—')}</span>
            <span class="m"><span>${esc(fmtD(p.prDate))}${age !== null && openCnt ? ' · ' + age + ' hari' : ''}</span><span>${all.length} item${active && vis.length !== all.length ? ` (${vis.length} cocok)` : ''}</span><span>${openCnt ? openCnt + ' terbuka' : 'Selesai'}</span></span></div>
          <div style="display:flex;gap:8px;align-items:center"><span class="bar">${bar}</span><svg class="chev" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="m9 6 6 6-6 6"/></svg></div>
        </div>
        ${isOpen ? `${p.purpose || p.notes ? `<div class="prinfo"><div>${p.purpose ? '<b>Untuk:</b> ' + esc(p.purpose) : ''}${p.notes ? (p.purpose ? '\n' : '') + '<b>Note:</b> ' + esc(p.notes) : ''}</div></div>` : ''}
        <div class="rows"><div class="row head"><div>No</div><div>Deskripsi</div><div>Qty</div><div>Release</div><div>PO</div><div>Supplier</div><div>Terima</div><div>Status</div></div>
        ${vis.map(i => prRow(i, prMap)).join('') || '<div class="row" style="cursor:default"><div></div><div class="dim">Tidak ada item yang cocok dengan filter.</div></div>'}</div>` : ''}
      </section>`);
    }
    v.innerHTML = `
      <div class="pipe">${STATUSES.map(s => `<button class="stage ${s.cls} ${f.st === s.k ? 'on' : ''}" data-st="${esc(s.k)}" aria-pressed="${f.st === s.k}"><span class="lbl">${esc(s.k)}</span><span class="n">${cnt[s.k]}</span><span class="w">${esc(s.who)}</span></button>`).join('')}</div>
      <div class="chips"><span class="chip static"><b>${items.length}</b> item · <b>${prs.length}</b> PR · <b>${open}</b> terbuka</span>
        ${['needed', 'late', 'aging', 'short'].map(x => `<button class="chip ${fc[x] ? 'warn' : ''} ${f.flag === x ? 'on' : ''}" data-flag="${x}"><b>${fc[x]}</b> ${esc(FLAG_TXT[x])}</button>`).join('')}
        ${active ? '<button class="chip" data-clear="1">Hapus filter ✕</button>' : ''}</div>
      <div class="tools">
        <input class="inp grow" id="prq" type="search" placeholder="Cari barang, no. PR, PO, supplier…" value="${esc(f.q)}" aria-label="Cari">
        <select class="inp" id="prsup" style="width:auto;max-width:220px" aria-label="Supplier"><option value="">Semua supplier</option>${sups.map(s => `<option ${s === f.supplier ? 'selected' : ''}>${esc(s)}</option>`).join('')}</select>
        <select class="inp" id="prsort" style="width:auto" aria-label="Urutan"><option value="desc" ${f.sort === 'desc' ? 'selected' : ''}>PR terbaru</option><option value="asc" ${f.sort === 'asc' ? 'selected' : ''}>PR terlama</option></select>
        <label class="check"><input type="checkbox" id="prdone" ${f.hideDone ? 'checked' : ''}>Sembunyikan Close & Cancel</label>
        <button class="btn sm" id="prxlsx">Excel</button><button class="btn sm" id="prprint">Cetak / PDF</button>
      </div>
      <div class="resultline">${active || f.hideDone ? `Menampilkan ${shownItems} item di ${shownPR} PR` : ''}</div>
      <div style="display:flex;flex-direction:column;gap:8px">${out.join('') || '<div class="empty"><h3>Tidak ada yang cocok</h3>Coba kata kunci lain atau hapus filter.</div>'}</div>`;

    $$('.stage', v).forEach(b => b.onclick = () => { f.st = f.st === b.dataset.st ? '' : b.dataset.st; render(); });
    $$('[data-flag]', v).forEach(b => b.onclick = () => { f.flag = f.flag === b.dataset.flag ? '' : b.dataset.flag; render(); });
    const cl = $('[data-clear]', v); if (cl) cl.onclick = () => { Object.assign(f, { q: '', st: '', supplier: '', flag: '' }); render(); };
    let qt; $('#prq').oninput = e => { clearTimeout(qt); qt = setTimeout(() => { f.q = e.target.value.trim(); render(); const i = $('#prq'); i.focus(); i.setSelectionRange(i.value.length, i.value.length); }, 250); };
    $('#prsup').onchange = e => { f.supplier = e.target.value; render(); };
    $('#prsort').onchange = e => { f.sort = e.target.value; savePrf(); render(); };
    $('#prdone').onchange = e => { f.hideDone = e.target.checked; savePrf(); render(); };
    $('#prxlsx').onclick = () => exportPR(prMap);
    $('#prprint').onclick = () => { state.printAll = true; render(); setTimeout(() => { window.print(); state.printAll = false; render(); }, 80); };
    $$('[data-toggle]', v).forEach(h => { const go = () => { const k = h.dataset.toggle; state.open.has(k) ? state.open.delete(k) : state.open.add(k); render(); }; h.onclick = go; h.onkeydown = e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go(); } }; });
    $$('[data-item]', v).forEach(r => r.onclick = () => openPRItem(r.dataset.item, prMap));
  }
  function prRow(it, prMap) {
    const fl = flagsOf(it, prMap).filter(x => x !== 'short'), rb = recvBal(it);
    const qty = `${esc(fmtN(it.qty))} <small>${esc(it.unit)}</small>`;
    const rel = (!isEmpty(it.ccQty) || it.releaseDate) ? `${!isEmpty(it.ccQty) ? esc(fmtN(it.ccQty)) + ' <small>' + esc(it.ccUnit) + '</small><br>' : ''}<span class="dim">${it.releaseDate ? esc(fmtD(it.releaseDate)) : 'tgl belum diisi'}</span>` : '<span class="dim">–</span>';
    const po = it.poNo ? `<span class="mono">${esc(it.poNo)}</span><br><span class="dim">${esc(fmtD(it.poDate))}${it.eta ? ' · ETA ' + esc(fmtD(it.eta)) : ''}</span>` : (it.poDate ? esc(fmtD(it.poDate)) : '<span class="dim">–</span>');
    const hasR = !isEmpty(it.recvQty);
    const recv = (hasR || it.recvDate) ? `${hasR ? esc(fmtN(it.recvQty)) + ' <small>' + esc(it.recvUnit) + '</small><br>' : ''}<span class="dim">${it.recvDate ? esc(fmtD(it.recvDate)) : 'tgl belum diisi'}</span>${rb ? '<br>' + balBadge(rb, true) : ''}` : '<span class="dim">–</span>';
    const x = [it.spec ? it.spec.split('\n').length + ' spesifikasi' : '', it.reqDate ? 'Dibutuhkan ' + fmtD(it.reqDate) : (it.reqNote || ''), it.remarks].filter(Boolean).join(' · ');
    return `<div class="row" data-item="${esc(it.id)}" role="button" tabindex="0">
      <div class="num">${esc(fmtN(it.no))}</div>
      <div><div class="d">${esc(it.desc || '(tanpa deskripsi)')}</div>${x ? `<div class="x">${esc(x)}</div>` : ''}</div>
      <div class="c-hide">${qty}</div><div class="c-hide">${rel}</div><div class="c-hide">${po}</div>
      <div class="c-hide">${esc(it.supplier) || '<span class="dim">–</span>'}</div><div class="c-hide">${recv}</div>
      <div><span class="pill ${SCLS[it.status] || 'st-rel'}">${esc(it.status)}</span>${fl.length ? `<span class="flag">${esc(fl.map(z => FLAG_TXT[z]).join(' · '))}</span>` : ''}</div>
      <div class="meta"><span><b>Qty</b> ${qty}</span>${it.poNo ? `<span><b>PO</b> ${esc(it.poNo)}</span>` : ''}${it.supplier ? `<span>${esc(it.supplier)}</span>` : ''}${hasR ? `<span><b>Terima</b> ${esc(fmtN(it.recvQty))} ${esc(it.recvUnit)}</span>` : ''}${rb ? balBadge(rb) : ''}</div>
    </div>`;
  }
  function openPRItem(id, prMap) {
    const it = state.pr.items.find(i => i.id === id); if (!it) return;
    const p = prMap.get(it.pr) || {}, rb = recvBal(it), fl = flagsOf(it, prMap);
    const kv = (k, v) => v ? `<dt>${esc(k)}</dt><dd>${v}</dd>` : '';
    openDrawer({
      eyebrow: `${p.prNo || it.prNo} · item ${fmtN(it.no) || '–'}`, title: it.desc || '(tanpa deskripsi)',
      body: `<div><span class="pill ${SCLS[it.status]}">${esc(it.status)}</span> ${fl.map(z => `<span class="bal neg">${esc(FLAG_TXT[z])}</span>`).join(' ')}</div>
      <dl class="kv">
        ${kv('Qty PR', esc(fmtN(it.qty) + ' ' + it.unit))}${kv('Spesifikasi', esc(it.spec))}
        ${kv('Tanggal PR', esc(fmtD(p.prDate, true)))}${kv('Dibutuhkan', esc(it.reqDate ? fmtD(it.reqDate, true) : it.reqNote))}
        ${kv('Qty release', isEmpty(it.ccQty) ? '' : esc(fmtN(it.ccQty) + ' ' + it.ccUnit))}${kv('Balance CC', esc(it.balance))}${kv('Tgl release', esc(fmtD(it.releaseDate, true)))}
        ${kv('No. PO', esc(it.poNo))}${kv('Tgl PO', esc(fmtD(it.poDate, true)))}${kv('Estimasi kirim', esc(fmtD(it.eta, true)))}
        ${kv('Supplier', esc(it.supplier))}${kv('Diterima', isEmpty(it.recvQty) ? '' : esc(fmtN(it.recvQty) + ' ' + it.recvUnit) + (rb ? ' ' + balBadge(rb) : ''))}
        ${kv('Tgl terima', esc(fmtD(it.recvDate, true)))}${kv('No. SJ', esc(it.sjNo))}${kv('Keterangan', esc(it.remarks))}
        ${kv('Untuk', esc(p.purpose))}${kv('Catatan PR', esc(p.notes))}
      </dl>
      <p class="hint">Data ini dibaca dari Google Sheet Tracking PR. Perubahan dilakukan di Sheet oleh tim logistik.</p>`,
      foot: '<button class="btn" data-close="1">Tutup</button>'
    });
  }
  async function xlsxLib() {
    if (window.XLSX) return window.XLSX;
    await new Promise((res, rej) => { const s = document.createElement('script'); s.src = 'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js'; s.onload = res; s.onerror = () => rej(new Error('Gagal memuat pustaka Excel')); document.head.appendChild(s); });
    return window.XLSX;
  }
  async function exportPR(prMap) {
    try {
      const X = await xlsxLib(), f = state.prf;
      const rows = state.pr.items.filter(i => prMatches(i, prMap));
      const aoa = [['No. PR', 'Tgl PR', 'No', 'Deskripsi', 'Spesifikasi', 'Qty', 'Sat', 'Dibutuhkan', 'Qty Release', 'Sat Release', 'Tgl Release', 'Tgl PO', 'No. PO', 'ETA', 'Qty Terima', 'Sat Terima', 'Tgl Terima', 'No. SJ', 'Supplier', 'Status', 'Keterangan']]
        .concat(rows.map(i => [i.prNo, prMap.get(i.pr)?.prDate || '', i.no, i.desc, i.spec, i.qty, i.unit, i.reqDate || i.reqNote, i.ccQty, i.ccUnit, i.releaseDate, i.poDate, i.poNo, i.eta, i.recvQty, i.recvUnit, i.recvDate, i.sjNo, i.supplier, i.status, i.remarks]));
      const wb = X.utils.book_new(); X.utils.book_append_sheet(wb, X.utils.aoa_to_sheet(aoa), 'Tracking PR');
      X.writeFile(wb, `Tracking-PR-${today()}${f.st ? '-' + f.st.replace(/\s+/g, '') : ''}.xlsx`);
    } catch (e) { toast(e.message || 'Export gagal', true); }
  }

  // =====================================================================
  // STOK
  // =====================================================================
  function ledger() {
    const s = state.stock, out = [];
    s.items.forEach(it => it.ins.forEach(r => out.push({ kind: 'in', type: 'in', id: 'in:' + r.id, key: it.key, name: r.name, unit: r.unit, qty: r.qty, date: r.date, prNo: r.prNo, supplier: r.supplier, sjNo: r.sjNo })));
    s.tx.forEach(t => out.push(Object.assign({ kind: 'tx' }, t)));
    return out.sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')) || (b.createdAt || 0) - (a.createdAt || 0));
  }
  const isVoid = t => t.void === true || String(t.void).toUpperCase() === 'TRUE';
  function saveSf() { const f = state.sf; store('lt_sf', { sort: f.sort, onlySisa: f.onlySisa }); }

  function renderStock(v) {
    if (!state.stock) { v.innerHTML = state.stockErr ? errView(state.stockErr, 'retryST') : '<div class="loading">Memuat stok…</div>'; const r = $('#retryST'); if (r) r.onclick = () => loadStock(true); return; }
    const s = state.stock, f = state.sf, all = s.items.filter(i => !i.hidden), t = today();
    const c = { ok: all.filter(i => i.stok > 0).length, low: all.filter(i => i.status === 'low').length, out: all.filter(i => i.status === 'out').length, loan: s.loans.length,
      today: s.tx.filter(x => !isVoid(x) && (x.type === 'pakai' || x.type === 'pinjam' || x.type === 'serah') && x.date === t).length };
    const late = s.loans.filter(l => daysSince(l.date) > LOAN_LATE_DAYS).length;
    const outSisa = all.filter(i => i.status === 'out' && i.sisaPR > 0).length;
    const k = (cls, key, n, lbl, w) => `<button class="kpi ${cls} ${state.sub === 'stok' && f.filter === key ? 'on' : ''}" data-kpi="${key}"><span class="lbl">${lbl}</span><span class="n">${n}</span><span class="w">${w}</span></button>`;
    v.innerHTML = `<div class="kpis">${k('k-ok', 'ok', c.ok, 'Barang tersedia', `dari ${all.length} jenis`)}${k('k-low', 'low', c.low, 'Stok menipis', 'di bawah minimum')}${k('k-out', 'out', c.out, 'Stok habis', outSisa ? outSisa + ' masih ada sisa PR' : 'cek PR baru')}${k('k-loan', 'loan', c.loan, 'Alat dipinjam', late ? late + ' lewat ' + LOAN_LATE_DAYS + ' hari' : 'belum kembali')}${k('k-in', 'today', c.today, 'Keluar hari ini', 'pakai + pinjam + APD')}</div>
      <div class="tabs stok-tabs" role="tablist">${[['stok', 'Stok'], ['riwayat', 'Riwayat keluar-masuk'], ['dipinjam', 'Alat dipinjam']].map(([id, l]) => `<a class="tab ${state.sub === id ? 'on' : ''}" href="#stok/${id}" role="tab" aria-selected="${state.sub === id}">${l}${id === 'dipinjam' ? ` <span class="cnt">${s.loans.length}</span>` : ''}</a>`).join('')}</div>
      <div id="sub"></div>`;
    $$('[data-kpi]', v).forEach(b => b.onclick = () => {
      const key = b.dataset.kpi;
      if (key === 'loan') { location.hash = '#stok/dipinjam'; return; }
      if (key === 'today') { Object.assign(f, { htype: 'keluar', hfrom: t, hto: t }); location.hash = '#stok/riwayat'; return; }
      f.filter = f.filter === key ? '' : key; if (state.sub !== 'stok') location.hash = '#stok'; else render();
    });
    const sub = $('#sub');
    if (state.sub === 'riwayat') renderRiwayat(sub); else if (state.sub === 'dipinjam') renderDipinjam(sub); else renderStokList(sub);
  }

  function stokRows() {
    const f = state.sf; let arr = state.stock.items.filter(i => f.showHidden ? true : !i.hidden);
    const q = f.q.toLowerCase().split(/\s+/).filter(Boolean);
    if (q.length) arr = arr.filter(i => { const h = (i.name + ' ' + i.rak + ' ' + i.note + ' ' + i.ins.map(r => r.prNo + ' ' + r.supplier).join(' ')).toLowerCase(); return q.every(w => h.includes(w)); });
    if (f.kat === '?') arr = arr.filter(i => i.katSrc === 'tebakan'); else if (f.kat) arr = arr.filter(i => i.kat === f.kat);
    if (f.filter === 'ok') arr = arr.filter(i => i.stok > 0);
    if (f.filter === 'low') arr = arr.filter(i => i.status === 'low');
    if (f.filter === 'out') arr = arr.filter(i => i.status === 'out');
    if (f.onlySisa) arr = arr.filter(i => i.sisaPR > 0);
    arr.sort((a, b) => f.sort === 'stok' ? b.stok - a.stok : f.sort === 'last' ? String(b.last || '').localeCompare(String(a.last || '')) : f.sort === 'low' ? a.stok - b.stok : a.name.localeCompare(b.name, 'id'));
    return arr;
  }
  const KATS = ['Material', 'Alat', 'APD'];
  const KAT_HINT = { Material: 'dipakai habis', Alat: 'dipinjam & dikembalikan', APD: 'diserahkan ke orang' };
  const katChip = i => `<span class="kat ${i.kat === 'Alat' ? 'alat' : i.kat === 'APD' ? 'apd' : ''}" title="Kategori ${i.katSrc === 'app' ? 'diubah di aplikasi' : i.katSrc === 'master' ? 'dari Master' : 'tebakan dari nama'}">${esc(i.kat)}${i.katSrc === 'tebakan' ? '?' : ''}</span>`;

  function renderStokList(el) {
    const f = state.sf, rows = stokRows(), LIM = 400;
    el.innerHTML = `<div class="tools" style="margin:10px 0">
        <input class="inp grow" id="sq" type="search" placeholder="Cari barang, rak, no. PR, supplier…" value="${esc(f.q)}" aria-label="Cari barang">
        <select class="inp" id="skat" style="width:auto" aria-label="Kategori"><option value="">Semua kategori</option>${KATS.map(k => `<option ${f.kat === k ? 'selected' : ''}>${k}</option>`).join('')}<option value="?" ${f.kat === '?' ? 'selected' : ''}>Belum pasti (tebakan)</option></select>
        <select class="inp" id="ssort" style="width:auto" aria-label="Urutan"><option value="nama" ${f.sort === 'nama' ? 'selected' : ''}>Nama A–Z</option><option value="last" ${f.sort === 'last' ? 'selected' : ''}>Aktivitas terakhir</option><option value="stok" ${f.sort === 'stok' ? 'selected' : ''}>Stok terbanyak</option><option value="low" ${f.sort === 'low' ? 'selected' : ''}>Stok tersedikit</option></select>
        <label class="check"><input type="checkbox" id="ssisa" ${f.onlySisa ? 'checked' : ''}>Ada sisa PR</label>
        ${isAdmin() ? `<label class="check"><input type="checkbox" id="shid" ${f.showHidden ? 'checked' : ''}>Tampilkan tersembunyi</label>` : ''}
        <button class="btn sm" id="sxlsx">Excel</button>
        ${isAdmin() ? `<button class="btn sm ${f.katMode ? 'primary' : ''}" id="sKatMode" aria-pressed="${!!f.katMode}">${f.katMode ? '✓ Selesai koreksi' : 'Koreksi kategori'}</button><button class="btn sm" id="sNewItem">+ Barang</button><button class="btn sm primary" id="sOut">Catat keluar</button>` : ''}
      </div>
      ${isAdmin() && f.katMode ? `<div class="katbar"><span>Koreksi cepat: ketuk kategori di tiap baris, langsung tersimpan. ${rows.length ? `Atau ubah <b>${Math.min(rows.length, LIM)}</b> barang yang tampil sekaligus:` : ''}</span>${rows.length ? KATS.map(k => `<button class="btn sm" data-bulkkat="${k}">Semua → ${k}</button>`).join('') : ''}</div>` : ''}
      <div class="resultline">${rows.length} jenis barang${f.filter ? ' · filter: ' + ({ ok: 'tersedia', low: 'menipis', out: 'habis' })[f.filter] + ' <button class="chip" id="sclr">✕</button>' : ''}</div>
      <div class="table" style="margin-top:6px"><div class="sr head"><div>Barang</div><div class="num c-hide" title="Sisa PR yang belum datang">Sisa PR</div><div class="num c-hide">Masuk</div><div class="num c-hide">Keluar</div><div class="num c-hide">Dipinjam</div><div class="num">Stok</div><div>Status</div></div>
      ${rows.slice(0, LIM).map(i => `<div class="sr ${i.hidden ? 'hid' : ''}" data-key="${esc(i.key)}" role="button" tabindex="0">
        <div><div class="nm">${esc(i.name)}</div><div class="sub">${isAdmin() && f.katMode ? `<span class="katseg" role="group" aria-label="Kategori ${esc(i.name)}">${KATS.map(k => `<button type="button" class="${i.kat === k ? (i.katSrc === 'tebakan' ? 'guess' : 'on') : ''}" data-setkat="${k}" data-k="${esc(i.key)}" title="${KAT_HINT[k]}">${k}</button>`).join('')}</span>` : katChip(i)}${i.rak ? '<span>Rak ' + esc(i.rak) + '</span>' : ''}${i.hidden ? '<span>disembunyikan</span>' : ''}${i.sisaPR > 0 ? '<span>sisa PR ' + esc(fmtN(i.sisaPR)) + ' ' + esc(i.sisaUnit) + '</span>' : ''}</div></div>
        <div class="num c-hide">${i.sisaPR > 0 ? esc(fmtN(i.sisaPR)) : '<span class="dim">–</span>'}</div>
        <div class="num c-hide">${esc(fmtN(i.awal + i.inQty))}</div><div class="num c-hide">${esc(fmtN(i.outQty))}</div><div class="num c-hide">${i.dipinjam ? esc(fmtN(i.dipinjam)) : '<span class="dim">–</span>'}</div>
        <div class="avail">${esc(fmtN(i.stok))}<div class="dim" style="font-size:12px;font-family:var(--f-body);font-weight:400">${esc(i.unit)}</div></div>
        <div><span class="pill ${ST_LABEL[i.status][1]}">${ST_LABEL[i.status][0]}</span></div></div>`).join('') || '<div class="empty" style="border:0">Tidak ada barang yang cocok.</div>'}
      ${rows.length > LIM ? `<div class="hint" style="padding:10px 14px">Menampilkan ${LIM} dari ${rows.length}. Persempit dengan pencarian.</div>` : ''}</div>`;
    let qt; $('#sq').oninput = e => { clearTimeout(qt); qt = setTimeout(() => { state.sf.q = e.target.value.trim(); render(); const i = $('#sq'); i.focus(); i.setSelectionRange(i.value.length, i.value.length); }, 250); };
    $('#skat').onchange = e => { f.kat = e.target.value; render(); };
    $('#ssort').onchange = e => { f.sort = e.target.value; saveSf(); render(); };
    $('#ssisa').onchange = e => { f.onlySisa = e.target.checked; saveSf(); render(); };
    const sh = $('#shid'); if (sh) sh.onchange = e => { f.showHidden = e.target.checked; render(); };
    const sc = $('#sclr'); if (sc) sc.onclick = () => { f.filter = ''; render(); };
    $('#sxlsx').onclick = exportStock;
    const so = $('#sOut'); if (so) so.onclick = () => openOut('pakai');
    const sn = $('#sNewItem'); if (sn) sn.onclick = () => openItemForm(null);
    const km = $('#sKatMode'); if (km) km.onclick = () => { f.katMode = !f.katMode; render(); };
    $$('[data-setkat]', el).forEach(b => b.onclick = e => { e.stopPropagation(); setKat([b.dataset.k], b.dataset.setkat); });
    $$('[data-bulkkat]', el).forEach(b => b.onclick = () => { const keys = rows.slice(0, LIM).map(i => i.key); if (confirm(`Ubah kategori ${keys.length} barang yang tampil menjadi ${b.dataset.bulkkat}?`)) setKat(keys, b.dataset.bulkkat); });
    $$('.sr[data-key]', el).forEach(r => { r.onclick = () => { if (!f.katMode) openStockItem(r.dataset.key); }; r.onkeydown = e => { if (e.key === 'Enter') openStockItem(r.dataset.key); }; });
  }

  function renderRiwayat(el) {
    const f = state.sf, LIM = 500;
    let ev = ledger();
    if (f.htype === 'keluar') ev = ev.filter(e => e.type === 'pakai' || e.type === 'pinjam' || e.type === 'serah'); else if (f.htype) ev = ev.filter(e => e.type === f.htype);
    if (f.hfrom) ev = ev.filter(e => (e.date || '') >= f.hfrom);
    if (f.hto) ev = ev.filter(e => (e.date || '') <= f.hto);
    if (f.hq) { const q = f.hq.toLowerCase().split(/\s+/).filter(Boolean); ev = ev.filter(e => { const h = [e.name, e.person, e.purpose, e.prNo, e.supplier, e.note, e.reason].join(' ').toLowerCase(); return q.every(w => h.includes(w)); }); }
    const out = []; let lastDay = null;
    ev.slice(0, LIM).forEach(e => {
      if (e.date !== lastDay) { lastDay = e.date; out.push(`<div class="day">${e.date === today() ? 'Hari ini · ' : ''}${esc(e.date ? fmtD(e.date, true) : 'Tanpa tanggal')}</div>`); }
      const tp = TYPES[e.type] || [e.type, 'p-koreksi'], sign = e.type === 'in' || e.type === 'kembali' || (e.type === 'koreksi' && e.qty > 0) ? '+' : e.type === 'koreksi' ? '' : '−';
      const sub = e.kind === 'in' ? [e.prNo, e.supplier, e.sjNo ? 'SJ ' + e.sjNo : ''].filter(Boolean).join(' · ') : [e.person, e.purpose, e.reason, e.cond].filter(Boolean).join(' · ');
      out.push(`<div class="hr ${e.kind === 'tx' && isVoid(e) ? 'void' : ''}" data-ev="${esc(e.id)}" data-kind="${e.kind}" role="button" tabindex="0">
        <div><span class="pill ${tp[1]}">${esc(tp[0])}</span></div>
        <div><div class="nm">${esc(e.name)}</div><div class="hint">${esc(sub)}${e.kind === 'tx' && isVoid(e) ? ' · <b>dibatalkan</b>: ' + esc(e.voidReason) : ''}</div></div>
        <div class="q">${sign}${esc(fmtN(Math.abs(+e.qty)))} <small class="dim">${esc(e.unit)}</small></div>
        <div class="c-hide hint">${esc(e.note || '')}${e.createdBy ? '<br>oleh ' + esc(e.createdBy) : ''}</div></div>`);
    });
    el.innerHTML = `<div class="tools" style="margin:10px 0">
        <input class="inp grow" id="hq" type="search" placeholder="Cari barang, nama orang, keperluan, PR…" value="${esc(f.hq)}" aria-label="Cari riwayat">
        <select class="inp" id="htype" style="width:auto" aria-label="Jenis"><option value="">Semua jenis</option>${[['in', 'Masuk (PR)'], ['keluar', 'Semua keluar'], ['pakai', 'Pemakaian'], ['serah', 'Serah APD'], ['pinjam', 'Pinjam'], ['kembali', 'Kembali'], ['koreksi', 'Koreksi']].map(([k, l]) => `<option value="${k}" ${f.htype === k ? 'selected' : ''}>${l}</option>`).join('')}</select>
        <input class="inp" type="date" id="hfrom" value="${esc(f.hfrom)}" style="width:auto" aria-label="Dari tanggal"><input class="inp" type="date" id="hto" value="${esc(f.hto)}" style="width:auto" aria-label="Sampai tanggal">
        ${f.htype || f.hfrom || f.hto || f.hq ? '<button class="btn sm ghost" id="hclr">Reset</button>' : ''}
        <button class="btn sm" id="sxlsx">Excel</button>
      </div>
      <div class="resultline">${ev.length} catatan${ev.length > LIM ? ` · menampilkan ${LIM} terbaru` : ''}</div>
      <div class="table" style="margin-top:6px">${out.join('') || '<div class="empty" style="border:0">Belum ada catatan.</div>'}</div>`;
    let qt; $('#hq').oninput = e => { clearTimeout(qt); qt = setTimeout(() => { f.hq = e.target.value.trim(); render(); const i = $('#hq'); i.focus(); i.setSelectionRange(i.value.length, i.value.length); }, 250); };
    $('#htype').onchange = e => { f.htype = e.target.value; render(); };
    $('#hfrom').onchange = e => { f.hfrom = e.target.value; render(); };
    $('#hto').onchange = e => { f.hto = e.target.value; render(); };
    const hc = $('#hclr'); if (hc) hc.onclick = () => { Object.assign(f, { htype: '', hfrom: '', hto: '', hq: '' }); render(); };
    $('#sxlsx').onclick = exportStock;
    $$('[data-ev]', el).forEach(r => r.onclick = () => r.dataset.kind === 'tx' ? openTx(r.dataset.ev) : openStockItem(state.stock.items.find(i => i.ins.some(x => 'in:' + x.id === r.dataset.ev))?.key));
  }

  function renderDipinjam(el) {
    const loans = state.stock.loans;
    el.innerHTML = `<div class="resultline" style="margin:10px 0">${loans.length} peminjaman belum kembali · merah jika lebih dari ${LOAN_LATE_DAYS} hari</div>
      <div class="table">${loans.map(l => { const d = daysSince(l.date); return `<div class="hr" data-loan="${esc(l.id)}">
        <div><span class="pill p-pinjam">${d === null ? '–' : d + ' hari'}</span></div>
        <div><div class="nm">${esc(l.name)}</div><div class="hint">${esc(l.person)}${l.purpose ? ' · ' + esc(l.purpose) : ''} · sejak ${esc(fmtD(l.date, true))}</div>${d > LOAN_LATE_DAYS ? '<div class="late">Lewat ' + LOAN_LATE_DAYS + ' hari</div>' : ''}</div>
        <div class="q">${esc(fmtN(l.sisa))} <small class="dim">${esc(l.unit)}</small>${l.returned ? `<div class="hint">dari ${esc(fmtN(+l.qty))}</div>` : ''}</div>
        <div class="c-hide">${isAdmin() ? `<button class="btn sm" data-ret="${esc(l.id)}">Catat kembali</button>` : ''}</div></div>`; }).join('') || '<div class="empty" style="border:0">Tidak ada alat yang sedang dipinjam.</div>'}</div>`;
    $$('[data-ret]', el).forEach(b => b.onclick = e => { e.stopPropagation(); openReturn(b.dataset.ret); });
    $$('[data-loan]', el).forEach(r => r.onclick = () => isAdmin() ? openReturn(r.dataset.loan) : openTx(r.dataset.loan));
  }

  function openStockItem(key) {
    const s = state.stock, it = key && s.map.get(key); if (!it) return;
    const txs = s.tx.filter(t => t.key === key).sort((a, b) => String(b.date).localeCompare(String(a.date)) || b.createdAt - a.createdAt);
    const kv = (k, v) => v ? `<dt>${esc(k)}</dt><dd>${v}</dd>` : '';
    openDrawer({
      eyebrow: `${it.kat} · ${it.unit}${it.inMaster ? ' · Master' : it.inApp ? ' · ditambah di aplikasi' : ' · dari PR'}`, title: it.name,
      body: `<div class="stat"><div><b>${esc(fmtN(it.stok))}</b><span>Stok ${esc(it.unit)}</span></div><div><b>${esc(fmtN(it.awal))}</b><span>Stok awal</span></div><div><b>${esc(fmtN(it.inQty))}</b><span>Masuk dari PR</span></div><div><b>${esc(fmtN(it.outQty))}</b><span>Dipakai</span></div>${it.serahQty || it.kat === 'APD' ? `<div><b>${esc(fmtN(it.serahQty || 0))}</b><span>Diserahkan (APD)</span></div>` : ''}${it.dipinjam || it.kat === 'Alat' ? `<div><b>${esc(fmtN(it.dipinjam))}</b><span>Dipinjam</span></div>` : ''}${it.adj ? `<div><b>${esc(fmtN(it.adj))}</b><span>Koreksi</span></div>` : ''}</div>
        <div><span class="pill ${ST_LABEL[it.status][1]}">${ST_LABEL[it.status][0]}</span> ${katChip(it)}</div>
        <dl class="kv">${kv('Lokasi rak', esc(it.rak))}${kv('Stok minimum', isEmpty(it.min) || it.min === null ? '' : esc(fmtN(it.min)))}${kv('Catatan', esc(it.note))}${kv('Aktivitas terakhir', esc(fmtD(it.last, true)))}</dl>
        ${it.reqs.length ? `<fieldset><legend>Permintaan di PR</legend><div style="overflow-x:auto"><table class="mini"><thead><tr><th>PR</th><th class="n">Diminta</th><th class="n">Datang</th><th class="n">Sisa</th><th>Status</th></tr></thead><tbody>
          ${it.reqs.map(r => `<tr><td class="mono">${esc(r.prNo)}</td><td class="n">${esc(fmtN(r.qty))} ${esc(r.unit)}</td><td class="n">${esc(fmtN(r.recvQty))}</td><td class="n">${r.sisa === null ? 'cek satuan' : esc(fmtN(r.sisa))}</td><td><span class="pill ${SCLS[r.status] || ''}">${esc(r.status)}</span></td></tr>`).join('')}</tbody></table></div></fieldset>` : ''}
        <fieldset><legend>Riwayat barang</legend>${[...it.ins.map(r => ({ type: 'in', date: r.date, qty: r.qty, sub: [r.prNo, r.supplier].filter(Boolean).join(' · ') })), ...txs.map(t => ({ type: t.type, date: t.date, qty: t.qty, sub: [t.person, t.purpose, t.reason].filter(Boolean).join(' · '), v: isVoid(t), id: t.id }))]
          .sort((a, b) => String(b.date).localeCompare(String(a.date))).slice(0, 60)
          .map(e => `<div style="display:flex;gap:8px;justify-content:space-between;${e.v ? 'opacity:.5;text-decoration:line-through' : ''}" ${e.id ? `data-tx="${esc(e.id)}"` : ''}><span><span class="pill ${TYPES[e.type][1]}">${TYPES[e.type][0]}</span> <span class="hint">${esc(fmtD(e.date))} ${esc(e.sub)}</span></span><b class="num">${esc(fmtN(e.qty))}</b></div>`).join('') || '<span class="hint">Belum ada.</span>'}</fieldset>`,
      foot: isAdmin() ? `<button class="btn sm" data-a="edit">Edit barang</button><button class="btn sm" data-a="hide">${it.hidden ? 'Tampilkan' : 'Sembunyikan'}</button><button class="btn sm" data-a="adj">Koreksi stok</button>${({ Alat: '<button class="btn sm" data-a="pakai">Catat pemakaian</button><button class="btn sm primary" data-a="pinjam">Pinjamkan</button>', APD: '<button class="btn sm" data-a="pakai">Catat pemakaian</button><button class="btn sm primary" data-a="serah">Serahkan APD</button>' })[it.kat] || '<button class="btn sm" data-a="pinjam">Pinjamkan</button><button class="btn sm primary" data-a="pakai">Catat keluar</button>'}` : '<button class="btn" data-close="1">Tutup</button>'
    });
    $$('[data-tx]', $('#drawerRoot')).forEach(r => { r.style.cursor = 'pointer'; r.onclick = () => openTx(r.dataset.tx); });
    $$('[data-a]', $('#drawerRoot')).forEach(b => b.onclick = () => {
      const a = b.dataset.a;
      if (a === 'pakai' || a === 'pinjam' || a === 'serah') openOut(a, key); else if (a === 'adj') openAdjust(key); else if (a === 'edit') openItemForm(key); else if (a === 'hide') hideItem(it);
    });
  }

  // ---------- form admin ----------
  function itemOptions() { return state.stock.items.filter(i => !i.hidden).sort((a, b) => a.name.localeCompare(b.name, 'id')).map(i => `<option value="${esc(i.name + ' [' + i.unit + ']')}"></option>`).join(''); }
  function keyFromLabel(label) { const it = state.stock.items.find(i => i.name + ' [' + i.unit + ']' === label); return it ? it.key : ''; }
  const people = () => [...new Set(state.stock.tx.map(t => t.person).filter(Boolean))].sort();
  const purposes = () => [...new Set(state.stock.tx.map(t => t.purpose).filter(Boolean))].sort();
  const dl = (id, arr) => `<datalist id="${id}">${arr.map(x => `<option value="${esc(x)}"></option>`).join('')}</datalist>`;

  const OUT_MODE = {
    pakai: { t: 'Catat pemakaian', h: 'Stok berkurang permanen (barang habis pakai).', p: 'Diterima oleh', u: 'Keperluan / lokasi kerja', ok: 'pemakaian' },
    pinjam: { t: 'Catat peminjaman alat', h: 'Stok berkurang selama dipinjam dan kembali saat dicatat di tab Alat dipinjam.', p: 'Peminjam', u: 'Keperluan / lokasi kerja', ok: 'pinjam' },
    serah: { t: 'Serah terima APD', h: 'APD diserahkan ke pekerja dan tidak kembali. Nama penerima tercatat di riwayat.', p: 'Nama pekerja penerima', u: 'Jabatan / area kerja', ok: 'serah APD' }
  };
  const MODE_OF_KAT = { Material: 'pakai', Alat: 'pinjam', APD: 'serah' };
  function openOut(mode, presetKey) {
    let lines = [presetKey || ''], qtys = [''];
    let modeTouched = !!presetKey; // dari tombol di detail barang: mode sudah dipilih
    const form = { date: today(), person: '', purpose: '', note: '' };
    const lineHTML = (k, i) => { const it = k && state.stock.map.get(k); return `<div class="line" data-line="${i}"><div class="f"><label for="li${i}">Barang</label><input class="inp" id="li${i}" list="dlItems" value="${it ? esc(it.name + ' [' + it.unit + ']') : ''}" placeholder="Ketik nama barang…" autocomplete="off"><span class="hint" id="lh${i}">${it ? 'Tersedia ' + esc(fmtN(it.stok)) + ' ' + esc(it.unit) : ''}</span></div>
      <div class="f"><label for="lq${i}">Jumlah</label><input class="inp" id="lq${i}" inputmode="decimal" value="${esc(qtys[i] || '')}"></div><button class="btn sm ghost" type="button" data-rm="${i}" aria-label="Hapus baris" ${lines.length < 2 ? 'disabled' : ''}>✕</button></div>`; };
    const draw = () => {
      openDrawer({
        eyebrow: 'Admin · Stok', title: OUT_MODE[mode].t,
        body: `<div class="seg" role="radiogroup">${[['pakai', 'Pemakaian'], ['pinjam', 'Peminjaman alat'], ['serah', 'Serah APD']].map(([m, l]) => `<button type="button" data-mode="${m}" class="${mode === m ? 'on' : ''}" role="radio" aria-checked="${mode === m}">${l}</button>`).join('')}</div>
          <span class="hint">${OUT_MODE[mode].h}</span>${(() => { const mis = lines.map(k => state.stock.map.get(k)).filter(it => it && MODE_OF_KAT[it.kat] !== mode); return mis.length ? `<div class="katbar">Perhatian: ${mis.map(i => esc(i.name) + ' (' + i.kat + ')').join(', ')} biasanya dicatat sebagai <b>${({ pakai: 'Pemakaian', pinjam: 'Peminjaman', serah: 'Serah APD' })[MODE_OF_KAT[mis[0].kat]]}</b>.</div>` : ''; })()}
          <fieldset><legend>Barang</legend>${dl('dlItems', [])}<div id="lines">${lines.map(lineHTML).join('')}</div><button class="btn sm ghost" type="button" id="addLine">+ Tambah barang</button></fieldset>
          <div class="grid2"><div class="f"><label for="oDate">Tanggal</label><input class="inp" type="date" id="oDate" value="${esc(form.date)}"></div>
            <div class="f"><label for="oPerson">${OUT_MODE[mode].p}</label><input class="inp" id="oPerson" list="dlPeople" autocomplete="off" value="${esc(form.person)}">${dl('dlPeople', people())}</div>
            <div class="f wide"><label for="oPurpose">${OUT_MODE[mode].u}</label><input class="inp" id="oPurpose" list="dlPurp" autocomplete="off" value="${esc(form.purpose)}">${dl('dlPurp', purposes())}</div>
            <div class="f wide"><label for="oNote">Catatan</label><input class="inp" id="oNote" value="${esc(form.note)}"></div></div>
          <div id="oErr"></div>`,
        foot: '<button class="btn" data-close="1">Batal</button><button class="btn primary" id="oSave">Simpan</button>'
      });
      $('#dlItems').innerHTML = itemOptions();
      $$('[data-mode]').forEach(b => b.onclick = () => { snap(); mode = b.dataset.mode; modeTouched = true; draw(); });
      $('#addLine').onclick = () => { snap(); lines.push(''); qtys.push(''); draw(); };
      $$('[data-rm]').forEach(b => b.onclick = () => { snap(); lines.splice(+b.dataset.rm, 1); qtys.splice(+b.dataset.rm, 1); draw(); });
      lines.forEach((_, i) => { $('#li' + i).onchange = e => {
        const k = keyFromLabel(e.target.value); const it = state.stock.map.get(k);
        $('#lh' + i).textContent = it ? `Tersedia ${fmtN(it.stok)} ${it.unit} · ${it.kat}` : 'Pilih dari daftar';
        if (it && i === 0 && !modeTouched && MODE_OF_KAT[it.kat] !== mode) { snap(); mode = MODE_OF_KAT[it.kat]; draw(); } // mode mengikuti kategori barang pertama
        else if (it) { snap(); draw(); }
      }; });
      $('#oSave').onclick = save;
    };
    const snap = () => {
      lines = lines.map((k, i) => { const el = $('#li' + i); if (!el) return k; qtys[i] = val('lq' + i); return el.value ? keyFromLabel(el.value) : ''; });
      Object.assign(form, { date: val('oDate') || form.date, person: val('oPerson'), purpose: val('oPurpose'), note: val('oNote') });
    };
    async function save() {
      snap();
      const common = { type: mode, date: val('oDate'), person: val('oPerson'), purpose: val('oPurpose'), note: val('oNote') };
      const payload = [];
      for (let i = 0; i < lines.length; i++) {
        if (!lines[i]) { showErr('oErr', `Baris ${i + 1}: pilih barang dari daftar.`); return; }
        payload.push(Object.assign({ key: lines[i], qty: qtys[i] }, common));
      }
      await submit('oSave', 'oErr', () => apiPost('saveTx', { lines: payload }), `${payload.length} catatan ${OUT_MODE[mode].ok} tersimpan`);
    }
    draw();
  }

  function openReturn(loanId) {
    const l = state.stock.loans.find(x => x.id === loanId); if (!l) { toast('Pinjaman tidak ditemukan atau sudah kembali.', true); return; }
    openDrawer({
      eyebrow: 'Admin · Pengembalian', title: l.name,
      body: `<div class="hint">Dipinjam ${esc(l.person)} sejak ${esc(fmtD(l.date, true))} · sisa ${esc(fmtN(l.sisa))} ${esc(l.unit)}</div>
        <div class="grid2"><div class="f"><label for="rQty">Jumlah kembali</label><input class="inp" id="rQty" inputmode="decimal" value="${esc(l.sisa)}"></div>
          <div class="f"><label for="rDate">Tanggal</label><input class="inp" type="date" id="rDate" value="${today()}"></div>
          <div class="f"><label for="rBy">Dikembalikan oleh</label><input class="inp" id="rBy" value="${esc(l.person)}"></div>
          <div class="f"><label for="rCond">Kondisi</label><select class="inp" id="rCond"><option>Baik</option><option>Rusak ringan</option><option>Rusak berat</option><option>Hilang sebagian</option></select></div>
          <div class="f wide"><label for="rNote">Catatan</label><input class="inp" id="rNote"></div></div><div id="rErr"></div>`,
      foot: '<button class="btn" data-close="1">Batal</button><button class="btn primary" id="rSave">Simpan</button>'
    });
    $('#rSave').onclick = () => submit('rSave', 'rErr', () => apiPost('saveTx', { lines: [{ type: 'kembali', loanId: l.id, key: l.key, qty: val('rQty'), date: val('rDate'), person: val('rBy'), cond: val('rCond'), note: val('rNote') }] }), 'Pengembalian tercatat');
  }

  function openAdjust(key) {
    const it = state.stock.map.get(key);
    openDrawer({
      eyebrow: 'Admin · Koreksi stok', title: it.name,
      body: `<div class="hint">Stok di aplikasi: <b>${esc(fmtN(it.stok))} ${esc(it.unit)}</b>. Isi hasil hitung fisik; selisihnya dicatat sebagai koreksi.</div>
        <div class="grid2"><div class="f"><label for="aPhys">Stok fisik</label><input class="inp" id="aPhys" inputmode="decimal"></div>
          <div class="f"><label for="aDate">Tanggal</label><input class="inp" type="date" id="aDate" value="${today()}"></div>
          <div class="f wide"><span class="lbl">Selisih dicatat</span><b id="aDelta">–</b></div>
          <div class="f wide"><label for="aReason">Alasan</label><input class="inp" id="aReason" placeholder="mis. stock opname, barang rusak, salah input"></div></div><div id="aErr"></div>`,
      foot: '<button class="btn" data-close="1">Batal</button><button class="btn primary" id="aSave">Simpan koreksi</button>'
    });
    const delta = () => { const p = Number(val('aPhys').replace(',', '.')); return val('aPhys') === '' || isNaN(p) ? null : +(p - it.stok).toFixed(3); };
    $('#aPhys').oninput = () => { const d = delta(); $('#aDelta').textContent = d === null ? '–' : (d > 0 ? '+' : '') + fmtN(d) + ' ' + it.unit; };
    $('#aSave').onclick = () => { const d = delta(); if (d === null) { showErr('aErr', 'Isi stok fisik.'); return; } if (d === 0) { showErr('aErr', 'Stok fisik sama dengan stok aplikasi, tidak ada yang perlu dikoreksi.'); return; }
      submit('aSave', 'aErr', () => apiPost('saveTx', { lines: [{ type: 'koreksi', key, qty: d, date: val('aDate'), reason: val('aReason') }] }), 'Koreksi tersimpan'); };
  }

  function openTx(id) {
    const t = state.stock.txById.get(id); if (!t) return;
    const v = isVoid(t), tp = TYPES[t.type];
    const kv = (k, x) => x ? `<dt>${esc(k)}</dt><dd>${esc(x)}</dd>` : '';
    openDrawer({
      eyebrow: `${tp[0]} · ${fmtD(t.date, true)}`, title: t.name,
      body: `${v ? `<div class="err-box">Dibatalkan oleh ${esc(t.voidBy)} (${esc(fmtDT(t.voidAt))}): ${esc(t.voidReason)}</div>` : ''}
        <dl class="kv">${kv('Jumlah', fmtN(+t.qty) + ' ' + t.unit)}${kv('Orang', t.person)}${kv('Keperluan', t.purpose)}${kv('Kondisi', t.cond)}${kv('Alasan', t.reason)}${kv('Catatan', t.note)}${kv('Dicatat oleh', (t.createdBy || '') + ' · ' + fmtDT(t.createdAt))}${t.replaces ? kv('Menggantikan', 'catatan yang diedit') : ''}</dl>`,
      foot: isAdmin() && !v ? '<button class="btn danger" id="tVoid">Batalkan</button><button class="btn primary" id="tEdit">Edit</button>' : '<button class="btn" data-close="1">Tutup</button>'
    });
    if (isAdmin() && !v) { $('#tVoid').onclick = () => openVoid(t); $('#tEdit').onclick = () => openEditTx(t); }
  }
  function openVoid(t) {
    openDrawer({
      eyebrow: 'Admin · Batalkan catatan', title: t.name,
      body: `<div class="hint">Catatan tidak dihapus, hanya ditandai batal sehingga riwayat tetap ada. Stok dihitung ulang.</div>
        <div class="f"><label for="vReason">Alasan pembatalan</label><input class="inp" id="vReason"></div><div id="vErr"></div>`,
      foot: '<button class="btn" data-close="1">Kembali</button><button class="btn danger" id="vSave">Batalkan catatan</button>'
    });
    $('#vSave').onclick = () => submit('vSave', 'vErr', () => apiPost('voidTx', { id: t.id, reason: val('vReason') }), 'Catatan dibatalkan');
  }
  function openEditTx(t) {
    const it = state.stock.map.get(t.key);
    openDrawer({
      eyebrow: `Admin · Edit ${TYPES[t.type][0]}`, title: t.name,
      body: `<div class="hint">Catatan lama ditandai batal dan diganti catatan baru, sehingga jejak perubahan tetap ada.</div>
        <div class="grid2">${t.type !== 'pinjam' && t.type !== 'kembali' ? `<div class="f wide"><label for="eItem">Barang</label><input class="inp" id="eItem" list="dlItems" value="${esc(it ? it.name + ' [' + it.unit + ']' : '')}">${dl('dlItems', [])}</div>` : ''}
          <div class="f"><label for="eQty">Jumlah${t.type === 'koreksi' ? ' (+/−)' : ''}</label><input class="inp" id="eQty" inputmode="decimal" value="${esc(t.qty)}"></div>
          <div class="f"><label for="eDate">Tanggal</label><input class="inp" type="date" id="eDate" value="${esc(t.date)}"></div>
          ${t.type !== 'koreksi' ? `<div class="f"><label for="ePerson">Orang</label><input class="inp" id="ePerson" value="${esc(t.person)}"></div>` : ''}
          ${t.type === 'pakai' || t.type === 'pinjam' || t.type === 'serah' ? `<div class="f"><label for="ePurpose">Keperluan</label><input class="inp" id="ePurpose" value="${esc(t.purpose)}"></div>` : ''}
          ${t.type === 'kembali' ? `<div class="f"><label for="eCond">Kondisi</label><input class="inp" id="eCond" value="${esc(t.cond)}"></div>` : ''}
          ${t.type === 'koreksi' ? `<div class="f wide"><label for="eReason">Alasan koreksi</label><input class="inp" id="eReason" value="${esc(t.reason)}"></div>` : ''}
          <div class="f wide"><label for="eNote">Catatan</label><input class="inp" id="eNote" value="${esc(t.note)}"></div>
          <div class="f wide"><label for="eWhy">Alasan edit</label><input class="inp" id="eWhy" placeholder="mis. salah jumlah"></div></div><div id="eErr"></div>`,
      foot: '<button class="btn" data-close="1">Batal</button><button class="btn primary" id="eSave">Simpan perubahan</button>'
    });
    if ($('#dlItems')) $('#dlItems').innerHTML = itemOptions();
    $('#eSave').onclick = () => {
      const key = $('#eItem') ? keyFromLabel(val('eItem')) : t.key;
      if (!key) { showErr('eErr', 'Pilih barang dari daftar.'); return; }
      const tx = { key, qty: val('eQty'), date: val('eDate'), person: $('#ePerson') ? val('ePerson') : t.person, purpose: $('#ePurpose') ? val('ePurpose') : t.purpose, cond: $('#eCond') ? val('eCond') : t.cond, reason: $('#eReason') ? val('eReason') : t.reason, note: val('eNote') };
      submit('eSave', 'eErr', () => apiPost('editTx', { id: t.id, tx, reason: val('eWhy') }), 'Perubahan tersimpan');
    };
  }

  function openItemForm(key) {
    const it = key ? state.stock.map.get(key) : null;
    openDrawer({
      eyebrow: 'Admin · Data barang', title: it ? it.name : 'Barang baru',
      body: `<div class="grid2">
          ${it ? `<div class="f wide"><span class="lbl">Nama & satuan</span><span>${esc(it.name)} · ${esc(it.unit)}</span><span class="hint">Nama dan satuan terhubung ke data PR/Master, jadi tidak diubah di sini.</span></div>`
          : '<div class="f wide"><label for="iName">Nama barang</label><input class="inp" id="iName"></div><div class="f"><label for="iUnit">Satuan</label><input class="inp" id="iUnit" placeholder="pcs, unit, meter…"></div>'}
          <div class="f wide"><span class="lbl">Kategori</span><div class="seg" id="iKat">${KATS.map(k => `<button type="button" data-k="${k}" class="${(it ? it.kat : 'Material') === k ? 'on' : ''}">${k}</button>`).join('')}</div><span class="hint">Material: dipakai habis · Alat: dipinjam & dikembalikan · APD: diserahkan ke pekerja</span></div>
          <div class="f"><label for="iAwal">Stok awal</label><input class="inp" id="iAwal" inputmode="decimal" value="${it ? esc(it.awal) : '0'}"></div>
          <div class="f"><label for="iMin">Stok minimum</label><input class="inp" id="iMin" inputmode="decimal" value="${it && it.min !== null ? esc(it.min) : ''}" placeholder="kosong = tanpa batas"></div>
          <div class="f"><label for="iRak">Lokasi rak</label><input class="inp" id="iRak" value="${it ? esc(it.rak) : ''}"></div>
          <div class="f wide"><label for="iNote">Catatan</label><input class="inp" id="iNote" value="${it ? esc(it.note) : ''}"></div></div>
        <span class="hint">Data ini disimpan di Data Sheet aplikasi dan menimpa nilai dari Master Stok untuk barang ini.</span><div id="iErr"></div>`,
      foot: '<button class="btn" data-close="1">Batal</button><button class="btn primary" id="iSave">Simpan</button>'
    });
    let kat = it ? it.kat : 'Material';
    $$('#iKat button').forEach(b => b.onclick = () => { kat = b.dataset.k; $$('#iKat button').forEach(x => x.classList.toggle('on', x === b)); });
    $('#iSave').onclick = () => submit('iSave', 'iErr', () => apiPost('saveItem', { key: key || '', name: val('iName'), unit: val('iUnit'), kat, awal: val('iAwal'), min: val('iMin'), rak: val('iRak'), note: val('iNote') }), it ? 'Data barang tersimpan' : 'Barang ditambahkan');
  }
  async function setKat(keys, kat) {
    const prev = keys.map(k => { const it = state.stock.map.get(k); return it && [it, it.kat, it.katSrc]; }).filter(Boolean);
    prev.forEach(([it]) => { it.kat = kat; it.katSrc = 'app'; }); render();
    try { await apiPost('setKat', { keys, kat }); toast(keys.length > 1 ? `${keys.length} barang → ${kat}` : `Kategori → ${kat}`); }
    catch (e) { prev.forEach(([it, k, src]) => { it.kat = k; it.katSrc = src; }); render(); toast(e.message || 'Gagal menyimpan kategori', true); }
  }
  async function hideItem(it) {
    try { await apiPost('hideItem', { key: it.key, hidden: !it.hidden }); afterWrite(it.hidden ? 'Barang ditampilkan lagi' : 'Barang disembunyikan'); }
    catch (e) { toast(e.message || 'Gagal', true); }
  }

  function showErr(id, msg) { const el = document.getElementById(id); if (el) { el.innerHTML = `<div class="err-box">${esc(msg)}</div>`; el.scrollIntoView({ block: 'nearest' }); } }
  async function submit(btnId, errId, fn, okMsg) {
    const b = document.getElementById(btnId); if (b) { b.disabled = true; b.dataset.l = b.textContent; b.textContent = 'Menyimpan…'; }
    try { await fn(); await afterWrite(okMsg); }
    catch (e) { showErr(errId, e.message || 'Gagal menyimpan'); if (b) { b.disabled = false; b.textContent = b.dataset.l; } }
  }

  async function exportStock() {
    try {
      const X = await xlsxLib(), s = state.stock, wb = X.utils.book_new();
      const s1 = [['Nama Barang', 'Satuan', 'Kategori', 'Rak', 'Stok Awal', 'Masuk PR', 'Dipakai', 'Diserahkan (APD)', 'Dipinjam', 'Koreksi', 'Stok', 'Minimum', 'Status', 'Sisa PR', 'Catatan']]
        .concat(s.items.filter(i => !i.hidden).sort((a, b) => a.name.localeCompare(b.name, 'id')).map(i => [i.name, i.unit, i.kat, i.rak, i.awal, i.inQty, i.outQty, i.serahQty || 0, i.dipinjam, i.adj, i.stok, i.min, ST_LABEL[i.status][0], i.sisaPR, i.note]));
      const s2 = [['Tanggal', 'Jenis', 'Barang', 'Qty', 'Satuan', 'Orang', 'Keperluan / PR', 'Catatan', 'Batal', 'Dicatat oleh']]
        .concat(ledger().map(e => [e.date, TYPES[e.type][0], e.name, +e.qty, e.unit, e.person || e.supplier || '', e.purpose || e.prNo || '', e.note || e.reason || '', e.kind === 'tx' && isVoid(e) ? 'Ya: ' + e.voidReason : '', e.createdBy || '']));
      const s3 = [['Sejak', 'Barang', 'Sisa', 'Satuan', 'Peminjam', 'Keperluan', 'Hari']].concat(s.loans.map(l => [l.date, l.name, l.sisa, l.unit, l.person, l.purpose, daysSince(l.date)]));
      X.utils.book_append_sheet(wb, X.utils.aoa_to_sheet(s1), 'STOK'); X.utils.book_append_sheet(wb, X.utils.aoa_to_sheet(s2), 'RIWAYAT'); X.utils.book_append_sheet(wb, X.utils.aoa_to_sheet(s3), 'DIPINJAM');
      X.writeFile(wb, `Stok-Gudang-${today()}.xlsx`);
    } catch (e) { toast(e.message || 'Export gagal', true); }
  }

  // =====================================================================
  // LOGIN & PENGATURAN
  // =====================================================================
  function setAuth(a) { state.auth = a; store('lt_auth', a); }
  function logout(expired) { setAuth(null); if (expired) toast('Sesi admin berakhir. Silakan login lagi.', true); if (state.route === 'pengaturan') location.hash = '#pr'; else render(); }
  async function openLogin() {
    if (!state.status) { try { state.status = await apiGet('status'); } catch (e) { toast(e.message || 'Server tidak bisa dihubungi', true); return; } }
    if (state.status.needsSetup) return openSetup();
    openDrawer({
      eyebrow: 'Admin', title: 'Login admin',
      body: `<form id="lf" class="grid2" onsubmit="return false"><div class="f wide"><label for="lEmail">Email</label><input class="inp" id="lEmail" type="email" autocomplete="username"></div>
        <div class="f wide"><label for="lPw">Password</label><input class="inp" id="lPw" type="password" autocomplete="current-password"></div></form><div id="lErr"></div>
        <p class="hint">Hanya admin yang perlu login. Semua orang bisa melihat data tanpa login.</p>`,
      foot: '<button class="btn" data-close="1">Batal</button><button class="btn primary" id="lGo">Login</button>'
    });
    const go = async () => {
      const b = $('#lGo'); b.disabled = true;
      try { setAuth(await apiPost('login', { email: val('lEmail'), password: $('#lPw').value })); closeDrawer(); toast('Login sebagai admin'); render(); }
      catch (e) { showErr('lErr', e.message); b.disabled = false; }
    };
    $('#lGo').onclick = go; $('#lPw').onkeydown = e => { if (e.key === 'Enter') go(); }; $('#lEmail').focus();
  }
  function openSetup() {
    openDrawer({
      eyebrow: 'Pemasangan pertama', title: 'Buat admin pertama',
      body: `<p class="hint">Belum ada admin. Masukkan <b>kode setup</b> yang tampil di log Apps Script setelah menjalankan fungsi <span class="mono">setup()</span>.</p>
        <div class="grid2"><div class="f wide"><label for="sKey">Kode setup</label><input class="inp mono" id="sKey" autocomplete="off"></div>
        <div class="f"><label for="sName">Nama</label><input class="inp" id="sName"></div><div class="f"><label for="sEmail">Email</label><input class="inp" id="sEmail" type="email" autocomplete="username"></div>
        <div class="f wide"><label for="sPw">Password (min. 8 karakter)</label><input class="inp" id="sPw" type="password" autocomplete="new-password"></div></div><div id="sErr"></div>`,
      foot: '<button class="btn" data-close="1">Batal</button><button class="btn primary" id="sGo">Buat admin</button>'
    });
    $('#sGo').onclick = async () => {
      try { setAuth(await apiPost('setupAdmin', { setupKey: val('sKey'), name: val('sName'), email: val('sEmail'), password: $('#sPw').value })); state.status.needsSetup = false; closeDrawer(); toast('Admin dibuat. Lanjutkan atur sumber data.'); location.hash = '#pengaturan'; }
      catch (e) { showErr('sErr', e.message); }
    };
  }

  async function renderSettings(v) {
    v.innerHTML = '<div class="loading">Memuat pengaturan…</div>';
    let st, admins;
    try { [st, admins] = await Promise.all([apiPost('getSettings'), apiPost('listAdmins')]); }
    catch (e) { v.innerHTML = errView(e, 'retrySet'); const r = $('#retrySet'); if (r) r.onclick = () => render(); return; }
    if (state.route !== 'pengaturan') return;
    const srcCard = (label, s) => s ? `<div class="src"><b>${esc(label)}: ${esc(s.name || s.id)}</b>${s.error ? `<span class="late">${esc(s.error)}</span>` : `<span class="dim">${esc(s.type)} · diubah ${esc(fmtDT(s.updated))}</span><a href="${esc(s.url)}" target="_blank" rel="noopener">Buka file ↗</a>`}</div>` : `<div class="src"><b>${esc(label)}</b><span class="dim">Belum diatur</span></div>`;
    v.innerHTML = `${st.staleFiles && st.staleFiles.length ? `<div class="err-box"><b>Ada file script lama di proyek Apps Script.</b> Fungsi lama menimpa kode baru. Di editor Apps Script, hapus semua file selain <span class="mono">Code.gs</span> dan <span class="mono">appsscript.json</span>, lalu Terapkan → Kelola deployment → Versi baru.</div>` : ''}
      <div style="display:grid;gap:14px;grid-template-columns:repeat(auto-fit,minmax(320px,1fr))">
      <section class="card"><h2>Sumber data</h2>
        ${st.bound
          ? `<p class="hint">Script terpasang di <b>${esc(st.master ? st.master.name : 'Master')}</b>. Master Stok dan transaksi (tab TX, ITEMS, LOG) ada di file itu. Tracking PR hanya <b>dibaca</b> dari link di bawah, lalu disalin ke tab <b>PR_DATA</b> di Master setiap kali berubah.</p>`
          : '<p class="hint">Tempel link Google Sheet. Tracking PR & Master Stok hanya dibaca. Transaksi stok ditulis ke <b>Data Sheet</b> (dibuat otomatis bila dikosongkan).</p>'}
        ${srcCard('Tracking PR (lihat saja)', st.pr)}${srcCard(st.bound ? 'Master (file script ini)' : 'Master Stok', st.master)}${st.bound ? '' : srcCard('Data Sheet aplikasi', st.db)}
        ${st.pr ? `<div class="src"><b>Salinan PR di Master (tab PR_DATA)</b><span class="dim">${st.prCopiedAt ? 'Terakhir disalin ' + esc(fmtDT(st.prCopiedAt)) : 'Belum pernah disalin'} · sinkron otomatis ${st.autoSync ? '<b>aktif (10 menit)</b>' : 'mati'}</span>
          <div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:6px"><button class="btn sm" id="cSync">Sinkron sekarang</button><button class="btn sm" id="cAuto">${st.autoSync ? 'Matikan' : 'Nyalakan'} sinkron otomatis</button></div></div>` : ''}
        <div class="f"><label for="cPr">Link Tracking PR</label><input class="inp" id="cPr" placeholder="https://docs.google.com/spreadsheets/d/…" value="${st.pr ? esc(st.pr.url || '') : ''}"></div>
        ${st.bound ? '' : `<div class="f"><label for="cMs">Link Master Stok <span class="dim">(opsional)</span></label><input class="inp" id="cMs" value="${st.master ? esc(st.master.url || '') : ''}"></div>
        <div class="f"><label for="cDb">Link Data Sheet <span class="dim">(kosongkan untuk dibuat otomatis)</span></label><input class="inp" id="cDb" value="${st.db ? esc(st.db.url || '') : ''}"></div>`}
        <div id="cErr"></div><div><button class="btn primary" id="cSave">Uji & simpan</button></div></section>
      <section class="card"><h2>PIN viewer</h2>
        <p class="hint">${st.pin ? `<b>Aktif</b> sejak ${esc(fmtDT(st.pinAt))}. Hanya orang yang memasukkan PIN (atau admin yang login) yang bisa melihat data.` : '<b>Mati</b>. Siapa pun yang punya link situs bisa melihat data PR & stok.'}</p>
        <div class="f"><label for="vPin">${st.pin ? 'PIN baru' : 'PIN'} (6–12 digit)</label><input class="inp mono" id="vPin" type="password" inputmode="numeric" maxlength="12" autocomplete="new-password"></div>
        <div id="vErr"></div>
        <div style="display:flex;gap:8px;flex-wrap:wrap"><button class="btn primary" id="vSet">${st.pin ? 'Ganti PIN' : 'Aktifkan PIN'}</button>${st.pin ? '<button class="btn danger" id="vOff">Matikan PIN</button>' : ''}</div>
        <span class="hint">Mengganti PIN membuat semua perangkat viewer harus memasukkan PIN baru.</span></section>
      <section class="card"><h2>Admin</h2>
        ${admins.map(a => `<div class="adm"><div><b>${esc(a.name)}</b>${a.me ? ' <span class="dim">(Anda)</span>' : ''}<div class="hint">${esc(a.email)}</div></div>${a.me ? '' : `<button class="btn sm danger" data-rmadm="${esc(a.email)}">Hapus</button>`}</div>`).join('')}
        <fieldset><legend>Tambah admin</legend><div class="grid2"><div class="f"><label for="nName">Nama</label><input class="inp" id="nName"></div><div class="f"><label for="nEmail">Email</label><input class="inp" id="nEmail" type="email"></div>
          <div class="f wide"><label for="nPw">Password awal (min. 8)</label><input class="inp" id="nPw" type="password" autocomplete="new-password"></div></div><div id="nErr"></div><div><button class="btn" id="nAdd">Tambah admin</button></div></fieldset>
        <fieldset><legend>Ganti password saya</legend><div class="grid2"><div class="f"><label for="pOld">Password lama</label><input class="inp" id="pOld" type="password" autocomplete="current-password"></div><div class="f"><label for="pNew">Password baru</label><input class="inp" id="pNew" type="password" autocomplete="new-password"></div></div><div id="pErr"></div><div><button class="btn" id="pSave">Ganti password</button></div></fieldset>
      </section></div>`;
    $('#cSave').onclick = async () => {
      const b = $('#cSave'); b.disabled = true; b.textContent = 'Menguji file…'; $('#cErr').innerHTML = '';
      try {
        const r = await apiPost('setSources', st.bound ? { prUrl: val('cPr') } : { prUrl: val('cPr'), masterUrl: val('cMs'), dbUrl: val('cDb') });
        $('#cErr').innerHTML = `<div class="ok-box">Tersimpan. Tracking PR: ${r.pr.items} item${r.master ? ` · Master: ${r.master.items} barang` : ''}${r.dbCreated ? ' · Data Sheet baru dibuat' : ''}.</div>`;
        state.pr = null; state.stock = null; setTimeout(() => render(), 1500);
      } catch (e) { showErr('cErr', e.message); b.disabled = false; b.textContent = 'Uji & simpan'; }
    };
    const cs = $('#cSync'); if (cs) cs.onclick = async () => { cs.disabled = true; cs.textContent = 'Menyalin…'; try { await apiPost('syncPR'); state.pr = null; state.stock = null; toast('Tracking PR disalin ke Master'); render(); } catch (e) { showErr('cErr', e.message); cs.disabled = false; cs.textContent = 'Sinkron sekarang'; } };
    const ca = $('#cAuto'); if (ca) ca.onclick = async () => { ca.disabled = true; try { await apiPost('setAutoSync', { on: !st.autoSync }); toast(st.autoSync ? 'Sinkron otomatis dimatikan' : 'Sinkron otomatis aktif tiap 10 menit'); render(); } catch (e) { showErr('cErr', e.message); ca.disabled = false; } };
    $('#vSet').onclick = async () => { try { await apiPost('setViewerPin', { pin: val('vPin') }); toast(st.pin ? 'PIN diganti' : 'PIN viewer aktif'); render(); } catch (e) { showErr('vErr', e.message); } };
    const vo = $('#vOff'); if (vo) vo.onclick = async () => { if (!confirm('Matikan PIN? Data akan bisa dilihat siapa pun yang punya link.')) return; try { await apiPost('setViewerPin', { off: true }); toast('PIN dimatikan'); render(); } catch (e) { showErr('vErr', e.message); } };
    $('#nAdd').onclick = async () => { try { await apiPost('addAdmin', { name: val('nName'), email: val('nEmail'), password: $('#nPw').value }); toast('Admin ditambahkan'); render(); } catch (e) { showErr('nErr', e.message); } };
    $$('[data-rmadm]').forEach(b => b.onclick = async () => { if (!confirm('Hapus admin ' + b.dataset.rmadm + '?')) return; try { await apiPost('removeAdmin', { email: b.dataset.rmadm }); toast('Admin dihapus'); render(); } catch (e) { toast(e.message, true); } });
    $('#pSave').onclick = async () => { try { setAuth(await apiPost('changePassword', { oldPassword: $('#pOld').value, newPassword: $('#pNew').value })); toast('Password diganti'); render(); } catch (e) { showErr('pErr', e.message); } };
  }

  // ---------- drawer ----------
  let lastFocus = null;
  function openDrawer({ eyebrow, title, body, foot }) {
    if (!$('#drawerRoot').innerHTML) lastFocus = document.activeElement;
    $('#drawerRoot').innerHTML = `<div class="scrim" data-close="1"></div><aside class="drawer" role="dialog" aria-modal="true" aria-label="${esc(title)}">
      <div class="dh"><div><span class="eyebrow">${esc(eyebrow)}</span><h2>${esc(title)}</h2></div><button class="btn sm ghost" data-close="1" aria-label="Tutup">✕</button></div>
      <div class="db">${body}</div>${foot ? `<div class="df">${foot}</div>` : ''}</aside>`;
    $$('[data-close]', $('#drawerRoot')).forEach(b => b.onclick = closeDrawer);
    const first = $('.drawer input, .drawer select'); (first || $('.drawer .dh button')).focus();
  }
  function closeDrawer() { $('#drawerRoot').innerHTML = ''; if (lastFocus && lastFocus.focus) lastFocus.focus(); }
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && $('#drawerRoot').innerHTML) closeDrawer(); });

  // ---------- start ----------
  async function boot() {
    $('#ver').textContent = 'v1.4.0';
    route();
    if (!API()) return;
    try { state.status = await apiGet('status'); } catch (e) { /* ditangani di tiap tampilan */ }
  }
  // ---------- PWA ----------
  if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
    navigator.serviceWorker.register('sw.js').catch(() => { /* tanpa SW app tetap jalan */ });
  }
  let installEvt = null;
  window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); installEvt = e; $('#btnInstall').hidden = false; });
  window.addEventListener('appinstalled', () => { installEvt = null; $('#btnInstall').hidden = true; toast('Aplikasi terpasang'); });
  $('#btnInstall').onclick = async () => { if (!installEvt) return; installEvt.prompt(); await installEvt.userChoice; installEvt = null; $('#btnInstall').hidden = true; };
  window.addEventListener('online', () => { toast('Kembali online'); reloadCurrent(true); });
  window.addEventListener('offline', () => { toast('Offline: menampilkan data tersimpan', true); renderSrc(); });

  setInterval(() => { if (API() && !document.hidden && !$('#drawerRoot').innerHTML) reloadCurrent(false); }, 5 * 60 * 1000);
  boot();
})();
