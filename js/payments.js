'use strict';
/* Payments page.
   What each party (customer firm) owes across its order forms and invoices, the payments recorded against them,
   receipts and WhatsApp reminders. A payment is stored inside the document it was applied to (d.payments[]), so the
   saved-documents list, the printed invoice and this page always agree – and nothing new is needed on the server. */

const RECEIPT_PATTERN = 'RCT-{BR}-{YYYY}-{SEQ}';
const payView = { region: undefined, party: null, filter: 'due', q: '' };

const partyKey = d => String((d.customer || {}).company || '').trim().toLowerCase().replace(/\s+/g, ' ');
const amt = (v, cur) => `${fmtMoney(v, cur, false)}${Number.isInteger(round2(v)) ? '.00' : ''}`;   // 25,000.00
const money = (v, cur) => `${cur} ${amt(v, cur)}`;                                              // INR 25,000.00
const lastPayment = d => ((d.payments || []).length ? d.payments[d.payments.length - 1] : null);
const dayDiff = iso => Math.floor((Date.now() - new Date(iso + 'T00:00:00').getTime()) / 864e5);

/** The invoice an order form was turned into, if any: the order's dues then live on that invoice. */
function invoiceOf(order) {
  return docs.find(x => x.type === 'invoice' && x.status !== 'Cancelled' && (x.fromOrderId === order.id || (x.fromOrder && x.fromOrder === order.number && x.branch === order.branch)));
}
/** Money is owed on order forms and invoices that are not cancelled – except an order that already has its invoice. */
const receivable = d => (d.type === 'order' || d.type === 'invoice') && d.status !== 'Cancelled' && !(d.type === 'order' && invoiceOf(d));

/** total / received / due of one document. An invoice marked Paid by hand counts as settled even without entries. */
function payFigures(d) {
  const T = docTotals(d);
  if (isPaidInvoice(d)) return { total: T.total, received: T.total, due: 0 };
  return { total: T.total, received: T.adv, due: Math.max(0, T.balance) };
}

/** Keeps an invoice's status in step with what has been received, and the printed "payment received" details. */
function applyPaymentStatus(d) {
  const last = lastPayment(d);
  if (last) d.payment = { date: last.date, mode: last.mode, ref: last.ref };
  if (d.type !== 'invoice' || d.status === 'Cancelled') return;
  const T = docTotals(d);
  if (T.total > 0 && T.balance <= 0.004) d.status = 'Paid';
  else if (T.adv > 0) d.status = 'Partially Paid';
  else if (d.status === 'Paid' || d.status === 'Partially Paid') d.status = 'Unpaid';
}

/* ---------------- parties ---------------- */
const inPayRegion = d => !payView.region || d.branch === payView.region;

function partyList(within = inPayRegion) {
  const map = new Map();
  for (const d of docs) {
    if (!within(d) || !(d.type === 'order' || d.type === 'invoice') || d.status === 'Cancelled') continue;
    const key = partyKey(d);
    if (!key) continue;
    let p = map.get(key);
    if (!p) { p = { key, name: '', city: '', mobile: '', branch: d.branch, currency: d.currency, docs: [], invoiced: [], billed: 0, received: 0, due: 0, oldest: null, lastPaid: '', mixed: false }; map.set(key, p); }
    // the newest spelling of the name and the latest contact details win
    if (!p.stamp || (d.updatedAt || '') > p.stamp) { p.stamp = d.updatedAt || ''; p.name = d.customer.company.trim(); p.city = d.customer.city || p.city; p.mobile = d.customer.mobile || p.mobile; }
    if (!receivable(d)) { p.invoiced.push(d); continue; }
    if (d.currency !== p.currency) p.mixed = true;
    p.docs.push(d);
    const f = payFigures(d);
    p.billed = round2(p.billed + f.total); p.received = round2(p.received + f.received); p.due = round2(p.due + f.due);
    if (f.due > 0.004 && (!p.oldest || d.date < p.oldest)) p.oldest = d.date;
    for (const pm of d.payments || []) if (pm.date > p.lastPaid) p.lastPaid = pm.date;
  }
  const out = [...map.values()];
  out.forEach(p => { p.docs.sort((a, b) => a.date.localeCompare(b.date) || (a.createdAt || '').localeCompare(b.createdAt || '')); p.overdue = p.oldest ? dayDiff(p.oldest) : 0; });
  return out.sort((a, b) => (b.due - a.due) || a.name.localeCompare(b.name));
}
const findParty = key => partyList().find(p => p.key === key) || null;
/** The party a document belongs to, within that document's own team. */
const partyOfDoc = d => partyList(x => x.branch === d.branch).find(p => p.key === partyKey(d)) || null;
const partyDocs = p => [...p.docs, ...p.invoiced];

/** Every receipt of a party: one row per receipt number, with the documents it was split across. */
function partyLedger(p) {
  const byReceipt = new Map(); const seen = new Set();
  for (const d of partyDocs(p)) {
    for (const pm of d.payments || []) {
      if (seen.has(pm.id)) continue;   // an order's payments are copied to its invoice – count them once
      seen.add(pm.id);
      let r = byReceipt.get(pm.receipt);
      if (!r) { r = { receipt: pm.receipt, date: pm.date, amount: 0, mode: pm.mode, ref: pm.ref, note: pm.note, by: pm.by, at: pm.at, cur: d.currency, lines: [], partyDueAfter: pm.partyDueAfter }; byReceipt.set(pm.receipt, r); }
      r.amount = round2(r.amount + Number(pm.amount));
      r.lines.push({ doc: d, amount: Number(pm.amount), docBalanceAfter: pm.docBalanceAfter });
    }
  }
  const rows = [...byReceipt.values()];
  // the upfront advance typed on a document (before this page existed, or taken with the order) is part of the story too
  for (const d of p.docs) if (Number(d.advance) > 0 && !(d.type === 'invoice' && d.fromOrderId && docs.some(o => o.id === d.fromOrderId && Number(o.advance) > 0))) {
    rows.push({ receipt: '', date: (d.payment && d.payment.date) || d.date, amount: round2(d.advance), mode: (d.payment && d.payment.mode) || '', ref: (d.payment && d.payment.ref) || '', note: 'Advance entered on the document', by: '', at: d.createdAt || '', cur: d.currency, lines: [{ doc: d, amount: round2(d.advance) }], advance: true });
  }
  return rows.sort((a, b) => (b.date || '').localeCompare(a.date || '') || (b.at || '').localeCompare(a.at || ''));
}

