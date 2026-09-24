'use strict';
/* Editor, saved documents, settings, PDF export. */

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];

let S = mergeDefaults(DEFAULT_SETTINGS, Store.get('dc_settings'));
let docs = Store.get('dc_docs', []);
let doc = null;
let dirty = false;
let readOnly = false;   // true while viewing a document that belongs to the other team

let USER = null;        // signed-in user (null when the app runs without the server)
let REGION = null;      // team the app is working in: 'UAE' | 'IN' | null = no restriction (no server)
let ALL_S = null;       // settings of both teams when signed in
const isAdmin = () => !!USER && USER.role === 'admin';
const SB = br => (ALL_S && ALL_S[br]) || S;                            // settings that apply to a branch
const canEdit = d => !REGION || isAdmin() || d.branch === REGION;
const canWriteRegion = r => !REGION || isAdmin() || USER.homeRegion === r;
const regionName = r => (r === 'IN' ? 'India' : 'UAE');
function setS(next) { S = next; if (ALL_S && REGION) ALL_S[REGION] = S; }

/* ---------------- persistence ---------------- */
function saveSettings() { saveSettingsFor(REGION); }
function saveSettingsFor(region) {
  const data = region ? SB(region) : S;
  const ok = Store.set(region ? 'dc_settings_' + region : 'dc_settings', data);
  if (API.online && region) {
    API.putSettings(region, clone(data)).catch(err => toast(err.status === 403 ? err.message : 'Could not save settings to the database – will retry.', true));
  } else if (!ok) toast('Could not save settings – browser storage is full or blocked (try a smaller logo image).', true);
}

/* ---------------- database sync ---------------- */
function setDbStatus(state) {
  const el = $('#dbStatus');
  if (!el) return;
  el.hidden = false;
  el.className = 'db-pill ' + state;
  if (state === 'db') { el.textContent = `SQL Server · ${API.info ? API.info.database : ''}`; el.title = `Data is stored in SQL Server on ${API.info ? API.info.server : ''}`; }
  else if (state === 'queued') { el.textContent = 'Syncing…'; el.title = 'Changes are queued and will be sent to the database shortly'; }
  else { el.textContent = 'Browser storage'; el.title = 'The database server is not running – data is kept in this browser only. Start server/start.bat to use SQL Server.'; }
}

function remotePutDoc(d) {
  if (!API.online) return;
  API.putDoc(clone(d)).catch(err => {
    if (err.status === 409) resolveDuplicateNumber(d.id, err.body && err.body.number);
    else toast('Could not save to the database – will retry automatically.', true);
  });
}

/** Someone else already used this number: move this document to the next free one. */
function resolveDuplicateNumber(id, usedNumber) {
  const i = docs.findIndex(x => x.id === id);
  if (i < 0) return;
  const d = docs[i];
  const key = `${d.type}-${d.branch}`;
  let r, guard = 0;
  do {
    r = nextNumber(d.type, d.branch, d.date);
    SB(d.branch).counters[key] = r.seq + 1;
  } while (r.number === usedNumber && guard++ < 100);
  d.number = r.number;
  d.updatedAt = new Date().toISOString();
  if (doc.id === id) { doc.number = r.number; doc.numberAssigned = true; syncForm(); renderPreview(); persistDraft(); }
  Store.set('dc_docs', docs);
  saveSettingsFor(REGION ? d.branch : null);
  remotePutDoc(d);
  toast(`Number ${usedNumber} was already used on another computer – this document is now ${r.number}`, true);
}

/** Loads both teams' settings and all documents from the server; the first time, copies this browser's data up. */
async function loadFromServer() {
  try {
    await API.flush();                       // send anything queued from a previous session first
    const [remote, remoteDocs] = await Promise.all([API.getAllSettings(), API.getDocs()]);
    const localDocs = docs;
    const legacyLocal = Store.get('dc_settings');   // settings saved before sign-in existed
    ALL_S = {};
    for (const r of ['UAE', 'IN']) {
      const cached = Store.get('dc_settings_' + r);
      ALL_S[r] = mergeDefaults(DEFAULT_SETTINGS, remote[r] || cached || (r === REGION ? legacyLocal : null));
      ALL_S[r].lastBranch = r;
      if (!remote[r] && canWriteRegion(r)) API.putSettings(r, clone(ALL_S[r])).catch(() => {});
      Store.set('dc_settings_' + r, ALL_S[r]);
    }
    S = ALL_S[REGION];
    if (remoteDocs.length || !localDocs.length) docs = remoteDocs;
    else {
      // first connection ever: copy this browser's documents (own team only) to the database
      docs = localDocs.filter(d => canEdit(d));
      docs.forEach(d => API.putDoc(d).catch(err => { if (err.status === 409) resolveDuplicateNumber(d.id, d.number); }));
      if (docs.length) toast(`Copied ${docs.length} document${docs.length === 1 ? '' : 's'} from this browser to the database`);
    }
    Store.set('dc_docs', docs);
  } catch (err) {
    console.error(err);
    toast('Could not load data from the database: ' + err.message, true);
    throw err;
  }
}
function persistDraft() { Store.set('dc_current', { doc, dirty }); }
const isSaved = d => docs.some(x => x.id === d.id);

/* ---------------- numbering ---------------- */
function nextNumber(type, branch, date) {
  const RS = SB(branch);
  const taken = new Set(docs.filter(x => x.id !== doc?.id).map(x => x.number));
  let seq = Number(RS.counters[`${type}-${branch}`]) || 1;
  let number;
  for (;;) {
    number = formatNumber(RS.numbering[type], branch, date, seq, RS.numbering.pad);
    if (!taken.has(number)) break;
    seq++;
  }
  return { number, seq };
}
function refreshAutoNumber() {
  if (doc.autoNumber && !doc.numberAssigned) doc.number = nextNumber(doc.type, doc.branch, doc.date).number;
}

/* ---------------- new documents ---------------- */
function newDoc(type, branch) {
  branch = REGION || branch || S.lastBranch || 'UAE';   // signed in: always your own team
  const b = S.branches[branch];
  const d = {
    id: uid(), type, branch, number: '', autoNumber: true, numberAssigned: false,
    date: todayISO(), currency: b.currency, status: STATUSES[type][0],
    customer: { company: '', contact: '', address: '', city: '', country: branch === 'IN' ? 'India' : 'UAE', mobile: '', email: '', taxId: '' },
    customerType: 'new',
    showVersion: type === 'invoice', softwareVersion: S.softwareVersions[0] || 'DataCare Next',
    items: [{ desc: '', amount: 0 }],
    discount: 0, taxEnabled: false, taxLabel: b.taxLabel, taxRate: b.taxRate, advance: 0,
    showWords: type === 'invoice', notes: '',
    showHardware: type === 'quotation', hardware: [...S.hardware],
    terms: [...S.terms[type]], amcPercent: S.amcPercent, termsNewPage: type === 'invoice',
    preparedBy: (USER && USER.displayName) || S.preparedBy, preparedMobile: (USER && USER.phone) || b.phone,
    showAcceptance: type === 'invoice', showStamp: false
  };
  const saved = doc; doc = d; refreshAutoNumber(); doc = saved;
  return d;
}

function openDoc(d, isDirty = false) {
  doc = d;
  dirty = isDirty;
  readOnly = !canEdit(d);
  loadForm();
  renderPreview();
  persistDraft();
  showView('editor');
}

async function confirmDiscard() {
  return !dirty || ask({
    title: 'Discard unsaved changes?',
    message: 'The document you are editing has changes that are not saved yet.',
    ok: 'Discard changes', danger: true
  });
}

/* ---------------- editor form ---------------- */
const opt = (v, label, sel) => `<option value="${esc(v)}"${String(v) === String(sel) ? ' selected' : ''}>${esc(label)}</option>`;