/* ---------------- page ---------------- */
function renderPayments() {
  if (payView.region === undefined) payView.region = REGION || '';
  const view = $('#view-payments');
  if (!view) return;
  const parties = partyList();
  const cur = parties[0] ? parties[0].currency : (SB(payView.region || REGION || 'UAE').branches[payView.region || REGION || 'UAE'] || branchDefaults(payView.region || REGION || 'UAE')).currency;
  const sum = (fn) => round2(parties.reduce((s, p) => s + fn(p), 0));
  const withDue = parties.filter(p => p.due > 0.004);
  const overdueAmt = sum(p => (p.overdue > 30 ? p.due : 0));
  const canRecordHere = !payView.region || canWriteRegion(payView.region);

  $('#payRegionTabs').innerHTML = regionTabsHTML(payView.region, r => docs.filter(d => (!r || d.branch === r) && receivable(d) && payFigures(d).due > 0.004).length);
  $('#payRegionNote').textContent = payView.region && !canRecordHere ? `You are viewing the payments of ${theTeam(payView.region)}. Only that team can record payments.` : '';
  $('#payRecordBtn').hidden = !canRecordHere;
  $('#payStats').innerHTML = `
    <div class="stat"><div class="stat-ic blue">${icon('inv')}</div><div><div class="stat-l">Billed</div><div class="stat-v">${money(sum(p => p.billed), cur)}</div><div class="stat-s">Order forms and invoices, not cancelled</div></div></div>
    <div class="stat"><div class="stat-ic green">${icon('wallet')}</div><div><div class="stat-l">Received</div><div class="stat-v">${money(sum(p => p.received), cur)}</div><div class="stat-s">Advances and recorded payments</div></div></div>
    <div class="stat"><div class="stat-ic orange">${icon('clock')}</div><div><div class="stat-l">Outstanding</div><div class="stat-v">${money(sum(p => p.due), cur)}</div><div class="stat-s">${withDue.length} ${withDue.length === 1 ? 'party owes' : 'parties owe'} money</div></div></div>
    <div class="stat"><div class="stat-ic red">${icon('clock')}</div><div><div class="stat-l">Overdue 30+ days</div><div class="stat-v">${money(overdueAmt, cur)}</div><div class="stat-s">${parties.filter(p => p.overdue > 30 && p.due > 0.004).length} parties – send a reminder</div></div></div>`;

  // ---- parties (left) ----
  const q = payView.q.trim().toLowerCase();
  const listed = parties.filter(p => (payView.filter === 'all' || p.due > 0.004) && (!q || [p.name, p.city, p.mobile].some(v => String(v || '').toLowerCase().includes(q))));
  if (payView.party && !parties.some(p => p.key === payView.party)) payView.party = null;
  $('#partyTabs').innerHTML = `<button data-pf="due" class="${payView.filter === 'due' ? 'on' : ''}">With dues <span>${withDue.length}</span></button><button data-pf="all" class="${payView.filter === 'all' ? 'on' : ''}">All parties <span>${parties.length}</span></button>`;
  $('#partyList').innerHTML = listed.length ? listed.map(p => `
    <div class="party${p.key === payView.party ? ' on' : ''}" data-party="${esc(p.key)}" tabindex="0">
      <div class="party-txt">
        <div class="party-name">${esc(p.name)}</div>
        <div class="party-sub">${[p.city, p.mobile].filter(Boolean).map(esc).join(' · ') || `${p.docs.length} document${p.docs.length === 1 ? '' : 's'}`}</div>
      </div>
      <div class="party-due${p.due > 0.004 ? '' : ' ok'}">${p.due > 0.004 ? money(p.due, p.currency) : 'Paid up'}
        <small>${p.due > 0.004 ? (p.overdue > 30 ? `<span class="overdue">${p.overdue} days</span>` : `${p.docs.filter(d => payFigures(d).due > 0.004).length} pending`) : `${money(p.received, p.currency)} received`}</small></div>
    </div>`).join('') : `<div class="empty-state small"><h3>${parties.length ? 'No party matches' : 'No order forms or invoices yet'}</h3><p>${parties.length ? 'Try another name, city or mobile, or switch to “All parties”.' : 'Payments are recorded against saved order forms and invoices.'}</p></div>`;

  // ---- party detail (right) ----
  const panel = $('#partyPanel');
  const p = payView.party ? parties.find(x => x.key === payView.party) : null;
  if (!p) {
    const top = withDue.slice(0, 3);
    panel.innerHTML = `<div class="card pay-empty"><div class="empty-state">
      <div class="pay-empty-ic">${icon('wallet')}</div>
      <h3>Select a party</h3>
      <p>Pick a firm on the left to see what it was billed, what it has paid and what is still due – then record a payment.</p>
      ${top.length ? `<div class="pay-top">${top.map(t => `<button type="button" class="btn sm" data-party="${esc(t.key)}">${esc(t.name)} · ${money(t.due, t.currency)}</button>`).join('')}</div>` : ''}
    </div></div>`;
    return;
  }
  const canRecord = p.docs.length > 0 && p.docs.every(canEdit);
  const pct = p.billed > 0 ? Math.min(100, Math.round(p.received / p.billed * 100)) : 0;
  const statusPill = d => `<span class="status-pill s-${esc(d.status).replace(/\s+/g, '-')}">${esc(d.status)}</span>`;
  const docRow = (d, invoiced) => {
    const f = payFigures(d); const inv = invoiced ? invoiceOf(d) : null;
    return `<tr data-open-doc="${d.id}" class="${invoiced ? 'muted-row' : ''}">
      <td><div class="cell-main"><span class="type-dot ${d.type}"></span>${esc(d.number)}</div><div class="cell-sub">${kindOf(d.type).title}${inv ? ` · invoiced as ${esc(inv.number)}` : ''}</div></td>
      <td class="nowrap" data-l="Date">${esc(niceDate(d.date))}</td>
      <td class="num" data-l="Total">${amt(f.total, d.currency)}</td>
      <td class="num" data-l="Received">${invoiced ? '—' : amt(f.received, d.currency)}</td>
      <td class="num ${!invoiced && f.due > 0.004 ? 'due' : 'clear'}" data-l="Due">${invoiced ? '—' : (f.due > 0.004 ? amt(f.due, d.currency) : 'Nil')}</td>
      <td>${statusPill(d)}</td>
      <td class="act-col"><div class="acts">${!invoiced && f.due > 0.004 && canRecord ? `<button class="icon-act" data-pay-act="record" data-doc="${d.id}" title="Record a payment for this document">${icon('wallet')}</button>` : ''}<button class="icon-act" data-pay-act="open" data-doc="${d.id}" title="Open">${icon(canEdit(d) ? 'edit' : 'eye')}</button></div></td>
    </tr>`;
  };
  const ledger = partyLedger(p);
  const ledgerRow = r => `<tr>
      <td class="nowrap"><div class="cell-main">${esc(niceDate(r.date))}</div><div class="cell-sub">${r.receipt ? esc(r.receipt) : '<i>no receipt</i>'}</div></td>
      <td class="num"><div class="cell-main">${money(r.amount, r.cur)}</div>${r.partyDueAfter !== undefined ? `<div class="cell-sub">due after: ${amt(r.partyDueAfter, r.cur)}</div>` : ''}</td>
      <td><div class="cell-main">${esc(r.mode || '—')}</div><div class="cell-sub">${esc(r.ref || '')}${r.note ? `${r.ref ? ' · ' : ''}${esc(r.note)}` : ''}&nbsp;</div></td>
      <td><div class="cell-main">${r.lines.map(l => esc(l.doc.number)).join(', ')}</div><div class="cell-sub">${r.lines.length > 1 ? r.lines.map(l => `${esc(l.doc.number)}: ${amt(l.amount, r.cur)}`).join(' · ') : (r.by ? `by ${esc(r.by)}` : '')}&nbsp;</div></td>
      <td class="act-col"><div class="acts">${r.receipt ? `<button class="icon-act" data-pay-act="receipt" data-rc="${esc(r.receipt)}" title="Download receipt (PDF)">${icon('pdf')}</button>${p.mobile ? `<a class="icon-act" href="${waLink(p.mobile, p.branch, receiptText(p, r))}" target="_blank" rel="noopener" title="Send receipt on WhatsApp">${icon('wa')}</a>` : ''}${canRecord ? `<button class="icon-act danger" data-pay-act="del" data-rc="${esc(r.receipt)}" title="Remove this payment">${icon('trash')}</button>` : ''}` : (r.lines[0] && canEdit(r.lines[0].doc) ? `<button class="icon-act" data-pay-act="open" data-doc="${r.lines[0].doc.id}" title="Change the advance in the document">${icon('edit')}</button>` : '')}</div></td>
    </tr>`;
  panel.innerHTML = `<div class="card pay-card">
    <div class="pay-head">
      <div>
        <h3>${esc(p.name)}</h3>
        <div class="pay-sub">${[p.city, p.mobile].filter(Boolean).map(esc).join(' · ')}${p.city || p.mobile ? ' · ' : ''}<span class="chip">${esc(regionName(p.branch))}</span>${p.mixed ? ' <span class="chip warn">mixed currencies</span>' : ''}</div>
      </div>
      <div class="pay-actions">
        ${p.mobile && p.due > 0.004 ? `<a class="btn" href="${waLink(p.mobile, p.branch, reminderText(p))}" target="_blank" rel="noopener">${icon('wa')} Send reminder</a>` : ''}
        ${canRecord ? `<button class="btn primary" data-pay-act="record"${p.due > 0.004 ? '' : ' disabled title="Nothing is due from this party"'}>+ Record payment</button>` : `<span class="muted small">View only – ${p.docs.length ? theTeam(p.branch) + ' records these payments.' : 'all of this party’s orders have been invoiced; record payments on the invoice.'}</span>`}
      </div>
    </div>
    <div class="pay-kpis">
      <div class="pay-kpi"><small>Billed</small><b>${money(p.billed, p.currency)}</b><div class="pay-progress" title="${pct}% received"><i style="width:${pct}%"></i></div></div>
      <div class="pay-kpi"><small>Received</small><b class="got">${money(p.received, p.currency)}</b><span class="pay-kpi-s">${p.lastPaid ? `last on ${esc(niceDate(p.lastPaid))}` : 'no payments yet'}</span></div>
      <div class="pay-kpi due${p.due > 0.004 ? '' : ' clear'}"><small>Due</small><b>${p.due > 0.004 ? money(p.due, p.currency) : 'Nil'}</b><span class="pay-kpi-s">${p.due > 0.004 ? (p.overdue > 30 ? `<span class="overdue">oldest ${p.overdue} days</span>` : `${p.docs.filter(d => payFigures(d).due > 0.004).length} document${p.docs.filter(d => payFigures(d).due > 0.004).length === 1 ? '' : 's'} pending`) : 'fully paid'}</span></div>
    </div>
    <div class="pay-sec">Documents</div>
    <div class="table-wrap"><table class="list pay-docs"><thead><tr><th>Document</th><th>Date</th><th class="num">Total</th><th class="num">Received</th><th class="num">Due</th><th>Status</th><th class="act-col"></th></tr></thead>
      <tbody>${p.docs.map(d => docRow(d, false)).join('')}${p.invoiced.map(d => docRow(d, true)).join('')}</tbody></table></div>
    <div class="pay-sec">Payments received <span class="pay-count">${ledger.length}</span></div>
    ${ledger.length ? `<div class="table-wrap"><table class="list pay-ledger"><thead><tr><th>Date · Receipt</th><th class="num">Amount</th><th>Mode · Reference</th><th>Against</th><th class="act-col"></th></tr></thead>
      <tbody>${ledger.map(ledgerRow).join('')}</tbody></table></div>` : `<div class="pay-none">No payment recorded yet.${canRecord && p.due > 0.004 ? ' Use “+ Record payment” when money comes in.' : ''}</div>`}
  </div>`;
}