function formHTML(d) {
  const isInv = d.type === 'invoice';
  return `
  <fieldset class="fs"><legend>Document</legend>
    <div class="row">
      <div><div class="hint">Type</div><div class="seg" data-seg="type">
        <button type="button" data-v="quotation">Quotation</button><button type="button" data-v="invoice">Invoice</button></div></div>
      <div><div class="hint">Issuing branch</div>${REGION
        ? `<div class="branch-fixed"><span class="chip">${regionName(d.branch)}</span>${d.branch !== REGION ? '<small class="muted">other team</small>' : ''}</div>`
        : `<div class="seg" data-seg="branch"><button type="button" data-v="UAE">UAE</button><button type="button" data-v="IN">India</button></div>`}</div>
    </div>
    <div class="row">
      <label class="f">${isInv ? 'Invoice' : 'Quotation'} No.<input data-f="number" placeholder="Auto"></label>
      <label class="f">Date<input type="date" data-f="date"></label>
    </div>
    <div class="hint" id="numHint"></div>
    <div class="row">
      <label class="f">Currency<select data-f="currency">${Object.keys(CURRENCIES).map(c => opt(c, c, d.currency)).join('')}</select></label>
      <label class="f">Status<select data-f="status">${STATUSES[d.type].map(s => opt(s, s, d.status)).join('')}</select></label>
    </div>
  </fieldset>

  <fieldset class="fs"><legend>Customer</legend>
    <div class="row one"><label class="f">Company Name<input data-f="customer.company" list="custList" autocomplete="off" placeholder="Start typing – saved customers autofill"></label></div>
    <div class="row one"><label class="f">Contact Person<input data-f="customer.contact"></label></div>
    <div class="row one"><label class="f">Address<input data-f="customer.address" placeholder="e.g. Gold Souq, Dubai, U.A.E."></label></div>
    <div class="row">
      <label class="f"><span id="cityLbl">City</span><input data-f="customer.city"></label>
      <label class="f">Country<input data-f="customer.country" list="countryList"></label>
    </div>
    <div class="row">
      <label class="f">Mobile No.<input data-f="customer.mobile" type="tel"></label>
      <label class="f">Email (optional)<input data-f="customer.email" type="email"></label>
    </div>
    <div class="row">
      <label class="f">TRN / GSTIN (optional)<input data-f="customer.taxId"></label>
      <div><div class="hint">Customer type</div><div class="seg" data-seg="customerType">
        <button type="button" data-v="existing">Existing</button><button type="button" data-v="new">New</button></div></div>
    </div>
    <datalist id="custList"></datalist>
    <datalist id="countryList"><option value="UAE"><option value="India"><option value="Oman"><option value="Qatar"><option value="Saudi Arabia"><option value="Bahrain"><option value="Kuwait"></datalist>
  </fieldset>

  <fieldset class="fs"><legend>Software</legend>
    <label class="chk"><input type="checkbox" data-f="showVersion"> Show “Software Version” section</label>
    <div class="row one"><label class="f">Software Version<input data-f="softwareVersion" list="verList"></label></div>
    <datalist id="verList">${S.softwareVersions.map(v => `<option value="${esc(v)}">`).join('')}</datalist>
  </fieldset>

  <fieldset class="fs"><legend>Order Details</legend>
    <div class="hint" style="display:flex;justify-content:space-between"><span>Description</span><span style="margin-right:40px">Price</span></div>
    <div id="items"></div>
    <div class="items-actions">
      <button type="button" class="btn sm" id="addItem">+ Add row</button>
      <select id="presetSel"><option value="">+ Add from price list…</option>${S.presets.map((p, i) => opt(i, p.desc, '')).join('')}</select>
    </div>
    <div class="row" style="margin-top:10px">
      <label class="f">Discount (amount)<input type="number" step="any" min="0" data-f="discount"></label>
      <label class="f">Advance received<input type="number" step="any" min="0" data-f="advance"></label>
    </div>
    <label class="chk"><input type="checkbox" data-f="taxEnabled"> Add tax</label>
    <div class="row" id="taxRow">
      <label class="f">Tax label<input data-f="taxLabel"></label>
      <label class="f">Rate %<input type="number" step="any" min="0" data-f="taxRate"></label>
    </div>
    <label class="chk"><input type="checkbox" data-f="showWords"> Show amount in words</label>
    <div class="sum-box" id="sumBox"></div>
    <div class="row one" style="margin-top:10px"><label class="f">Note (optional, printed below the table)<textarea data-f="notes" rows="2" style="min-height:48px"></textarea></label></div>
  </fieldset>

  <fieldset class="fs"><legend>Hardware Configuration</legend>
    <label class="chk"><input type="checkbox" data-f="showHardware"> Show hardware configuration</label>
    <label class="f">One point per line<textarea data-f="hardware" data-list rows="4"></textarea></label>
    <button type="button" class="btn link" id="resetHw">Reset to default</button>
  </fieldset>

  <fieldset class="fs"><legend>Terms &amp; Conditions</legend>
    <div class="row">
      <label class="f">AMC %<input type="number" step="any" min="0" data-f="amcPercent"></label>
      <div style="display:flex;align-items:flex-end"><label class="chk"><input type="checkbox" data-f="termsNewPage"> Start on new page</label></div>
    </div>
    <label class="f">One term per line — <code>{AMC}</code> is replaced with the AMC %<textarea data-f="terms" data-list rows="10"></textarea></label>
    <button type="button" class="btn link" id="resetTerms">Reset to default ${isInv ? 'invoice' : 'quotation'} terms</button>
  </fieldset>

  <fieldset class="fs"><legend>Signature</legend>
    <div class="row">
      <label class="f">Prepared By<input data-f="preparedBy"></label>
      <label class="f">Mobile<input data-f="preparedMobile"></label>
    </div>
    <label class="chk"><input type="checkbox" data-f="showAcceptance"> Show “Read and accepted…” customer signature block</label>
    <label class="chk"><input type="checkbox" data-f="showStamp" ${S.stamp ? '' : 'disabled'}> Show company stamp / signature ${S.stamp ? '' : '<span class="hint">(upload one in Settings)</span>'}</label>
  </fieldset>`;
}

const getPath = (o, p) => p.split('.').reduce((a, k) => (a == null ? a : a[k]), o);
function setPath(o, p, v) {
  const ks = p.split('.');
  const last = ks.pop();
  ks.reduce((a, k) => (a[k] ??= {}), o)[last] = v;
}
function readVal(el) {
  if (el.type === 'checkbox') return el.checked;
  if (el.type === 'number') return el.value === '' ? 0 : (parseFloat(el.value) || 0);
  if (el.hasAttribute('data-list')) return el.value.split('\n').map(s => s.trim()).filter(Boolean);
  return el.value;
}
function writeVal(el, v) {
  if (el.type === 'checkbox') el.checked = !!v;
  else if (el.hasAttribute('data-list')) el.value = (v || []).join('\n');
  else el.value = v ?? '';
}

function loadForm() {
  const form = $('#form');
  form.innerHTML = (readOnly ? `<div class="ro-banner">${icon('eye')}<div><b>View only.</b> This ${doc.type} belongs to the ${regionName(doc.branch)} team. You can read it and download the PDF, but not change it.</div></div>` : '') + formHTML(doc);
  renderItems();
  syncForm();
  refreshCustomerList();
  form.classList.toggle('readonly', readOnly);
  if (readOnly) $$('input, select, textarea, button', form).forEach(el => { el.disabled = true; });
  $('#btnSave').hidden = readOnly;
}

/** Push doc values into inputs (skipping the one being typed in). */
function syncForm() {
  $$('#form [data-f]').forEach(el => { if (el !== document.activeElement) writeVal(el, getPath(doc, el.dataset.f)); });
  $$('#form [data-seg]').forEach(seg => {
    const v = getPath(doc, seg.dataset.seg);
    $$('button', seg).forEach(b => b.classList.toggle('on', b.dataset.v === v));
  });
  const uae = /^(uae|u\.a\.e\.?|united arab emirates)$/i.test((doc.customer.country || '').trim());
  $('#cityLbl').textContent = uae ? 'Emirate' : 'City';
  $('#taxRow').style.display = doc.taxEnabled ? '' : 'none';
  $('#numHint').textContent = doc.autoNumber && !doc.numberAssigned
    ? 'Number is assigned automatically when you save. Type your own to override.'
    : (doc.autoNumber ? '' : 'Custom number. Clear the field to go back to automatic numbering.');
  updateSum();
}

function renderItems() {
  $('#items').innerHTML = doc.items.map((it, i) => `
    <div class="item-row">
      <textarea data-item="${i}" data-k="desc" rows="1" placeholder="Description">${esc(it.desc)}</textarea>
      <input data-item="${i}" data-k="amount" type="number" step="any" min="0" value="${it.amount ? esc(it.amount) : ''}" placeholder="0">
      <button type="button" class="icon-btn" data-del="${i}" title="Remove row" aria-label="Remove row">×</button>
    </div>`).join('');
}

function updateSum() {
  const t = docTotals(doc);
  const c = doc.currency;
  const line = (l, v, cls = '') => `<div class="${cls}"><span>${l}</span><span>${c} ${fmtMoney(v, c, false)}</span></div>`;
  let h = line('Sub total', t.sub);
  if (t.disc) h += line('Discount', -t.disc);
  if (doc.taxEnabled) h += line(`${esc(doc.taxLabel)} ${doc.taxRate}%`, t.tax);
  h += line('Total payable', t.total, 't');
  if (t.adv) h += line('Advance', t.adv) + line('Balance due', t.balance, 't');
  $('#sumBox').innerHTML = h;
}

function customerIndex() {
  const m = new Map();
  [...docs].sort((a, b) => (a.updatedAt || '').localeCompare(b.updatedAt || ''))
    .forEach(d => { if (d.customer.company.trim()) m.set(d.customer.company.trim().toLowerCase(), d.customer); });
  return m;
}
function refreshCustomerList() {
  const dl = $('#custList');
  if (dl) dl.innerHTML = [...customerIndex().values()].map(c => `<option value="${esc(c.company)}">${esc([c.city, c.mobile].filter(Boolean).join(' · '))}</option>`).join('');
}

function changed() {
  dirty = true;
  $('#dirtyFlag').hidden = false;
  updateSum();
  persistDraft();
  scheduleRender();
}

function onField(f, el) {
  if (f === 'number') {
    doc.autoNumber = !el.value.trim();
    if (doc.autoNumber) { doc.numberAssigned = false; refreshAutoNumber(); }
  } else if (f === 'date') {
    refreshAutoNumber();
  } else if (f === 'customer.company') {
    const hit = customerIndex().get(el.value.trim().toLowerCase());
    if (hit && !doc.customer.mobile && !doc.customer.address && !doc.customer.contact) {
      doc.customer = { ...clone(hit), company: el.value };
      doc.customerType = 'existing';
      toast('Customer details filled from saved records');
    }
  }
  syncForm();
}

function setType(t) {
  if (doc.type === t) return;
  const old = doc.type;
  if (JSON.stringify(doc.terms) === JSON.stringify(S.terms[old])) doc.terms = [...S.terms[t]];
  Object.assign(doc, {
    type: t,
    showHardware: t === 'quotation', showVersion: t === 'invoice',
    showAcceptance: t === 'invoice', termsNewPage: t === 'invoice'
  });
  if (!STATUSES[t].includes(doc.status)) doc.status = STATUSES[t][0];
  if (doc.autoNumber) { doc.numberAssigned = false; refreshAutoNumber(); }
}

function setBranch(br) {
  if (doc.branch === br) return;
  const ob = S.branches[doc.branch], nb = S.branches[br];
  if (doc.currency === ob.currency && ob.currency !== nb.currency) {
    // switch price-list items to the new currency's price
    doc.items.forEach(it => {
      const p = S.presets.find(p => p.desc === it.desc);
      if (p && Number(it.amount) === Number(p[ob.currency])) it.amount = Number(p[nb.currency]) || 0;
    });
    doc.currency = nb.currency;
  }
  if (doc.taxLabel === ob.taxLabel && Number(doc.taxRate) === Number(ob.taxRate)) { doc.taxLabel = nb.taxLabel; doc.taxRate = nb.taxRate; }
  if (doc.preparedMobile === ob.phone) doc.preparedMobile = nb.phone;
  const defCountry = b => (b === 'IN' ? 'India' : 'UAE');
  if (!doc.customer.country || doc.customer.country === defCountry(doc.branch)) doc.customer.country = defCountry(br);
  doc.branch = br;
  S.lastBranch = br; saveSettings();
  if (doc.autoNumber) { doc.numberAssigned = false; refreshAutoNumber(); }
}

function bindForm() {
  const form = $('#form');
  form.addEventListener('input', e => {
    const el = e.target;
    if (el.dataset.item !== undefined) {
      const it = doc.items[+el.dataset.item];
      it[el.dataset.k] = el.dataset.k === 'amount' ? (parseFloat(el.value) || 0) : el.value;
    } else if (el.dataset.f) {
      setPath(doc, el.dataset.f, readVal(el));
      onField(el.dataset.f, el);
    } else return;
    changed();
  });
  form.addEventListener('change', e => {
    if (e.target.id !== 'presetSel' || e.target.value === '') return;
    const p = S.presets[+e.target.value];
    const row = { desc: p.desc, amount: Number(p[doc.currency]) || 0 };
    if (doc.items.length === 1 && !doc.items[0].desc && !doc.items[0].amount) doc.items[0] = row; else doc.items.push(row);
    e.target.value = '';
    renderItems(); changed();
  });
  form.addEventListener('click', e => {
    const b = e.target.closest('button');
    if (!b) return;
    const seg = b.closest('[data-seg]');
    if (seg) {
      const k = seg.dataset.seg, v = b.dataset.v;
      if (k === 'type') { setType(v); loadForm(); }
      else if (k === 'branch') { if (REGION) return; setBranch(v); loadForm(); }
      else { setPath(doc, k, v); syncForm(); }
      changed();
    } else if (b.dataset.del !== undefined) {
      doc.items.splice(+b.dataset.del, 1);
      if (!doc.items.length) doc.items.push({ desc: '', amount: 0 });
      renderItems(); changed();
    } else if (b.id === 'addItem') {
      doc.items.push({ desc: '', amount: 0 });
      renderItems(); changed();
      $$('#items textarea').pop().focus();
    } else if (b.id === 'resetTerms') {
      doc.terms = [...S.terms[doc.type]]; syncForm(); changed();
    } else if (b.id === 'resetHw') {
      doc.hardware = [...S.hardware]; syncForm(); changed();
    }
  });
}

/* ---------------- saving ---------------- */
function saveDoc(silent = false) {
  if (readOnly) { toast(`This document belongs to the ${regionName(doc.branch)} team and can only be viewed.`, true); return false; }
  if (doc.autoNumber && !doc.numberAssigned) {
    const r = nextNumber(doc.type, doc.branch, doc.date);
    doc.number = r.number;
    doc.numberAssigned = true;
    SB(doc.branch).counters[`${doc.type}-${doc.branch}`] = r.seq + 1;
    saveSettingsFor(REGION ? doc.branch : null);
  } else if (docs.some(x => x.id !== doc.id && x.number === doc.number && x.type === doc.type)) {
    toast(`Warning: another ${doc.type} already uses number ${doc.number}`, true);
  }
  const now = new Date().toISOString();
  doc.createdAt ||= now;
  doc.updatedAt = now;
  doc.total = docTotals(doc).total;
  const i = docs.findIndex(x => x.id === doc.id);
  if (i >= 0) docs[i] = clone(doc); else docs.unshift(clone(doc));
  const stored = Store.set('dc_docs', docs);
  if (!stored && !API.online) { toast('Saving failed – browser storage is full or blocked.', true); return false; }
  remotePutDoc(doc);
  dirty = false;
  $('#dirtyFlag').hidden = true;
  persistDraft();
  syncForm();
  refreshCustomerList();
  renderPreview();
  if (!silent) toast(`Saved ${doc.type === 'invoice' ? 'invoice' : 'quotation'} ${doc.number}`);
  return true;
}

/* ---------------- preview ---------------- */
let renderTimer;
function scheduleRender() { clearTimeout(renderTimer); renderTimer = setTimeout(renderPreview, 120); }

function renderPreview() {
  const area = $('#render-area');
  renderPages(doc, SB(doc.branch), area);
  const prev = $('#preview');
  prev.innerHTML = '';
  while (area.firstChild) prev.appendChild(area.firstChild);
  applyZoom();
  const b = BRANCH_NAMES[doc.branch];
  $('#docLabel').textContent = `${doc.type === 'invoice' ? 'Invoice' : 'Quotation'} ${doc.number || ''} · ${b}${isSaved(doc) ? '' : ' · new'}`;
  $('#dirtyFlag').hidden = !dirty;
}

function applyZoom() {
  const v = $('#zoomSel').value;
  const z = v === 'fit' ? Math.max(0.3, Math.min(1, ($('#previewScroll').clientWidth - 44) / 794)) : Number(v);
  $('#preview').style.zoom = z;
}

/* ---------------- PDF / print ---------------- */
function fileBase(d) {
  const clean = s => String(s || '').replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim();
  const parts = [clean(d.customer.company).toUpperCase(), clean(d.customer.city).toUpperCase()].filter(Boolean);
  const kind = d.type === 'invoice' ? 'Invoice' : 'Quotation';
  return `${parts.join(' - ') || kind}${parts.length ? ` - ${kind}` : ''} ${clean(d.number)}`.trim();
}

function waitAssets(root) {
  const imgs = $$('img', root).map(im => (im.complete ? null : new Promise(r => { im.onload = im.onerror = r; })));
  return Promise.all([...imgs, document.fonts ? document.fonts.ready : null]);
}

const CDN = {
  html2canvas: 'https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js',
  jspdf: 'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js'
};
function loadScript(src) {
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = src;
    s.onload = resolve;
    s.onerror = () => reject(new Error('could not load ' + src.split('/').pop()));
    document.head.appendChild(s);
  });
}
async function loadLibs() {
  if (!window.html2canvas) await loadScript('js/vendor/html2canvas.min.js').catch(() => loadScript(CDN.html2canvas));
  if (!window.jspdf) await loadScript('js/vendor/jspdf.umd.min.js').catch(() => loadScript(CDN.jspdf));
}

/** Renders any document to a PDF file. Returns true on success. */
async function exportPdf(d) {
  const area = $('#render-area');
  try {
    await loadLibs();
    renderPages(d, SB(d.branch), area);
    await waitAssets(area);
    Object.assign(area.style, { left: '0px', zIndex: '-1' });
    const { jsPDF } = window.jspdf;
    const pdf = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait', compress: true });
    const pages = $$('.page', area);
    for (let i = 0; i < pages.length; i++) {
      const canvas = await html2canvas(pages[i], { scale: 2.5, backgroundColor: '#ffffff', logging: false, useCORS: true, scrollX: 0, scrollY: 0 });
      if (i) pdf.addPage();
      pdf.addImage(canvas.toDataURL('image/jpeg', 0.93), 'JPEG', 0, 0, 210, 297, undefined, 'FAST');
    }
    pdf.setProperties({ title: fileBase(d), author: SB(d.branch).legalName, creator: SB(d.branch).legalName });
    pdf.save(fileBase(d) + '.pdf');
    toast(`PDF downloaded – ${d.number}`);
    return true;
  } catch (err) {
    console.error(err);
    toast('Direct PDF download is unavailable (' + (err.message || err) + '). Open the document and use Print → “Save as PDF”.', true);
    return false;
  } finally {
    area.innerHTML = '';
    Object.assign(area.style, { left: '', zIndex: '' });
  }
}

async function downloadPdf() {
  if (!readOnly && (dirty || !isSaved(doc)) && !saveDoc(true)) return;
  const btn = $('#btnPdf');
  btn.disabled = true; btn.textContent = 'Preparing…';
  await exportPdf(doc);
  btn.disabled = false; btn.textContent = 'Download PDF';
}

async function printDoc() {
  const area = $('#render-area');
  renderPages(doc, SB(doc.branch), area);
  await waitAssets(area);
  const title = document.title;
  document.title = fileBase(doc); // default file name for "Save as PDF"
  window.addEventListener('afterprint', () => { area.innerHTML = ''; document.title = title; }, { once: true });
  window.print();
}

/* ---------------- saved documents ---------------- */
const ICONS = {
  edit: '<path d="M4 20h4L19 9l-4-4L4 16v4z"/><path d="M14 6l4 4"/>',
  pdf: '<path d="M12 4v11"/><path d="M7 10l5 5 5-5"/><path d="M5 20h14"/>',
  copy: '<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"/>',
  convert: '<path d="M5 12h13"/><path d="M13 6l6 6-6 6"/>',
  trash: '<path d="M4 7h16"/><path d="M10 11v6M14 11v6"/><path d="M6 7l1 13h10l1-13"/><path d="M9 7V4h6v3"/>',
  doc: '<path d="M7 3h7l5 5v13H7z"/><path d="M14 3v5h5"/><path d="M10 13h6M10 17h6"/>',
  inv: '<path d="M6 3h12v18l-3-2-3 2-3-2-3 2z"/><path d="M9 8h6M9 12h6"/>',
  wallet: '<rect x="3" y="6" width="18" height="14" rx="2"/><path d="M3 10h18"/><path d="M16 15h2"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="M20 20l-4-4"/>',
  eye: '<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
  key: '<circle cx="8" cy="14" r="4"/><path d="M11 11l9-9"/><path d="M16 4l3 3"/><path d="M13 7l3 3"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
  users: '<circle cx="9" cy="8" r="3.5"/><path d="M2 20a7 7 0 0 1 14 0"/><circle cx="17" cy="9" r="3"/><path d="M16 15.5a6 6 0 0 1 6 4.5"/>',
  ban: '<circle cx="12" cy="12" r="9"/><path d="M6 6l12 12"/>',
  check: '<path d="M5 12l5 5L20 7"/>'
};
const icon = (name, cls = '') => `<svg class="ico ${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name]}</svg>`;

const docsView = { tab: '', region: '', sort: 'date', dir: -1 };
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const niceDate = iso => { if (!iso) return ''; const [y, m, d] = iso.split('-'); return `${d} ${MONTHS[+m - 1]} ${y}`; };
const sumBy = (list, fn) => list.reduce((o, d) => { const [c, v] = fn(d); o[c] = (o[c] || 0) + v; return o; }, {});

function moneyLines(obj) {
  const entries = Object.entries(obj).filter(([, v]) => v);
  if (!entries.length) {
    const br = docsView.region || REGION || S.lastBranch || 'UAE';
    const c = SB(br).branches[br].currency;
    return `<div class="stat-v">${c} 0.00</div>`;
  }
  return entries.map(([c, v], i) => `<div class="stat-v${i ? ' sec' : ''}">${c} ${fmtMoney(v, c, false)}${Number.isInteger(round2(v)) ? '.00' : ''}</div>`).join('');
}

const inRegion = d => !docsView.region || d.branch === docsView.region;

function filteredDocs() {
  const q = $('#docSearch').value.trim().toLowerCase();
  const fs = $('#docStatus').value;
  const key = {
    number: d => d.number || '',
    customer: d => (d.customer.company || '').toLowerCase(),
    date: d => (d.date || '') + (d.updatedAt || ''),
    amount: d => docTotals(d).total,
    status: d => d.status || ''
  }[docsView.sort];
  return docs
    .filter(d => inRegion(d) && (!docsView.tab || d.type === docsView.tab) && (!fs || d.status === fs))
    .filter(d => !q || [d.number, d.customer.company, d.customer.contact, d.customer.city, d.customer.mobile, d.fromQuotation]
      .some(v => String(v || '').toLowerCase().includes(q)))
    .sort((a, b) => { const x = key(a), y = key(b); return (x < y ? -1 : x > y ? 1 : 0) * docsView.dir; });
}