function bindPayments() {
  const view = $('#view-payments');
  if (!view) return;
  $('#partySearch').addEventListener('input', e => { payView.q = e.target.value; renderPayments(); });
  $('#payCsvBtn').addEventListener('click', exportPaymentsCsv);
  $('#payRecordBtn').addEventListener('click', () => recordPayment(payView.party ? findParty(payView.party) : null));
  view.addEventListener('click', async e => {
    const rt = e.target.closest('#payRegionTabs button[data-region]');
    if (rt) { payView.region = rt.dataset.region; payView.party = null; renderPayments(); return; }
    const pf = e.target.closest('button[data-pf]');
    if (pf) { payView.filter = pf.dataset.pf; renderPayments(); return; }
    const act = e.target.closest('[data-pay-act]');
    if (act) {
      const p = payView.party ? findParty(payView.party) : null;
      const a = act.dataset.payAct;
      if (a === 'record') { recordPayment(p, act.dataset.doc); return; }
      if (a === 'receipt') { act.disabled = true; act.classList.add('busy'); await exportReceipt(act.dataset.rc); act.disabled = false; act.classList.remove('busy'); return; }
      if (a === 'del') { removeReceipt(p, act.dataset.rc); return; }
      if (a === 'open') { const d = docs.find(x => x.id === act.dataset.doc); if (d && await confirmDiscard()) { openDoc(clone(d)); showView('editor'); window.scrollTo(0, 0); } return; }
    }
    const row = e.target.closest('tr[data-open-doc]');
    if (row && !e.target.closest('a, button')) { const d = docs.find(x => x.id === row.dataset.openDoc); if (d && await confirmDiscard()) { openDoc(clone(d)); showView('editor'); window.scrollTo(0, 0); } return; }
    const pr = e.target.closest('[data-party]');
    if (pr) { payView.party = pr.dataset.party; renderPayments(); if (window.matchMedia('(max-width: 960px)').matches) { const el = $('#partyPanel'); el && el.scrollIntoView({ behavior: 'smooth', block: 'start' }); } }
  });
  view.addEventListener('keydown', e => { if (e.key === 'Enter' && e.target.matches('.party')) e.target.click(); });
}

/* ---------------- recording a payment ---------------- */
function nextReceiptNo(branch, date) {
  const RS = SB(branch);
  RS.counters = RS.counters || {};
  const taken = new Set(docs.flatMap(d => (d.payments || []).map(pm => pm.receipt)));
  let seq = Number(RS.counters['receipt-' + branch]) || 1, number;
  for (;;) { number = formatNumber(RECEIPT_PATTERN, branch, date, seq, (RS.numbering && RS.numbering.pad) || 4); if (!taken.has(number)) break; seq++; }
  return { number, seq };
}

/** Writes a changed document everywhere: the list, the browser copy, the database and the open editor. */
function commitDoc(d) {
  d.updatedAt = new Date().toISOString();
  const i = docs.findIndex(x => x.id === d.id);
  if (i >= 0) docs[i] = d;
  if (typeof doc !== 'undefined' && doc && doc.id === d.id) {
    Object.assign(doc, { payments: clone(d.payments || []), status: d.status, history: clone(d.history || []), payment: clone(d.payment || {}) });
    persistDraft();
    if ($('#view-editor').classList.contains('active')) { loadForm(); renderPreview(); }
  }
}

async function recordPayment(party, presetDocId) {
  // no party chosen yet: pick one of the parties that owe money
  if (!party) {
    const owing = partyList().filter(p => p.due > 0.004 && p.docs.every(canEdit));
    if (!owing.length) { toast('No party owes anything in this team right now.'); return; }
    const pick = await formDialog({ title: 'Record a payment', ok: 'Next', fields: [{ name: 'party', label: 'Party (firm)', type: 'select', full: true, options: owing.map(p => [p.key, `${p.name} – due ${money(p.due, p.currency)}`]) }] });
    if (!pick) return;
    party = findParty(pick.party);
    if (!party) return;
  }
  const open = party.docs.filter(d => payFigures(d).due > 0.004);
  if (!open.length) { toast(`${party.name} has nothing due.`); return; }
  if (!open.every(canEdit)) { toast(`Only ${theTeam(party.branch)} can record payments for ${party.name}.`, true); return; }
  const cur = (open.find(d => d.id === presetDocId) || open[0]).currency;
  const dueAll = round2(open.reduce((s, d) => s + payFigures(d).due, 0));
  const names = (employees || []).map(e => e.name);
  const me = USER && names.includes(USER.displayName) ? USER.displayName : '';
  const v = await formDialog({
    title: `Record payment – ${party.name}`,
    ok: 'Save payment',
    fields: [
      { name: 'amount', label: `Amount received (${cur})`, type: 'number', step: '0.01', min: '0.01', inputmode: 'decimal', required: true, placeholder: '0.00', hint: `Due from this party: ${money(dueAll, cur)}` },
      { name: 'date', label: 'Date received', type: 'date', value: todayISO(), required: true },
      { name: 'mode', label: 'Payment mode', type: 'select', value: 'Online / UPI', options: [...PAYMENT_MODES, 'Other'].map(m => [m, m]) },   // the same modes as the document's payment box
      { name: 'ref', label: 'Reference (UTR / cheque no.)', placeholder: 'optional' },
      { name: 'apply', label: 'Apply to', type: 'select', full: true, value: presetDocId && open.some(d => d.id === presetDocId) ? presetDocId : 'auto',
        options: [['auto', `Oldest due first (automatic) – ${open.length} document${open.length === 1 ? '' : 's'}`], ...open.map(d => [d.id, `${d.number} · ${kindOf(d.type).title} · due ${money(payFigures(d).due, d.currency)}`])] },
      { name: 'by', label: 'Received by', type: 'select', value: me || names[0] || '', options: [['', '— select employee —'], ...names.map(n => [n, n])], full: !!names.length },
      { name: 'note', label: 'Note', placeholder: 'optional – e.g. 2nd instalment', full: true }
    ],
    submit: async vals => {
      const amount = round2(vals.amount);
      if (!(amount > 0)) throw new Error('Enter the amount received.');
      if (!vals.date) throw new Error('Enter the date the payment was received.');
      if (!String(vals.by || '').trim()) throw new Error('Select the employee who received the payment.');
      const targets = vals.apply === 'auto' ? open : open.filter(d => d.id === vals.apply);
      if (!targets.length) throw new Error('Choose which document the payment is for.');
      if (targets.some(d => d.currency !== cur)) throw new Error(`This party has documents in more than one currency – apply the payment to one document.`);
      const cap = round2(targets.reduce((s, d) => s + payFigures(d).due, 0));
      if (amount > cap + 0.004) throw new Error(`That is more than the ${money(cap, cur)} due${vals.apply === 'auto' ? ' from this party' : ' on this document'}. Enter up to ${money(cap, cur)}.`);
      const branch = targets[0].branch;
      const rc = nextReceiptNo(branch, vals.date);
      const at = new Date().toISOString(), by = vals.by.trim(), note = String(vals.note || '').trim(), ref = String(vals.ref || '').trim();
      const touched = []; let left = amount;
      for (const d of targets) {
        if (left <= 0.004) break;
        normalizeDoc(d);
        const take = round2(Math.min(left, payFigures(d).due)); left = round2(left - take);
        d.payments.push({ id: uid(), receipt: rc.number, date: vals.date, amount: take, mode: vals.mode, ref, note, by, at });
        applyPaymentStatus(d);
        const after = payFigures(d).due;
        d.payments[d.payments.length - 1].docBalanceAfter = after;
        addHistory(d, 'payment', { by, note: `${money(take, d.currency)} · ${vals.mode}${ref ? ' · ' + ref : ''} · ${rc.number}${after > 0.004 ? ` · balance ${money(after, d.currency)}` : ' · paid in full'}`, receipt: rc.number, amount: take });
        touched.push(d);
      }
      const dueAfter = round2(Math.max(0, dueAll - amount));
      touched.forEach(d => { d.payments.filter(pm => pm.receipt === rc.number).forEach(pm => { pm.partyDueAfter = dueAfter; }); commitDoc(d); });
      SB(branch).counters['receipt-' + branch] = rc.seq + 1;
      Store.set('dc_docs', docs);
      saveSettingsFor(branch);
      await Promise.all(touched.map(d => remotePutDoc(d)));
      vals._receipt = rc.number; vals._dueAfter = dueAfter; vals._amount = amount;
    }
  });
  if (!v) return;
  renderPayments();
  if ($('#view-docs').classList.contains('active')) renderDocs();
  toast(`Payment of ${money(v._amount, cur)} recorded – ${v._receipt}`);
  const dl = await ask({ title: 'Payment recorded', message: `Receipt ${v._receipt}\n${money(v._amount, cur)} received from ${party.name} by ${v.mode}.\nBalance due now: ${v._dueAfter > 0.004 ? money(v._dueAfter, cur) : 'Nil – fully paid'}.`, ok: 'Download receipt', cancel: 'Close' });
  if (dl) exportReceipt(v._receipt);
}