function renderRegionTabs() {
  const el = $('#regionTabs');
  const n = r => docs.filter(d => !r || d.branch === r).length;
  const tab = (r, label) => `<button type="button" data-region="${r}" class="${docsView.region === r ? 'on' : ''}">${label} <span>${n(r)}</span></button>`;
  el.innerHTML = (REGION ? '' : tab('', 'All')) + tab('UAE', '🇦🇪 UAE · Dubai') + tab('IN', '🇮🇳 India');
  const other = REGION && docsView.region && docsView.region !== REGION && !isAdmin();
  $('#regionNote').textContent = other ? `You are viewing the ${regionName(docsView.region)} team's documents. They open as view only.` : '';
}

function renderStats() {
  const scoped = docs.filter(inRegion);
  const quotes = scoped.filter(d => d.type === 'quotation');
  const invs = scoped.filter(d => d.type === 'invoice' && d.status !== 'Cancelled');
  const open = invs.filter(d => d.status !== 'Paid');
  const paid = invs.filter(d => d.status === 'Paid');
  const accepted = quotes.filter(d => d.status === 'Accepted').length;
  $('#docStats').innerHTML = `
    <div class="stat">
      <div class="stat-ic blue">${icon('doc')}</div>
      <div><div class="stat-l">Quotations</div><div class="stat-v">${quotes.length}</div>
      <div class="stat-s">${accepted} accepted · ${quotes.filter(d => d.status === 'Sent').length} sent</div></div>
    </div>
    <div class="stat">
      <div class="stat-ic orange">${icon('inv')}</div>
      <div><div class="stat-l">Invoices</div><div class="stat-v">${scoped.filter(d => d.type === 'invoice').length}</div>
      <div class="stat-s">${paid.length} paid · ${open.length} awaiting payment</div></div>
    </div>
    <div class="stat">
      <div class="stat-ic green">${icon('wallet')}</div>
      <div><div class="stat-l">Total invoiced</div>${moneyLines(sumBy(invs, d => [d.currency, docTotals(d).total]))}
      <div class="stat-s">Excludes cancelled invoices</div></div>
    </div>
    <div class="stat warn">
      <div class="stat-ic red">${icon('clock')}</div>
      <div><div class="stat-l">Outstanding</div>${moneyLines(sumBy(open, d => [d.currency, docTotals(d).balance]))}
      <div class="stat-s">Invoices not marked Paid</div></div>
    </div>`;
}

function renderDocs() {
  renderRegionTabs();
  renderStats();
  const scoped = docs.filter(inRegion);
  const counts = { '': scoped.length, quotation: scoped.filter(d => d.type === 'quotation').length, invoice: scoped.filter(d => d.type === 'invoice').length };
  $$('#docTabs button').forEach(b => {
    b.classList.toggle('on', b.dataset.t === docsView.tab);
    b.querySelector('span').textContent = counts[b.dataset.t];
  });
  const list = filteredDocs();
  const table = $('#docTable');

  if (!scoped.length) {
    table.innerHTML = '';
    $('#docFoot').innerHTML = '';
    $('#docEmpty').innerHTML = `
      <div class="empty-ic">${icon('doc')}</div>
      <h3>No documents yet${docsView.region ? ` in the ${regionName(docsView.region)} section` : ''}</h3>
      <p>Every document saved by the team appears here, ready to reopen, download as PDF, or convert.</p>
      ${!docsView.region || canWriteRegion(docsView.region) ? `<div class="empty-actions">
        <button class="btn" data-new="quotation">+ New Quotation</button>
        <button class="btn primary" data-new="invoice">+ New Invoice</button>
      </div>` : ''}`;
    $('#docEmpty').hidden = false;
    return;
  }
  if (!list.length) {
    table.innerHTML = '';
    $('#docFoot').innerHTML = '';
    $('#docEmpty').innerHTML = `
      <div class="empty-ic">${icon('search')}</div>
      <h3>No matching documents</h3>
      <p>Nothing matches the current search or filters.</p>
      <div class="empty-actions"><button class="btn" data-clear>Clear filters</button></div>`;
    $('#docEmpty').hidden = false;
    return;
  }
  $('#docEmpty').hidden = true;

  const th = (key, label, cls = '') => {
    const on = docsView.sort === key;
    return `<th class="sortable ${cls}${on ? ' on' : ''}" data-sort="${key}">${label}<span class="arrow">${on ? (docsView.dir > 0 ? '▲' : '▼') : '↕'}</span></th>`;
  };
  const statusSel = d => `<select class="status-sel s-${esc(d.status).replace(/\s+/g, '-')}" data-status aria-label="Status"${canEdit(d) ? '' : ' disabled'}>
      ${STATUSES[d.type].map(st => opt(st, st, d.status)).join('')}</select>`;
  const act = (a, ic, label, cls = '') => `<button class="icon-act ${cls}" data-act="${a}" title="${label}" aria-label="${label}">${icon(ic)}</button>`;

  table.innerHTML = `
    <thead><tr>
      ${th('number', 'Document')}${th('customer', 'Customer')}${th('date', 'Date')}<th>Branch</th>
      ${th('amount', 'Amount', 'num')}${th('status', 'Status')}<th class="act-col"><span class="sr">Actions</span></th>
    </tr></thead>
    <tbody>${list.map(d => {
      const t = docTotals(d);
      const sub = [d.customer.city, d.customer.mobile].filter(Boolean).map(esc).join(' · ');
      const editable = canEdit(d);
      return `
      <tr data-id="${d.id}" tabindex="0">
        <td>
          <div class="cell-main"><span class="type-dot ${d.type}"></span>${esc(d.number) || '<i class="muted">No number</i>'}</div>
          <div class="cell-sub">${d.type === 'invoice' ? 'Invoice' : 'Quotation'}${d.fromQuotation ? ` · from ${esc(d.fromQuotation)}` : ''}</div>
        </td>
        <td>
          <div class="cell-main">${esc(d.customer.company) || '<i class="muted">No company name</i>'}</div>
          <div class="cell-sub">${sub || '&nbsp;'}</div>
        </td>
        <td class="nowrap">${esc(niceDate(d.date))}</td>
        <td><span class="chip">${d.branch === 'IN' ? 'India' : 'UAE'}</span></td>
        <td class="num">
          <div class="cell-main">${fmtMoney(t.total, d.currency, false)}${Number.isInteger(t.total) ? '.00' : ''} <small>${esc(d.currency)}</small></div>
          ${t.adv && d.type === 'invoice' ? `<div class="cell-sub">Balance ${fmtMoney(t.balance, d.currency, false)}</div>` : ''}
        </td>
        <td>${statusSel(d)}</td>
        <td class="act-col"><div class="acts">${editable ? `
          ${act('open', 'edit', 'Open & edit')}
          ${act('pdf', 'pdf', 'Download PDF')}
          ${act('dup', 'copy', 'Duplicate')}
          ${d.type === 'quotation' ? act('convert', 'convert', 'Convert to invoice') : '<span class="icon-gap"></span>'}
          ${act('del', 'trash', 'Delete', 'danger')}` : `
          ${act('open', 'eye', 'View (other team)')}
          ${act('pdf', 'pdf', 'Download PDF')}
          <span class="icon-gap"></span><span class="icon-gap"></span><span class="icon-gap"></span>`}
        </div></td>
      </tr>`;
    }).join('')}</tbody>`;

  const totals = sumBy(list, d => [d.currency, docTotals(d).total]);
  $('#docFoot').innerHTML = `<span>Showing <b>${list.length}</b> of ${scoped.length} document${scoped.length === 1 ? '' : 's'}</span>
    <span>Total of listed: ${Object.entries(totals).map(([c, v]) => `<b>${c} ${fmtMoney(v, c, false)}</b>`).join(' · ')}</span>`;
}

function copyAsNew(src, type) {
  const d = clone(src);
  Object.assign(d, {
    id: uid(), type, autoNumber: true, numberAssigned: false, number: '',
    date: todayISO(), status: STATUSES[type][0], createdAt: undefined, updatedAt: undefined
  });
  if (type !== src.type) {
    Object.assign(d, {
      terms: [...S.terms[type]],
      showHardware: type === 'quotation', showVersion: type === 'invoice',
      showAcceptance: type === 'invoice', termsNewPage: type === 'invoice',
      showWords: type === 'invoice',
      fromQuotation: src.number
    });
  }
  const saved = doc; doc = d; refreshAutoNumber(); doc = saved;
  return d;
}

function exportCsv() {
  const list = filteredDocs();
  if (!list.length) { toast('Nothing to export', true); return; }
  const cols = ['Number', 'Type', 'Date', 'Branch', 'Company', 'Contact', 'City', 'Country', 'Mobile', 'Email',
    'Currency', 'Sub Total', 'Discount', 'Tax', 'Total', 'Advance', 'Balance', 'Status', 'From Quotation'];
  const cell = v => { const s = String(v ?? ''); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  const rows = list.map(d => {
    const t = docTotals(d), c = d.customer;
    return [d.number, d.type === 'invoice' ? 'Invoice' : 'Quotation', fmtDate(d.date), d.branch === 'IN' ? 'India' : 'UAE',
      c.company, c.contact, c.city, c.country, c.mobile, c.email, d.currency,
      t.sub, t.disc, t.tax, t.total, t.adv, t.balance, d.status, d.fromQuotation || ''].map(cell).join(',');
  });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob(['﻿' + [cols.join(','), ...rows].join('\r\n')], { type: 'text/csv;charset=utf-8' }));
  a.download = `DataCare-documents-${todayISO()}.csv`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  toast(`Exported ${list.length} document${list.length === 1 ? '' : 's'}`);
}

function bindDocs() {
  ['#docSearch', '#docStatus'].forEach(s => $(s).addEventListener('input', renderDocs));
  $('#regionTabs').addEventListener('click', e => {
    const b = e.target.closest('button[data-region]');
    if (b) { docsView.region = b.dataset.region; renderDocs(); }
  });
  $('#docStatus').innerHTML = '<option value="">All statuses</option>' +
    [...new Set([...STATUSES.quotation, ...STATUSES.invoice])].map(st => opt(st, st, '')).join('');
  $('#docTabs').addEventListener('click', e => {
    const b = e.target.closest('button[data-t]');
    if (b) { docsView.tab = b.dataset.t; renderDocs(); }
  });
  $('#csvBtn').addEventListener('click', exportCsv);
  const view = $('#view-docs');

  view.addEventListener('click', async e => {
    if (e.target.closest('[data-clear]')) {
      $('#docSearch').value = ''; $('#docStatus').value = ''; docsView.tab = ''; docsView.region = REGION || '';
      renderDocs(); return;
    }
    const nb = e.target.closest('[data-new]');
    if (nb) { if (await confirmDiscard()) openDoc(newDoc(nb.dataset.new)); return; }
    const sortTh = e.target.closest('th[data-sort]');
    if (sortTh) {
      const k = sortTh.dataset.sort;
      docsView.dir = docsView.sort === k ? -docsView.dir : (k === 'date' || k === 'amount' ? -1 : 1);
      docsView.sort = k;
      renderDocs(); return;
    }
    const row = e.target.closest('tr[data-id]');
    if (!row || e.target.closest('select')) return;
    const d = docs.find(x => x.id === row.dataset.id);
    if (!d) return;
    const b = e.target.closest('[data-act]');
    const actName = b ? b.dataset.act : 'open';   // clicking the row opens it
    if (!canEdit(d) && !['open', 'pdf'].includes(actName)) return;

    if (actName === 'del') {
      const ok = await ask({
        title: `Delete ${d.type} ${d.number}?`,
        message: `${d.customer.company || 'This document'} will be permanently removed${API.online ? ' from the database' : ''}. This cannot be undone.`,
        ok: 'Delete', danger: true
      });
      if (!ok) return;
      docs = docs.filter(x => x.id !== d.id);
      Store.set('dc_docs', docs);
      if (API.online) API.deleteDoc(d.id).catch(() => toast('Could not delete from the database – will retry automatically.', true));
      if (doc.id === d.id) { dirty = true; persistDraft(); }
      renderDocs();
      toast(`Deleted ${d.number}`);
      return;
    }
    if (actName === 'pdf') {
      b.disabled = true; b.classList.add('busy');
      await exportPdf(clone(d));
      b.disabled = false; b.classList.remove('busy');
      return;
    }
    if (!(await confirmDiscard())) return;
    if (actName === 'open') openDoc(clone(d));
    else if (actName === 'dup') { openDoc(copyAsNew(d, d.type), true); toast('Copy created – review and Save'); }
    else if (actName === 'convert') { openDoc(copyAsNew(d, 'invoice'), true); toast(`Invoice created from quotation ${d.number} – review and Save`); }
  });

  view.addEventListener('keydown', e => {
    if (e.key === 'Enter' && e.target.matches('tr[data-id]')) e.target.click();
  });

  view.addEventListener('change', e => {
    const sel = e.target.closest('select[data-status]');
    if (!sel) return;
    const id = sel.closest('tr').dataset.id;
    const i = docs.findIndex(x => x.id === id);
    if (i < 0 || !canEdit(docs[i])) return;
    docs[i].status = sel.value;
    docs[i].updatedAt = new Date().toISOString();
    if (!Store.set('dc_docs', docs) && !API.online) { toast('Could not save – browser storage is full or blocked.', true); return; }
    remotePutDoc(docs[i]);
    if (doc.id === id) { doc.status = sel.value; persistDraft(); }
    toast(`${docs[i].number} marked ${sel.value}`);
    renderDocs();
  });
}

/* ---------------- confirm dialog ---------------- */
function ask({ title, message, ok = 'OK', cancel = 'Cancel', danger = false }) {
  const dlg = $('#dlg');
  $('#dlgTitle').textContent = title;
  $('#dlgMsg').textContent = message;
  const okBtn = $('#dlgOk');
  okBtn.textContent = ok;
  okBtn.className = 'btn ' + (danger ? 'danger-solid' : 'primary');
  $('#dlgCancel').textContent = cancel;
  dlg.returnValue = '';
  return new Promise(resolve => {
    dlg.addEventListener('close', () => resolve(dlg.returnValue === 'ok'), { once: true });
    dlg.showModal();
    okBtn.focus();
  });
}

/* ---------------- settings ---------------- */
const SETTINGS_SECTIONS = [
  ['company', 'Company'], ['branding', 'Branding'], ['branches', 'Branches'], ['defaults', 'Document defaults'],
  ['numbering', 'Numbering'], ['pricelist', 'Price list'], ['text', 'Default text'], ['backup', 'Backup & data']
];
const SICON = {
  company: '<path d="M4 21V5a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v16"/><path d="M16 9h2a2 2 0 0 1 2 2v10"/><path d="M8 7h4M8 11h4M8 15h4M2 21h20"/>',
  branding: '<circle cx="12" cy="12" r="9"/><circle cx="8.5" cy="10" r="1.2" fill="currentColor"/><circle cx="12" cy="7.5" r="1.2" fill="currentColor"/><circle cx="15.5" cy="10" r="1.2" fill="currentColor"/><path d="M12 21a2.5 2.5 0 0 0 0-5h-1.5a1.5 1.5 0 0 1 0-3H14a5 5 0 0 0 5-5"/>',
  branches: '<path d="M12 21s-6-5.3-6-10a6 6 0 0 1 12 0c0 4.7-6 10-6 10z"/><circle cx="12" cy="11" r="2"/>',
  defaults: '<path d="M4 6h16M4 12h10M4 18h7"/>',
  numbering: '<path d="M9 4L7 20M17 4l-2 16M4 9h16M3 15h16"/>',
  pricelist: '<path d="M20 12l-8 8-8-8V4h8z"/><circle cx="8.5" cy="8.5" r="1.5"/>',
  text: '<path d="M4 6h16M4 10h16M4 14h10M4 18h6"/>',
  backup: '<path d="M12 3v12"/><path d="M7 10l5 5 5-5"/><path d="M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2"/>'
};
const sicon = k => `<svg class="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${SICON[k]}</svg>`;

function storageUsage() {
  let bytes = 0;
  try { for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); bytes += (k.length + (localStorage.getItem(k) || '').length) * 2; } }
  catch (e) { return null; }
  return bytes;
}

function numberingPreview(type) {
  const ex = br => formatNumber(S.numbering[type] || '', br, todayISO(), Number(S.counters[`${type}-${br}`]) || 1, Number(S.numbering.pad) || 1);
  if (REGION) return `<b>${esc(ex(REGION))}</b>`;
  return `UAE: <b>${esc(ex('UAE'))}</b> &nbsp;·&nbsp; India: <b>${esc(ex('IN'))}</b>`;
}

function presetRowsHTML() {
  return S.presets.map((p, i) => `
    <tr>
      <td><input data-preset="${i}" data-k="desc" value="${esc(p.desc)}" placeholder="Description"></td>
      <td><input data-preset="${i}" data-k="AED" type="number" step="any" min="0" value="${p.AED ?? ''}" placeholder="0"></td>
      <td><input data-preset="${i}" data-k="INR" type="number" step="any" min="0" value="${p.INR ?? ''}" placeholder="0"></td>
      <td><button type="button" class="icon-act danger" data-delpreset="${i}" title="Remove item" aria-label="Remove item">${icon('trash')}</button></td>
    </tr>`).join('') || `<tr><td colspan="4" class="muted center">No items yet – add your first price-list item.</td></tr>`;
}