async function removeReceipt(party, rc) {
  if (!party || !rc) return;
  const ledger = partyLedger(party).find(r => r.receipt === rc);
  if (!ledger) return;
  const ok = await ask({ title: `Remove payment ${rc}?`, message: `${money(ledger.amount, ledger.cur)} received on ${niceDate(ledger.date)} will be removed and the due of ${party.name} goes up again. The receipt becomes invalid. This cannot be undone.`, ok: 'Remove payment', danger: true });
  if (!ok) return;
  const touched = [];
  for (const d of docs) {
    if (partyKey(d) !== party.key || !(d.payments || []).some(pm => pm.receipt === rc)) continue;
    if (!canEdit(d)) { toast(`Only ${theTeam(d.branch)} can change this payment.`, true); return; }
    const removed = round2(d.payments.filter(pm => pm.receipt === rc).reduce((s, pm) => s + Number(pm.amount), 0));
    d.payments = d.payments.filter(pm => pm.receipt !== rc);
    applyPaymentStatus(d);
    if (!d.payments.length && !(Number(d.advance) > 0)) d.payment = { date: '', mode: '', ref: '' };
    addHistory(d, 'payment-removed', { by: (USER && USER.displayName) || '', note: `${money(removed, d.currency)} · ${rc}`, receipt: rc, amount: removed });
    commitDoc(d); touched.push(d);
  }
  Store.set('dc_docs', docs);
  renderPayments();                                   // the page shows the change at once; the database follows
  if ($('#view-docs').classList.contains('active')) renderDocs();
  toast(`Payment ${rc} removed`);
  await Promise.all(touched.map(d => remotePutDoc(d)));
}

/* ---------------- messages ---------------- */
/** A WhatsApp link to the party's mobile. A local number gets the team's country code. */
function waLink(mobile, branch, text) {
  let digits = String(mobile || '').replace(/\D/g, '').replace(/^0+/, '');
  if (!digits) return '#';
  const dial = String(regionInfo(branch).dial || '').replace(/\D/g, '');
  if (dial && digits.length <= 10 && !digits.startsWith(dial)) digits = dial + digits;
  return `https://wa.me/${digits}?text=${encodeURIComponent(text)}`;
}
function receiptText(p, r) {
  const co = SB(p.branch).companyName || SB(p.branch).legalName;
  return `Dear ${p.name},\nWe have received ${money(r.amount, r.cur)} on ${niceDate(r.date)} by ${r.mode}${r.ref ? ` (Ref: ${r.ref})` : ''} against ${r.lines.map(l => l.doc.number).join(', ')}.\nReceipt No. ${r.receipt}.${r.partyDueAfter !== undefined ? `\nBalance due: ${r.partyDueAfter > 0.004 ? money(r.partyDueAfter, r.cur) : 'Nil'}.` : ''}\nThank you!\n– ${co}`;
}
function reminderText(p) {
  const co = SB(p.branch).companyName || SB(p.branch).legalName;
  const pend = p.docs.filter(d => payFigures(d).due > 0.004);
  return `Dear ${p.name},\nA gentle reminder from ${co}: ${money(p.due, p.currency)} is pending against ${pend.map(d => `${d.number} (${money(payFigures(d).due, d.currency)})`).join(', ')}.\nKindly arrange the payment at your earliest convenience. Thank you!`;
}

/* ---------------- receipt (PDF) ---------------- */
/** Everything a receipt shows, rebuilt from the documents that carry it. */
function receiptData(rc) {
  const lines = []; const seen = new Set(); let first = null, pm0 = null;
  for (const d of docs) for (const pm of d.payments || []) {
    if (pm.receipt !== rc || seen.has(pm.id)) continue;
    seen.add(pm.id);
    if (d.type === 'order' && invoiceOf(d) && docs.some(x => x !== d && (x.payments || []).some(q => q.id === pm.id))) continue;   // the invoice carries the copy
    if (!first) { first = d; pm0 = pm; }
    const T = docTotals(d);
    lines.push({ doc: d, amount: Number(pm.amount), balanceAfter: pm.docBalanceAfter !== undefined ? pm.docBalanceAfter : Math.max(0, T.balance), total: T.total });
  }
  if (!first) return null;
  return { rc, date: pm0.date, mode: pm0.mode, ref: pm0.ref, note: pm0.note, by: pm0.by, cur: first.currency, branch: first.branch,
    party: { name: first.customer.company, city: first.customer.city, address: first.customer.address, mobile: first.customer.mobile, taxId: first.customer.taxId },
    amount: round2(lines.reduce((s, l) => s + l.amount, 0)), lines, partyDueAfter: pm0.partyDueAfter };
}