function settingsHTML() {
  const field = (label, inner, hint = '') => `<label class="f">${label}${inner}${hint ? `<small>${hint}</small>` : ''}</label>`;
  const inp = (path, extra = '') => `<input data-s="${path}" ${extra}>`;
  const sect = (id, title, desc, body) => `
    <section class="card sect" id="sect-${id}">
      <header class="sect-head"><div class="sect-ic">${sicon(id)}</div><div><h3>${title}</h3><p>${desc}</p></div></header>
      <div class="sect-body">${body}</div>
    </section>`;
  const imgSlot = (key, title, desc, tall) => `
    <div class="img-card">
      <div class="img-prev${tall ? ' tall' : ''}">${S[key] ? `<img src="${S[key]}" alt="">` : `<span class="ph">No image</span>`}</div>
      <div class="img-meta">
        <b>${title}</b><p>${desc}</p>
        <div class="img-actions">
          <label class="btn sm">${S[key] ? 'Replace' : 'Upload image'}<input type="file" accept="image/*" data-img="${key}" hidden></label>
          ${S[key] ? `<button type="button" class="btn sm danger" data-rmimg="${key}">Remove</button>` : ''}
        </div>
      </div>
    </div>`;
  const branch = (k) => {
    const name = k === 'IN' ? 'India' : 'UAE';
    if (REGION && k !== REGION) return `
      <div class="branch-card">
        <div class="branch-head"><span class="chip">${name}</span><small>Other office – shown on the header next to yours</small></div>
        <div class="grid2">
          ${field('Label on header', inp(`branches.${k}.label`, 'placeholder="e.g. INDIA OFFICE"'))}
          ${field('Phone', inp(`branches.${k}.phone`, 'type="tel"'))}
        </div>
      </div>`;
    return `
      <div class="branch-card">
        <div class="branch-head"><span class="chip">${name}</span><small>${REGION ? 'Your branch – ' : ''}code <code>${k}</code> is used in document numbers</small></div>
        <div class="grid2">
          ${field('Label on header', inp(`branches.${k}.label`, 'placeholder="e.g. UAE OFFICE"'))}
          ${field('Phone', inp(`branches.${k}.phone`, 'type="tel"'))}
          ${field('Address (footer)', inp(`branches.${k}.address`), '', true)}
          ${field('Default currency', `<select data-s="branches.${k}.currency">${Object.keys(CURRENCIES).map(c => opt(c, c, S.branches[k].currency)).join('')}</select>`)}
          ${field('Tax label', inp(`branches.${k}.taxLabel`, 'placeholder="VAT / GST"'))}
          ${field('Tax rate %', inp(`branches.${k}.taxRate`, 'type="number" step="any" min="0"'))}
          ${field(k === 'IN' ? 'GSTIN (optional)' : 'TRN (optional)', inp(`branches.${k}.taxId`), 'Printed in the document footer when filled in')}
        </div>
      </div>`;
  };
  const usage = storageUsage();
  const usagePct = usage == null ? 0 : Math.min(100, Math.round(usage / (5 * 1024 * 1024) * 100));

  return `
    <div class="page-head">
      <div><h2>Settings${REGION ? ` <span class="chip region-chip">${regionName(REGION)} team</span>` : ''}</h2><p class="page-sub">${REGION ? `These settings apply to documents issued by the ${regionName(REGION)} team.` : 'Company details, branding, numbering and default text used on every document.'}</p></div>
      <div class="page-actions"><span class="save-pill" id="savePill">All changes saved</span></div>
    </div>
    <div class="settings-layout">
      <nav class="settings-nav" aria-label="Settings sections">
        ${SETTINGS_SECTIONS.map(([id, t], i) => `<a href="#sect-${id}" data-nav="${id}"${i ? '' : ' class="on"'}>${sicon(id)}<span>${t}</span></a>`).join('')}
      </nav>
      <div class="settings-main">

      ${sect('company', 'Company', 'How your company appears on quotations and invoices.', `
        <div class="grid2">
          ${field('Company name (header)', inp('companyName'), 'Shown large on the header; the last word is highlighted in the accent colour')}
          ${field('Legal name', inp('legalName'), 'Used under the name, in the footer and in signature blocks')}
          ${field('Website', inp('website', 'placeholder="www.example.com"'))}
          ${field('Email', inp('email', 'type="email" placeholder="optional"'))}
          ${field('Document design', `<select data-s="template">${opt('premium', 'Premium (modern)', S.template)}${opt('classic', 'Classic (original layout)', S.template)}</select>`)}
          <label class="f">Heading colour <small class="inl">(classic design)</small>
            <span class="color-field"><input type="color" data-s="accent"><code id="accentHex">${esc(S.accent)}</code></span>
          </label>
        </div>
        <label class="switch"><input type="checkbox" data-s="showFooterLine"><span class="track"></span><span>Show legal name, address and tax number in the page footer</span></label>
      `)}

      ${sect('branding', 'Branding', 'Logo and company stamp printed on documents.', `
        <div class="grid2 tight">
          ${imgSlot('logo', 'Logo', 'Replaces the drawn four-colour mark. PNG with a transparent background works best.', false)}
          ${imgSlot('stamp', 'Company stamp / signature', 'Shown in the signature block when “Show company stamp” is ticked on a document.', true)}
        </div>
        <label class="switch"><input type="checkbox" data-s="logoHasName"><span class="track"></span><span>My logo image already includes the company name (hide the typed name next to it)</span></label>
        <div class="brand-preview">
          <small>Header preview</small>
          <div class="bp-row">${S.logo && S.logoHasName ? `<img class="bp-full" src="${S.logo}" alt="">` : `${brandMark(S, 46)}<div><div class="bp-name">${brandName(S)}</div><div class="bp-legal">${esc(S.legalName)}</div></div>`}</div>
        </div>
      `)}

      ${sect('branches', 'Branches', 'Each document is issued from one branch. The branch sets the currency, tax and which phone number comes first.', `
        <div class="grid2 tight">${branch('UAE')}${branch('IN')}</div>
      `)}

      ${sect('defaults', 'Document defaults', 'Pre-filled on every new document. You can still change them per document.', `
        <div class="grid3">
          ${field('Prepared by', inp('preparedBy'))}
          ${field('AMC %', inp('amcPercent', 'type="number" step="any" min="0"'), 'Replaces {AMC} in the terms')}
          ${field('Software versions', inp('softwareVersions', 'data-csv placeholder="DataCare Next, DataCare Pro"'), 'Comma separated – offered as suggestions')}
        </div>
      `)}

      ${sect('numbering', 'Numbering', 'How quotation and invoice numbers are generated. Numbers are assigned when a document is first saved.', `
        <div class="grid2">
          ${field('Quotation number format', inp('numbering.quotation', 'class="mono"'))}
          ${field('Invoice number format', inp('numbering.invoice', 'class="mono"'))}
        </div>
        <div class="num-preview">
          <div><small>Next quotation</small><span id="prevQ">${numberingPreview('quotation')}</span></div>
          <div><small>Next invoice</small><span id="prevI">${numberingPreview('invoice')}</span></div>
        </div>
        <div class="tokens">
          <span><code>{BR}</code> branch code</span><span><code>{YYYY}</code> / <code>{YY}</code> year</span><span><code>{MM}</code> month</span>
          <span><code>{FY}</code> financial year, e.g. 25-26</span><span><code>{SEQ}</code> running number</span>
        </div>
        <div class="grid3" style="margin-top:14px">
          ${field('Digits in running number', inp('numbering.pad', 'type="number" min="1" max="8"'), '4 → 0001')}
        </div>
        ${REGION ? `<div class="counter-grid two">
          <div></div><div class="cg-h">${regionName(REGION)}</div>
          <div class="cg-l">Next quotation no.</div><div><input data-s="counters.quotation-${REGION}" type="number" min="1"></div>
          <div class="cg-l">Next invoice no.</div><div><input data-s="counters.invoice-${REGION}" type="number" min="1"></div>
        </div>` : `<div class="counter-grid">
          <div></div><div class="cg-h">UAE</div><div class="cg-h">India</div>
          <div class="cg-l">Next quotation no.</div>
          <div><input data-s="counters.quotation-UAE" type="number" min="1"></div><div><input data-s="counters.quotation-IN" type="number" min="1"></div>
          <div class="cg-l">Next invoice no.</div>
          <div><input data-s="counters.invoice-UAE" type="number" min="1"></div><div><input data-s="counters.invoice-IN" type="number" min="1"></div>
        </div>`}
      `)}

      ${sect('pricelist', 'Price list', 'Items offered under “Add from price list” in the editor. The price matching the document’s currency is used.', `
        <div class="table-wrap">
          <table class="edit-table" id="presetTable">
            <thead><tr><th>Description</th><th class="w120">AED price</th><th class="w120">INR price</th><th class="w44"></th></tr></thead>
            <tbody>${presetRowsHTML()}</tbody>
          </table>
        </div>
        <div class="sect-foot"><button type="button" class="btn sm" id="addPreset">+ Add item</button></div>
      `)}

      ${sect('text', 'Default text', 'Copied into every new document, where it can still be edited. One point per line; <code>{AMC}</code> becomes the AMC percentage.', `
        <div class="grid2">
          <label class="f">Quotation terms &amp; conditions<textarea data-s="terms.quotation" data-list rows="12"></textarea>
            <span class="ta-foot"><em data-count="terms.quotation"></em><button type="button" class="btn link sm" data-resetdef="terms.quotation">Restore original</button></span></label>
          <label class="f">Invoice terms &amp; conditions<textarea data-s="terms.invoice" data-list rows="12"></textarea>
            <span class="ta-foot"><em data-count="terms.invoice"></em><button type="button" class="btn link sm" data-resetdef="terms.invoice">Restore original</button></span></label>
        </div>
        <label class="f" style="margin-top:14px">Hardware configuration (quotations)<textarea data-s="hardware" data-list rows="5"></textarea>
          <span class="ta-foot"><em data-count="hardware"></em><button type="button" class="btn link sm" data-resetdef="hardware">Restore original</button></span></label>
      `)}

      ${sect('backup', 'Backup &amp; data', API.online ? 'Documents and settings are stored in your SQL Server database. Backups are still a good habit.' : 'Everything is stored in this browser only. Export a backup regularly and before changing computers.', `
        <div class="backup-row">
          <div class="backup-card">
            <b>Export backup</b><p>Downloads one file with all ${docs.length} document${docs.length === 1 ? '' : 's'} and these settings.</p>
            <button type="button" class="btn primary" id="exportBtn">Export backup</button>
          </div>
          <div class="backup-card">
            <b>Import backup</b><p>Restores a backup file. Replaces the ${REGION ? regionName(REGION) + ' team\'s' : ''} documents and settings.</p>
            <button type="button" class="btn" id="importBtn">Choose file…</button>
          </div>
          <div class="backup-card">
            <b>Where data is stored</b>
            ${API.online
              ? `<p>SQL Server database <b>${esc(API.info.database)}</b>${API.info.server ? ' on ' + esc(API.info.server) : ''}. A copy is kept in this browser for speed.</p>`
              : `<p>This browser only (the database server is not running). ${usage == null ? '' : `${(usage / 1024).toFixed(0)} KB used of about 5 MB.`}</p>
                 <div class="meter"><span style="width:${usagePct}%"${usagePct > 80 ? ' class="hot"' : ''}></span></div>`}
          </div>
        </div>
        <div class="danger-zone">
          <div><b>Reset settings to defaults</b><p>Company details, numbering formats, terms, logo and stamp go back to the originals. Saved documents and number counters are kept.</p></div>
          <button type="button" class="btn danger" id="resetSettings">Reset settings</button>
        </div>
      `)}

      </div>
    </div>`;
}

function updateCounts(p) {
  $$('[data-count]', p).forEach(el => {
    const n = (getPath(S, el.dataset.count) || []).length;
    el.textContent = `${n} point${n === 1 ? '' : 's'}`;
  });
}

let settingsObserver;
function loadSettingsForm() {
  const p = $('#settingsPanel');
  const scroll = p.scrollTop;
  p.innerHTML = settingsHTML();
  $$('[data-s]', p).forEach(el => {
    const v = getPath(S, el.dataset.s);
    if (el.hasAttribute('data-csv')) el.value = (v || []).join(', ');
    else writeVal(el, v);
  });
  updateCounts(p);
  p.scrollTop = scroll;

  // highlight the section in view
  if (settingsObserver) settingsObserver.disconnect();
  settingsObserver = new IntersectionObserver(entries => {
    const vis = entries.filter(e => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
    if (!vis) return;
    const id = vis.target.id.replace('sect-', '');
    $$('.settings-nav a', p).forEach(a => a.classList.toggle('on', a.dataset.nav === id));
  }, { root: p, rootMargin: '-10% 0px -70% 0px', threshold: 0 });
  $$('.sect', p).forEach(sec => settingsObserver.observe(sec));
}

let settingsTimer;
function settingsChanged(msg) {
  const pill = $('#savePill');
  if (pill) { pill.textContent = 'Saving…'; pill.classList.add('saving'); }
  clearTimeout(settingsTimer);
  settingsTimer = setTimeout(() => {
    saveSettings();
    if (pill) { pill.textContent = 'All changes saved'; pill.classList.remove('saving'); }
    if (msg) toast(msg);
  }, 450);
}

function bindSettings() {
  const p = $('#settingsPanel');
  p.addEventListener('input', e => {
    const el = e.target;
    if (el.dataset.preset !== undefined) {
      const it = S.presets[+el.dataset.preset];
      it[el.dataset.k] = el.dataset.k === 'desc' ? el.value : (parseFloat(el.value) || 0);
      settingsChanged(); return;
    }
    if (!el.dataset.s) return;
    const v = el.hasAttribute('data-csv') ? el.value.split(',').map(s => s.trim()).filter(Boolean) : readVal(el);
    setPath(S, el.dataset.s, v);
    const k = el.dataset.s;
    if (k === 'accent') $('#accentHex').textContent = v;
    if (k.startsWith('numbering.') || k.startsWith('counters.')) {
      $('#prevQ').innerHTML = numberingPreview('quotation');
      $('#prevI').innerHTML = numberingPreview('invoice');
    }
    if (el.hasAttribute('data-list')) updateCounts(p);
    if (k === 'template') $('#tplSel').value = v;
    settingsChanged();
  });
  p.addEventListener('change', async e => {
    const key = e.target.dataset.img;
    if (!key || !e.target.files[0]) return;
    try {
      S[key] = await readImage(e.target.files[0], key === 'logo' ? 600 : 500);
      saveSettings(); loadSettingsForm(); toast('Image saved');
    } catch (err) { toast('Could not read that image', true); }
  });
  p.addEventListener('click', async e => {
    const nav = e.target.closest('.settings-nav a');
    if (nav) {
      e.preventDefault();
      $(nav.getAttribute('href')).scrollIntoView({ behavior: 'smooth', block: 'start' });
      return;
    }
    const b = e.target.closest('button');
    if (!b) return;
    if (b.dataset.rmimg) {
      S[b.dataset.rmimg] = null; if (b.dataset.rmimg === 'logo') S.logoHasName = false;
      saveSettings(); loadSettingsForm(); toast('Image removed');
    } else if (b.dataset.delpreset !== undefined) {
      S.presets.splice(+b.dataset.delpreset, 1);
      $('#presetTable tbody').innerHTML = presetRowsHTML();
      settingsChanged();
    } else if (b.id === 'addPreset') {
      S.presets.push({ desc: '', AED: 0, INR: 0 });
      $('#presetTable tbody').innerHTML = presetRowsHTML();
      $$('#presetTable tbody input').slice(-3)[0].focus();
      settingsChanged();
    } else if (b.dataset.resetdef) {
      const k = b.dataset.resetdef;
      setPath(S, k, clone(getPath(DEFAULT_SETTINGS, k)));
      writeVal($(`[data-s="${k}"]`, p), getPath(S, k));
      updateCounts(p);
      settingsChanged('Restored original text');
    }
    else if (b.id === 'exportBtn') exportBackup();
    else if (b.id === 'importBtn') $('#importFile').click();
    else if (b.id === 'resetSettings') {
      if (!(await ask({ title: 'Reset settings?', message: 'Company details, numbering formats, terms, logo and stamp go back to defaults. Saved documents and number counters are kept.', ok: 'Reset', danger: true }))) return;
      const counters = S.counters;
      setS(mergeDefaults(DEFAULT_SETTINGS, { counters, lastBranch: REGION || S.lastBranch }));
      saveSettings(); loadSettingsForm(); toast('Settings reset (numbering counters kept)');
    }
  });
}

function readImage(file, maxW) {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onerror = reject;
    fr.onload = () => {
      const img = new Image();
      img.onerror = reject;
      img.onload = () => {
        const sc = Math.min(1, maxW / img.width);
        const c = document.createElement('canvas');
        c.width = Math.round(img.width * sc); c.height = Math.round(img.height * sc);
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
        resolve(c.toDataURL('image/png'));
      };
      img.src = fr.result;
    };
    fr.readAsDataURL(file);
  });
}