function receiptPage(r, S0) {
  const S = brandedFor(S0, r.branch);
  const b = S.branches[r.branch] || branchDefaults(r.branch);
  const cur = r.cur;
  const brand = S.logo && S.logoHasName
    ? `<img class="rcpt-logo" src="${S.logo}" alt="">`
    : `<div class="rcpt-brand">${S.logo ? `<img src="${S.logo}" alt="">` : ''}<div><div class="rcpt-name">${esc(S.companyName || S.legalName)}</div><div class="rcpt-legal">${esc(S.legalName)}</div></div></div>`;
  const kv = (k, v) => (v ? `<div class="rcpt-kv"><small>${k}</small><b>${esc(v)}</b></div>` : '');
  const taxName = b.taxLabel === 'VAT' ? 'TRN' : 'GSTIN';
  const today = todayISO();

  // the party's account as on today, and its recent receipts
  const first = r.lines[0].doc;
  const party = partyOfDoc(first);
  const pending = party ? party.docs.filter(d => payFigures(d).due > 0.004) : [];
  const history = party ? partyLedger(party).filter(x => x.date <= today).slice(0, 5) : [];
  const pct = party && party.billed > 0 ? Math.min(100, Math.round(party.received / party.billed * 100)) : 0;

  // support box and QR code, as printed on the invoices
  const sup = S.support || {};
  const phone = (sup.phone || '').trim() || b.phone || '';
  const whatsapp = (sup.whatsapp || '').trim() || phone;
  const waDigits = whatsapp.replace(/\D/g, '');
  const site = (S.website || '').trim();
  const target = S.qrTarget || 'whatsapp';
  const qrUrl = target === 'whatsapp' && waDigits ? 'https://wa.me/' + waDigits : target === 'website' && site ? (/^https?:\/\//i.test(site) ? site : 'https://' + site) : '';
  const qr = qrUrl && typeof qrImg === 'function' ? qrImg(qrUrl, 'rcpt-qr') : '';
  const supLine = (k, v) => (v ? `<div><small>${k}</small><b>${esc(v)}</b></div>` : '');

  return `<div class="page rcpt" style="--accent:${esc(S.accent || '#E8772E')}">
    <div class="rcpt-bar"></div>
    <div class="rcpt-head">
      <div>${brand}
        <div class="rcpt-contact">${[b.address, b.phone, S.email, S.website, b.taxId ? `${taxName}: ${b.taxId}` : ''].filter(Boolean).map(esc).join('<span>·</span>')}</div></div>
      <div class="rcpt-title"><h1>PAYMENT RECEIPT</h1>
        <div class="rcpt-meta"><span>Receipt No.</span><b>${esc(r.rc)}</b></div>
        <div class="rcpt-meta"><span>Date</span><b>${esc(fmtDate(r.date))}</b></div>
        <div class="rcpt-meta"><span>Branch</span><b>${esc(b.label || regionName(r.branch))}</b></div></div>
    </div>

    <div class="rcpt-from">
      <div class="rcpt-box"><small>Received with thanks from</small><div class="rcpt-party">${esc(r.party.name)}</div>
        <div class="rcpt-party-s">${[r.party.address, r.party.city].filter(Boolean).map(esc).join(', ')}${r.party.mobile ? `${r.party.address || r.party.city ? '<br>' : ''}Mobile: ${esc(r.party.mobile)}` : ''}${r.party.taxId ? `<br>${taxName}: ${esc(r.party.taxId)}` : ''}</div></div>
      <div class="rcpt-box rcpt-amount"><small>Amount received</small><b>${money(r.amount, cur)}</b><div class="rcpt-words">${esc(amountInWords(r.amount, cur))}</div></div>
    </div>
    <div class="rcpt-grid">${kv('Payment mode', r.mode)}${kv('Reference', r.ref || '—')}${kv('Received on', fmtDate(r.date))}${kv('Received by', r.by)}${kv('Note', r.note)}</div>

    <div class="rcpt-h">Applied to</div>
    <table class="applied"><colgroup><col style="width:27%"><col style="width:13%"><col style="width:15%"><col style="width:14%"><col style="width:15%"><col style="width:16%"></colgroup>
      <thead><tr><th>Document</th><th>Date</th><th class="amt">Document total</th><th class="amt">This payment</th><th class="amt">Received to date</th><th class="amt">Balance due</th></tr></thead>
      <tbody>${r.lines.map(l => `<tr><td><b>${esc(l.doc.number)}</b><br><span class="rcpt-dim">${kindOf(l.doc.type).title}</span></td><td>${esc(fmtDate(l.doc.date))}</td><td class="amt">${amt(l.total, cur)}</td><td class="amt">${amt(l.amount, cur)}</td><td class="amt">${amt(Math.max(0, l.total - l.balanceAfter), cur)}</td><td class="amt ${l.balanceAfter > 0.004 ? 'due' : 'ok'}">${l.balanceAfter > 0.004 ? amt(l.balanceAfter, cur) : 'Nil'}</td></tr>`).join('')}
      <tr class="tot"><td colspan="3">Total received by this receipt</td><td class="amt">${amt(r.amount, cur)}</td><td colspan="2" class="amt wrap">${r.partyDueAfter !== undefined ? `Balance due after this payment<br><b>${r.partyDueAfter > 0.004 ? money(r.partyDueAfter, cur) : 'Nil'}</b>` : ''}</td></tr></tbody>
    </table>

    ${party ? `<div class="rcpt-two">
      <div class="rcpt-box rcpt-acct">
        <small>Account summary – ${esc(r.party.name)} · as on ${esc(fmtDate(today))}</small>
        <div class="rcpt-acct-row"><span>Billed to date</span><b>${money(party.billed, cur)}</b></div>
        <div class="rcpt-acct-row"><span>Received to date</span><b class="ok">${money(party.received, cur)}</b></div>
        <div class="rcpt-acct-row total"><span>Balance due</span><b class="${party.due > 0.004 ? 'due' : 'ok'}">${party.due > 0.004 ? money(party.due, cur) : 'Nil'}</b></div>
        <div class="rcpt-prog"><i style="width:${pct}%"></i></div><div class="rcpt-dim">${pct}% of the billed amount received</div>
      </div>
      <div class="rcpt-box rcpt-hist">
        <small>Recent payments</small>
        <table class="mini"><tbody>${history.map(h => `<tr class="${h.receipt === r.rc ? 'this' : ''}"><td>${esc(fmtDate(h.date))}</td><td>${esc(h.receipt || 'Advance')}</td><td>${esc(h.mode || '')}</td><td class="amt">${amt(h.amount, cur)}</td></tr>`).join('') || '<tr><td colspan="4" class="rcpt-dim">This is the first payment.</td></tr>'}</tbody></table>
      </div>
    </div>
    <div class="rcpt-pend"><div class="rcpt-h">${pending.length ? `Outstanding documents · as on ${esc(fmtDate(today))}` : 'Account status'}</div>
    ${pending.length ? `<table class="pend"><colgroup><col style="width:34%"><col style="width:14%"><col style="width:17%"><col style="width:17%"><col style="width:18%"></colgroup>
      <thead><tr><th>Document</th><th>Date</th><th class="amt">Total</th><th class="amt">Received</th><th class="amt">Balance due</th></tr></thead>
      <tbody>${pending.slice(0, 5).map(d => { const f = payFigures(d); return `<tr><td><b>${esc(d.number)}</b> <span class="rcpt-dim">${kindOf(d.type).title}</span></td><td>${esc(fmtDate(d.date))}</td><td class="amt">${amt(f.total, d.currency)}</td><td class="amt">${amt(f.received, d.currency)}</td><td class="amt due">${amt(f.due, d.currency)}</td></tr>`; }).join('')}
      ${pending.length > 5 ? `<tr><td colspan="5" class="rcpt-dim">and ${pending.length - 5} more document${pending.length - 5 === 1 ? '' : 's'}</td></tr>` : ''}</tbody></table>`
      : `<div class="rcpt-clear">✓ All documents of ${esc(r.party.name)} are fully paid. Thank you!</div>`}</div>` : ''}

    <div class="rcpt-bottom">
      <div class="rcpt-support">
        <div class="rcpt-sup-txt">
          <small>Need help?</small>
          <div class="rcpt-sup-grid">
            ${waDigits && waDigits !== phone.replace(/\D/g, '') ? supLine('Call us', phone) + supLine('WhatsApp', whatsapp) : supLine('Call / WhatsApp', phone)}
            ${supLine('Working hours', (sup.hours || '').trim())}
            ${supLine('Email', (S.email || '').trim())}
          </div>
          <div class="rcpt-note">${r.mode === 'Cheque' ? 'Subject to realisation of the cheque. ' : ''}This is a computer-generated receipt from ${esc(S.legalName)}; please quote the receipt number in any correspondence.</div>
        </div>
        ${qr ? `<div class="rcpt-qrbox">${qr}<b>Scan to ${target === 'website' ? 'visit' : 'chat'}</b></div>` : ''}
      </div>
      <div class="rcpt-foot">
        <div class="rcpt-thanks">Thank you for your payment.<br>${esc(S.companyName || S.legalName)}${b.address ? ` · ${esc(b.address)}` : ''}</div>
        <div class="rcpt-sign">${S.stamp ? `<img src="${S.stamp}" alt="">` : '<div class="rcpt-sign-space"></div>'}<div class="line">For ${esc(S.legalName)}<br><span>Authorised Signatory</span></div></div>
      </div>
    </div>
  </div>`;
}

/** The page is one fixed A4 sheet: when a long party name, address or many documents make the content taller than the
    sheet, spacing is tightened first, then the optional sections give way (recent payments, outstanding documents,
    support box) – so the amount, the applied-to table and the signature are never cut off. */
function fitReceipt(page) {
  const over = () => page.scrollHeight > page.clientHeight + 1;
  if (!over()) return 'full';
  page.classList.add('tight');
  if (!over()) return 'tight';
  const hist = page.querySelector('.rcpt-hist');
  if (hist) { hist.remove(); const two = page.querySelector('.rcpt-two'); if (two) two.classList.add('one'); }
  if (!over()) return 'no-history';
  const pend = page.querySelector('.rcpt-pend');
  if (pend) pend.remove();
  if (!over()) return 'no-outstanding';
  const sup = page.querySelector('.rcpt-support');
  if (sup) sup.remove();
  return over() ? 'overflow' : 'minimal';
}

/** Renders a receipt into an area (offscreen) and fits it to the sheet. Returns the receipt data, or null. */
function renderReceipt(rc, area) {
  const r = receiptData(rc);
  if (!r) return null;
  area.innerHTML = receiptPage(r, SB(r.branch));
  r.fit = fitReceipt(area.querySelector('.page'));
  return r;
}

async function exportReceipt(rc) {
  const area = $('#render-area');
  try {
    const r = renderReceipt(rc, area);
    if (!r) { toast('Receipt not found', true); return false; }
    const clean = s => String(s || '').replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim();
    await areaToPdf(area, `${clean(r.party.name).toUpperCase() || 'Receipt'} - Receipt ${clean(rc)}`, { author: SB(r.branch).legalName, creator: SB(r.branch).legalName });
    toast(`Receipt downloaded – ${rc}`);
    return true;
  } catch (err) {
    console.error(err);
    toast('Could not create the receipt PDF (' + (err.message || err) + ').', true);
    return false;
  } finally { area.innerHTML = ''; }
}

/* ---------------- export ---------------- */
function exportPaymentsCsv() {
  const parties = partyList();
  const rows = [];
  const cell = v => { const s = String(v ?? ''); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  for (const p of parties) for (const r of partyLedger(p)) for (const l of r.lines) {
    rows.push([fmtDate(r.date), r.receipt || 'advance', p.name, p.city, p.mobile, regionName(p.branch), l.doc.number, kindOf(l.doc.type).title, r.cur, l.amount, r.mode, r.ref, r.by, r.note].map(cell).join(','));
  }
  if (!rows.length) { toast('No payments to export', true); return; }
  const cols = ['Date', 'Receipt', 'Party', 'City', 'Mobile', 'Branch', 'Document', 'Type', 'Currency', 'Amount', 'Mode', 'Reference', 'Received by', 'Note'];
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob(['﻿' + [cols.join(','), ...rows].join('\r\n')], { type: 'text/csv;charset=utf-8' }));
  a.download = `DataCare-payments-${todayISO()}.csv`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  toast(`Exported ${rows.length} payment line${rows.length === 1 ? '' : 's'}`);
}