function exportBackup() {
  const data = { app: 'datacare-invoice-quotation', version: 2, exportedAt: new Date().toISOString(), region: REGION, settings: S, docs };
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
  a.download = `DataCare-backup-${todayISO()}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

function importBackup(file) {
  const fr = new FileReader();
  fr.onload = async () => {
    try {
      const data = JSON.parse(fr.result);
      if (!Array.isArray(data.docs) || !data.settings) throw new Error('not a backup file');
      const incoming = REGION ? data.docs.filter(d => d.branch === REGION) : data.docs;
      if (!(await ask({ title: 'Import backup?', message: `${incoming.length} document${incoming.length === 1 ? '' : 's'} and the settings in this file will replace the current ${REGION ? regionName(REGION) + ' team ' : ''}data.`, ok: 'Import' }))) return;
      const nextS = mergeDefaults(DEFAULT_SETTINGS, data.settings);
      if (REGION) nextS.lastBranch = REGION;
      if (API.online) {
        try { await API.importRegion(REGION, clone(nextS), incoming); }
        catch (err) { toast('The database rejected the import: ' + (err.body && err.body.detail || err.message), true); return; }
      }
      setS(nextS);
      docs = [...docs.filter(d => REGION && d.branch !== REGION), ...incoming];
      saveSettings(); Store.set('dc_docs', docs);
      loadSettingsForm(); loadForm(); renderPreview(); renderDocs();
      toast('Backup imported');
    } catch (err) { toast('Import failed: ' + err.message, true); }
  };
  fr.readAsText(file);
}

/* ---------------- shell ---------------- */
function showView(v) {
  $$('.tb-nav button').forEach(b => b.classList.toggle('active', b.dataset.view === v));
  $$('.view').forEach(s => s.classList.toggle('active', s.id === 'view-' + v));
  if (v === 'docs') renderDocs();
  if (v === 'settings') loadSettingsForm();
  if (v === 'team') renderTeam();
  $$('#userDropdown').forEach(m => { m.hidden = true; });
  if (v === 'editor') { refreshAutoNumber(); loadForm(); renderPreview(); $('#tplSel').value = S.template; }
}

let toastTimer;
function toast(msg, err = false) {
  const t = $('#toast');
  t.textContent = msg;
  t.className = 'show' + (err ? ' err' : '');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.className = ''; }, err ? 5000 : 2200);
}

/* ---------------- sign in / users ---------------- */
function showLogin(message, { unreachable = false } = {}) {
  const box = $('#login');
  box.hidden = false;
  const err = $('#loginErr');
  err.hidden = !message; err.textContent = message || '';
  $('#loginRetry').hidden = !unreachable;
  $('#loginBtn').disabled = unreachable;
  $$('#loginForm input').forEach(i => { i.disabled = unreachable; });
  $$('.login-seg button').forEach(b => b.classList.toggle('on', b.dataset.v === (Store.get('dc_last_region') || 'UAE')));
  updateLoginPrefix();
  setTimeout(() => $('#loginForm [name=username]').focus(), 50);
}

const DIAL_CODE = { UAE: '+971', IN: '+91' };
function updateLoginPrefix() {
  const region = ($('.login-seg button.on') || {}).dataset?.v || 'UAE';
  $('#pwPrefix').textContent = DIAL_CODE[region];
  $('#pwHint').textContent = `Your password is your mobile number after ${DIAL_CODE[region]} (unless you changed it).`;
}

function bindLogin() {
  const form = $('#loginForm');
  $('.login-seg').addEventListener('click', e => {
    const b = e.target.closest('button[data-v]');
    if (b) { $$('.login-seg button').forEach(x => x.classList.toggle('on', x === b)); updateLoginPrefix(); }
  });
  $('#loginRetry').addEventListener('click', () => location.reload());
  $('#pwPeek').addEventListener('click', () => {
    const inp = form.password;
    inp.type = inp.type === 'password' ? 'text' : 'password';
    inp.focus();
  });
  form.addEventListener('submit', async e => {
    e.preventDefault();
    const region = $('.login-seg button.on').dataset.v;
    const username = form.username.value.trim(), password = form.password.value;
    const btn = $('#loginBtn'), err = $('#loginErr');
    btn.disabled = true; btn.textContent = 'Signing in…'; err.hidden = true;
    try {
      const user = await API.login(region, username, password);
      Store.set('dc_last_region', region);
      form.password.value = '';
      $('#login').hidden = true;
      await afterLogin(user);
      startApp();
    } catch (ex) {
      err.hidden = false;
      err.textContent = ex.message || 'Could not sign in.';
      if (ex.body && ex.body.region) { $$('.login-seg button').forEach(x => x.classList.toggle('on', x.dataset.v === ex.body.region)); updateLoginPrefix(); }
    } finally {
      btn.disabled = false; btn.textContent = 'Sign in';
    }
  });
}

async function afterLogin(user) {
  USER = user;
  REGION = user.region;
  docsView.region = REGION;
  API.info = await API.health().catch(() => API.info);
  setDbStatus(API._queue().length ? 'queued' : 'db');
  await loadFromServer();
  renderUserChip();
}

function renderUserChip() {
  const menu = $('#userMenu');
  if (!USER) { menu.hidden = true; $('#navTeam').hidden = true; $('#regionSwitch').hidden = true; return; }
  menu.hidden = false;
  $('#userAvatar').textContent = USER.displayName.split(/\s+/).map(w => w[0]).join('').slice(0, 2).toUpperCase();
  $('#userName').textContent = USER.displayName;
  $('#userRegion').textContent = `${regionName(REGION)} team${isAdmin() ? ' · Administrator' : ''}`;
  $('#navTeam').hidden = !isAdmin();
  const sw = $('#regionSwitch');
  sw.hidden = !isAdmin();
  $$('button', sw).forEach(b => b.classList.toggle('on', b.dataset.region === REGION));
}

/** Administrators can work in either team for the current session. */
async function switchRegion(r) {
  if (r === REGION || !isAdmin()) return;
  if (!(await confirmDiscard())) return;
  try { await API.setRegion(r); } catch (err) { toast(err.message, true); return; }
  REGION = r;
  S = ALL_S[r];
  docsView.region = r;
  doc = newDoc('quotation'); dirty = false; readOnly = false; persistDraft();
  renderUserChip();
  $('#tplSel').value = S.template;
  const current = $$('.view').find(v => v.classList.contains('active')).id.replace('view-', '');
  showView(current);
  toast(`Now working in the ${regionName(r)} team`);
}

function bindUserMenu() {
  const chip = $('#userChip'), dd = $('#userDropdown');
  chip.addEventListener('click', () => { dd.hidden = !dd.hidden; chip.setAttribute('aria-expanded', String(!dd.hidden)); });
  document.addEventListener('click', e => { if (!e.target.closest('#userMenu')) dd.hidden = true; });
  $('#miLogout').addEventListener('click', async () => {
    dd.hidden = true;
    if (!(await confirmDiscard())) return;
    try { await API.logout(); } catch (e) { /* session may already be gone */ }
    Store.set('dc_current', null);
    location.reload();
  });
  $('#miPassword').addEventListener('click', () => {
    dd.hidden = true;
    formDialog({
      title: 'Change password',
      fields: [
        { name: 'current', label: 'Current password', type: 'password', full: true, required: true },
        { name: 'next', label: 'New password', type: 'password', required: true, minlength: 6 },
        { name: 'confirm', label: 'Repeat new password', type: 'password', required: true }
      ],
      ok: 'Change password',
      submit: async v => {
        if (v.next !== v.confirm) throw new Error('The new passwords do not match.');
        await API.changePassword(v.current, v.next);
        toast('Password changed');
      }
    });
  });
  $('#regionSwitch').addEventListener('click', e => {
    const b = e.target.closest('button[data-region]');
    if (b) switchRegion(b.dataset.region);
  });
}

/* ----- generic form dialog: resolves with the values, or null when cancelled ----- */
function formDialog({ title, fields, ok = 'Save', submit }) {
  const dlg = $('#formDlg'), body = $('#formDlgBody'), err = $('#formDlgErr'), form = $('#formDlgForm');
  dlg.classList.toggle('wide', fields.length > 3);
  $('#formDlgTitle').textContent = title;
  $('#formDlgOk').textContent = ok;
  body.innerHTML = fields.map(f => `<label class="f${f.full ? ' full' : ''}">${esc(f.label)}${
    f.type === 'select'
      ? `<select name="${f.name}">${f.options.map(([v, l]) => opt(v, l, f.value)).join('')}</select>`
      : `<input name="${f.name}" type="${f.type || 'text'}" value="${esc(f.value ?? '')}"${f.required ? ' required' : ''}${f.minlength ? ` minlength="${f.minlength}"` : ''}${f.placeholder ? ` placeholder="${esc(f.placeholder)}"` : ''} autocomplete="${f.autocomplete || 'off'}">`
  }${f.hint ? `<small>${esc(f.hint)}</small>` : ''}</label>`).join('');
  err.hidden = true;
  return new Promise(resolve => {
    const onSubmit = async e => {
      e.preventDefault();
      const values = Object.fromEntries(fields.map(f => [f.name, form.elements[f.name].value]));
      $('#formDlgOk').disabled = true;
      try {
        if (submit) await submit(values);
        cleanup(); dlg.close(); resolve(values);
      } catch (ex) {
        err.hidden = false; err.textContent = ex.message || 'Something went wrong.';
      } finally { $('#formDlgOk').disabled = false; }
    };
    const onCancel = () => { cleanup(); dlg.close(); resolve(null); };
    const cleanup = () => { form.removeEventListener('submit', onSubmit); $('#formDlgCancel').removeEventListener('click', onCancel); dlg.removeEventListener('cancel', onCancelEvt); };
    const onCancelEvt = e => { e.preventDefault(); onCancel(); };
    form.addEventListener('submit', onSubmit);
    $('#formDlgCancel').addEventListener('click', onCancel);
    dlg.addEventListener('cancel', onCancelEvt);
    dlg.showModal();
    const first = form.querySelector('input, select'); if (first) first.focus();
  });
}

/* ----- Team page (administrators) ----- */
let teamUsers = [];
async function renderTeam() {
  const p = $('#teamPanel');
  if (!isAdmin()) { p.innerHTML = '<div class="empty-state"><h3>Administrators only</h3></div>'; return; }
  p.innerHTML = `<div class="page-head"><div><h2>Team</h2><p class="page-sub">Loading…</p></div></div>`;
  try { teamUsers = await API.users(); } catch (err) { p.innerHTML = `<div class="empty-state"><h3>Could not load team</h3><p>${esc(err.message)}</p></div>`; return; }
  const fmtWhen = iso => (iso ? niceDate(String(iso).slice(0, 10)) : 'Never');
  const rows = region => teamUsers.filter(u => u.region === region).map(u => `
      <tr data-uid="${u.id}" class="${u.active ? '' : 'inactive'}">
        <td><div class="cell-main"><span class="avatar sm">${esc(u.displayName.split(/\s+/).map(w => w[0]).join('').slice(0, 2).toUpperCase())}</span>${esc(u.displayName)}</div><div class="cell-sub">@${esc(u.username)}</div></td>
        <td>${esc(u.phone) || '<i class="muted">—</i>'}</td>
        <td><span class="role-badge ${u.role}">${u.role === 'admin' ? 'Administrator' : 'Member'}</span></td>
        <td class="nowrap">${fmtWhen(u.lastLoginAt)}</td>
        <td>${u.active ? '<span class="badge s-Paid">Active</span>' : '<span class="badge">Deactivated</span>'}</td>
        <td class="act-col"><div class="acts">
          <button class="icon-act" data-uact="edit" title="Edit">${icon('edit')}</button>
          <button class="icon-act" data-uact="pw" title="Set a new password">${icon('key')}</button>
          ${u.active ? `<button class="icon-act danger" data-uact="off" title="Deactivate (cannot sign in)">${icon('ban')}</button>` : `<button class="icon-act" data-uact="on" title="Re-activate">${icon('check')}</button>`}
        </div></td>
      </tr>`).join('') || `<tr><td colspan="6" class="empty">No members yet – add the ${regionName(region)} team.</td></tr>`;
  const section = region => `
    <div class="card list-card" style="margin-bottom:18px">
      <div class="list-toolbar"><div class="tabs"><button class="on" type="button">${region === 'IN' ? '🇮🇳 India team' : '🇦🇪 UAE · Dubai team'} <span>${teamUsers.filter(u => u.region === region).length}</span></button></div>
        <button class="btn sm" data-adduser="${region}">+ Add member</button></div>
      <div class="table-wrap"><table class="list"><thead><tr><th>Name</th><th>Mobile</th><th>Role</th><th>Last sign-in</th><th>Status</th><th class="act-col"></th></tr></thead>
      <tbody>${rows(region)}</tbody></table></div>
    </div>`;
  p.innerHTML = `
    <div class="page-head">
      <div><h2>Team</h2><p class="page-sub">People who can sign in. Each member belongs to one team; their name and mobile are used as “Prepared by” on their documents.</p></div>
    </div>
    ${section('UAE')}${section('IN')}`;
}

function userFields(u = {}) {
  return [
    { name: 'displayName', label: 'Full name', value: u.displayName, required: true, placeholder: 'e.g. Shreyash Thumar' },
    { name: 'phone', label: 'Mobile (shown on documents)', value: u.phone, type: 'tel', placeholder: '+971 55 …' },
    { name: 'username', label: 'Username', value: u.username, required: true, hint: 'Used to sign in; letters, numbers, dots or dashes' },
    { name: 'region', label: 'Team', type: 'select', value: u.region || 'UAE', options: [['UAE', 'UAE · Dubai'], ['IN', 'India']] },
    { name: 'role', label: 'Role', type: 'select', value: u.role || 'user', options: [['user', 'Member'], ['admin', 'Administrator']] }
  ];
}

function bindTeam() {
  $('#teamPanel').addEventListener('click', async e => {
    const add = e.target.closest('[data-adduser]');
    if (add) {
      const fields = userFields({ region: add.dataset.adduser });
      fields.push({ name: 'password', label: 'Password', type: 'password', required: true, minlength: 6, hint: 'Team convention: their mobile number without the country code (e.g. 7016253749)', autocomplete: 'new-password' });
      const v = await formDialog({ title: 'Add team member', fields, ok: 'Add member', submit: vals => API.createUser(vals) });
      if (v) { toast(`Added ${v.displayName}`); renderTeam(); }
      return;
    }
    const b = e.target.closest('[data-uact]');
    if (!b) return;
    const u = teamUsers.find(x => x.id === Number(b.closest('tr').dataset.uid));
    if (!u) return;
    if (b.dataset.uact === 'edit') {
      const v = await formDialog({ title: `Edit ${u.displayName}`, fields: userFields(u), ok: 'Save changes', submit: vals => API.updateUser(u.id, { ...vals, active: u.active }) });
      if (v) { toast('Member updated'); renderTeam(); }
    } else if (b.dataset.uact === 'pw') {
      const v = await formDialog({ title: `New password for ${u.displayName}`, fields: [{ name: 'password', label: 'New password', type: 'password', required: true, minlength: 6, full: true, autocomplete: 'new-password' }], ok: 'Set password', submit: vals => API.resetPassword(u.id, vals.password) });
      if (v) toast(`Password set for ${u.displayName} – they are signed out everywhere`);
    } else {
      const activate = b.dataset.uact === 'on';
      if (!activate && !(await ask({ title: `Deactivate ${u.displayName}?`, message: 'They will be signed out and unable to sign in until re-activated. Their documents are kept.', ok: 'Deactivate', danger: true }))) return;
      try { await API.updateUser(u.id, { ...u, active: activate }); toast(activate ? 'Member re-activated' : 'Member deactivated'); renderTeam(); }
      catch (err) { toast(err.message, true); }
    }
  });
}

/* ---------------- start-up ---------------- */
let appStarted = false;
function startApp() {
  const draft = Store.get('dc_current');
  if (draft && draft.doc && draft.doc.items && canEdit(draft.doc)) { doc = draft.doc; dirty = !!draft.dirty; }
  else { doc = newDoc('quotation'); dirty = false; }
  readOnly = !canEdit(doc);
  $('#tplSel').value = S.template;
  renderUserChip();
  showView('editor');
  if (!appStarted && document.fonts) document.fonts.ready.then(renderPreview);
  appStarted = true;
}

async function init() {
  API.onStatus = setDbStatus;
  API.onUnauthorized = () => { if (USER) { USER = null; showLogin('Your session has ended – please sign in again.'); } };
  await API.detect();
  setInterval(() => API.flush(), 15000);
  window.addEventListener('online', () => API.flush());

  bindForm();
  bindDocs();
  bindSettings();
  bindTeam();
  bindLogin();
  bindUserMenu();

  $$('.tb-nav button').forEach(b => b.addEventListener('click', () => showView(b.dataset.view)));
  $('#btnNewQ').addEventListener('click', async () => { if (await confirmDiscard()) openDoc(newDoc('quotation')); });
  $('#btnNewI').addEventListener('click', async () => { if (await confirmDiscard()) openDoc(newDoc('invoice')); });
  $('#btnSave').addEventListener('click', () => saveDoc());
  $('#btnPdf').addEventListener('click', downloadPdf);
  $('#btnPrint').addEventListener('click', printDoc);
  $('#zoomSel').addEventListener('input', applyZoom);
  $('#tplSel').addEventListener('input', e => { S.template = e.target.value; saveSettings(); renderPreview(); });
  $('#importFile').addEventListener('change', e => { if (e.target.files[0]) importBackup(e.target.files[0]); e.target.value = ''; });
  window.addEventListener('resize', applyZoom);
  document.addEventListener('keydown', e => {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') { e.preventDefault(); if ($('#view-editor').classList.contains('active') && !readOnly) saveDoc(); }
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'p' && $('#view-editor').classList.contains('active')) { e.preventDefault(); printDoc(); }
  });

  if (API.configured && !API.online) {
    // a separate backend is configured (e.g. frontend on Vercel) but cannot be reached: do not fall back to browser-only mode
    showLogin(`Cannot reach the server at ${window.APP_CONFIG.apiBase}. Check that it is running and reachable over HTTPS, then retry.`, { unreachable: true });
    return;
  }
  if (API.online) {
    const me = await API.me().catch(() => null);
    if (!me) { showLogin(); return; }
    try { await afterLogin(me); }
    catch (err) { showLogin('Could not load your data: ' + err.message); return; }
  }
  startApp();
}

init();
