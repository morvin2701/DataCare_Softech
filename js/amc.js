'use strict';
/* AMC (Annual Maintenance Contract): the reminder letter printed in the premium design, and the AMC page that keeps
   every contract on record – period, days left, renewals, and reminders 30 / 15 / 5 days before expiry. An AMC letter
   is a document like the others (saved, numbered, paid through the Payments page), so nothing new is needed on the
   server. */

const AMC_STAGES = [30, 15, 5];
const amcView = { region: undefined, filter: 'open', q: '' };

/* ---------------- helpers ---------------- */
const daysUntil = iso => (iso ? Math.round((new Date(iso + 'T00:00:00').getTime() - new Date(todayISO() + 'T00:00:00').getTime()) / 864e5) : null);
/** "2026-2027": the Indian financial year (April–March) a date falls in. */
function fyLabel(iso) {
  if (!iso) return '';
  const d = new Date(iso + 'T00:00:00'); const y = d.getFullYear();
  const fy = d.getMonth() >= 3 ? y : y - 1;
  return `${fy}-${fy + 1}`;
}
/** One year after a date, less a day: 16/12/2026 → 15/12/2027. */
function addYearISO(iso) {
  const d = new Date((iso || todayISO()) + 'T00:00:00'); d.setFullYear(d.getFullYear() + 1); d.setDate(d.getDate() - 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
/** Fills in the AMC fields of a document (older documents, type switches). */
function ensureAmc(d, S) {
  if (!d.amc || typeof d.amc !== 'object') d.amc = {};
  const a = d.amc;
  if (a.licenseNo === undefined) a.licenseNo = '';
  if (a.installDate === undefined) a.installDate = '';
  if (!a.from) a.from = d.date || todayISO();
  if (!a.to) a.to = addYearISO(a.from);
  if (a.amount === undefined) a.amount = Number((S && S.amcAmount) || 0);
  const def = (S && S.amcLetter) || DEFAULT_SETTINGS.amcLetter;
  if (!d.amcText || typeof d.amcText !== 'object') d.amcText = clone(def);
  for (const k of Object.keys(def)) if (d.amcText[k] === undefined) d.amcText[k] = clone(def[k]);
  if (!Array.isArray(d.amcReminded)) d.amcReminded = [];
  return d;
}
/** The letter's single line item follows the AMC amount, so totals, tax and the Payments page all work as usual. */
function syncAmcItems(d) {
  if (d.type !== 'amc') return;
  const label = `Annual Maintenance Contract – ${fyLabel(d.amc.from)}`;
  d.items = [{ desc: label, amount: round2(d.amc.amount) }];
}
/** Days left on a contract, the reminder stage it is in (30 / 15 / 5) and whether a newer letter replaced it. */
function amcInfo(d) {
  const left = daysUntil(d.amc && d.amc.to);
  const renewedBy = docs.find(x => x.type === 'amc' && x.renewsId === d.id) || null;
  let stage = null;
  if (left !== null) for (const s of AMC_STAGES) if (left <= s) stage = s;
  if (left !== null && left < 0) stage = 'expired';
  return { left, stage, renewedBy, active: d.status === 'Renewed' && !renewedBy, open: d.status !== 'Not Renewed' && !renewedBy };
}
const amcLabelFor = info => (info.left === null ? '' : info.left < 0 ? `Expired ${-info.left} day${info.left === -1 ? '' : 's'} ago` : info.left === 0 ? 'Expires today' : `${info.left} day${info.left === 1 ? '' : 's'} left`);

/* ---------------- the letter (premium design) ---------------- */
function buildBlocksAmc(d, S) {
  const blocks = [];
  const add = (html, opts = {}) => blocks.push({ html, ...opts });
  const cur = d.currency;
  const T = docTotals(d);
  const a = d.amc || {}, tx = d.amcText || {};
  const c = d.customer || {};
  const uae = /^(uae|u\.a\.e\.?|united arab emirates)$/i.test((c.country || '').trim());
  const line = (k, v) => (v ? `<div class="p-line">${k ? `<span>${k}</span>` : ''}${esc(v)}</div>` : '');
  const place = [c.city && `${uae ? 'Emirate' : 'City'}: ${c.city}`, c.country && `Country: ${c.country}`].filter(Boolean);
  const who = String(d.employee || d.preparedBy || '').trim();
  const mobile = String(d.preparedMobile || '').trim();

  // Party + contract details (same two cards as the other documents)
  add(`<div class="p-parties">
      <div class="p-card">
        <div class="p-label">AMC For</div>
        <div class="p-company">${esc(c.company) || '&nbsp;'}</div>
        ${line('Contact', c.contact)}
        ${line('', c.address)}
        ${place.length ? `<div class="p-line">${place.map(esc).join('<i>•</i>')}</div>` : ''}
        ${line('Mobile', c.mobile)}
        ${line('Email', c.email)}
        ${line(uae ? 'TRN' : 'GSTIN', c.taxId)}
      </div>
      <div class="p-card alt">
        <div class="p-label">Contract Details</div>
        <div class="p-kv">
          ${a.licenseNo ? `<span>License No.</span><b>${esc(a.licenseNo)}</b>` : ''}
          ${a.installDate ? `<span>Install Date</span><b>${esc(fmtDate(a.installDate))}</b>` : ''}
          ${d.softwareVersion ? `<span>Software</span><b>${esc(d.softwareVersion)}${d.edition ? ' ' + esc(d.edition) : ''}</b>` : ''}
          <span>AMC Period</span><b>${esc(fmtDate(a.from))} – ${esc(fmtDate(a.to))} <span class="p-fy">(FY ${esc(fyLabel(a.from))})</span></b>
          ${d.status === 'Renewed' ? `<span>Status</span><b>Renewed ✓</b>` : ''}
        </div>
      </div>
    </div>`, { preferFirst: true });

  // Subject + letter text
  const para = t => String(t || '').split(/\n/).map(x => x.trim()).filter(Boolean).map(x => `<p>${esc(x)}</p>`).join('');
  add(`<div class="p-amc-letter">
      <div class="p-amc-subject"><span>Subject</span><b>${esc(tx.subject || 'Renewal of Annual Maintenance Contract')}</b></div>
      <div class="p-amc-dear">${esc(tx.salutation || 'Dear Sir / Madam,')}</div>
      ${para(tx.intro)}${para(tx.body)}
    </div>`, { preferFirst: true });

  // Duration + payable amount (the same totals panel as an invoice)
  const tr = (k, v, cls = '') => `<div class="p-tr ${cls}"><span>${k}</span><b>${v}</b></div>`;
  let tot = tr('A.M.C. Amount', pMoney(T.sub, cur));
  if (T.disc) tot += tr('Discount', '− ' + pMoney(T.disc, cur));
  if (d.taxEnabled) tot += tr(`${esc(d.taxLabel)} @ ${Number(d.taxRate) || 0}%`, pMoney(T.tax, cur));
  const settled = d.status === 'Renewed' && T.balance <= 0.004;
  if (settled) tot += `<div class="p-grand paid"><span>Amount Received</span><b>${esc(cur)} ${pMoney(T.total, cur)}</b></div>`;
  else {
    tot += `<div class="p-grand"><span>Payable Amount</span><b>${esc(cur)} ${pMoney(T.total, cur)}</b></div>`;
    if (T.adv) { tot += tr(receivedTitle(d), '− ' + pMoney(T.adv, cur), 'adv'); tot += `<div class="p-balance"><span>Balance Due</span><b>${esc(cur)} ${pMoney(T.balance, cur)}</b></div>`; }
  }
  add(`<div class="p-sum p-amc-sum">
      <div class="p-words">
        <div class="p-label">Duration of A.M.C. · Financial Year ${esc(fyLabel(a.from))}</div>
        <div class="p-amc-period"><span>From</span><b>${esc(fmtDate(a.from))}</b><span>To</span><b>${esc(fmtDate(a.to))}</b></div>
        ${d.showWords ? `<div class="p-label mt">Amount in Words</div><div class="p-words-t">${esc(amountInWords(settled ? T.total : (T.adv ? T.balance : T.total), cur))}</div>` : ''}
      </div>
      <div class="p-totals">${tot}</div>
    </div>`);

  // Advantages + note + closing
  const adv = (tx.advantages || []).map(x => String(x || '').trim()).filter(Boolean);
  if (adv.length) add(`<div class="p-sec">Advantages of A.M.C.</div>
      <div class="p-terms">${adv.map((t, i) => `<div class="p-term"><b>${String(i + 1).padStart(2, '0')}</b><span>${esc(t)}</span></div>`).join('')}</div>`);
  const closing = (tx.closing || []).map(x => String(x || '').trim()).filter(Boolean);
  if ((tx.note || '').trim() || closing.length) add(`<div class="p-amc-close">
      ${(tx.note || '').trim() ? `<div class="p-amc-note"><b>Note:</b> ${esc(tx.note)}</div>` : ''}
      ${closing.map(x => `<p>${esc(x)}</p>`).join('')}
    </div>`);

  // Bank details (+ UPI QR), as on invoices
  if (printBank(d, S)) add(bankBlockPremium(d, S));

  // Contact + signature
  const stamp = d.showStamp && S.stamp ? `<img class="p-stamp-img" src="${S.stamp}" alt="">` : '';
  add(`<div class="p-sign p-amc-sign">
      <div class="p-sigcard">
        <div class="p-label">If any issue, contact our team</div>
        <div class="p-amc-contact">${who ? `<b>${esc(who)}</b>` : ''}${mobile ? `<span>Mo.: ${esc(mobile)}</span>` : ''}${supportRowsOf(S, d.branch).slice(0, 1).map(r => `<span>${esc(r.label)}: ${esc(r.value)}</span>`).join('')}</div>
      </div>
      <div class="p-sigcard">
        <div class="p-label">For ${esc(S.legalName)}</div>
        <div class="p-sigbox">${stamp}</div>
        <div class="p-sigline"></div>
        <div class="p-sigcap"><b>Authorised Signatory</b><small>Thanking you</small></div>
      </div>
    </div>`, { cls: 'has-sign' });
  return blocks;
}

/* ---------------- AMC page ---------------- */
const inAmcRegion = d => !amcView.region || d.branch === amcView.region;
const amcDocs = () => docs.filter(d => d.type === 'amc' && inAmcRegion(d));

function renderAmc() {
  if (amcView.region === undefined) amcView.region = REGION || '';
  const view = $('#view-amc');
  if (!view) return;
  const all = amcDocs().map(d => ({ d, i: amcInfo(d) }));
  const open = all.filter(x => x.i.open);
  const active = open.filter(x => x.d.status === 'Renewed' && x.i.left >= 0);
  const expiring = active.filter(x => x.i.left <= 30);
  const expired = open.filter(x => x.i.left < 0);
  const pending = open.filter(x => x.d.status === 'Pending');
  const cur = (all[0] && all[0].d.currency) || (SB(amcView.region || REGION || 'UAE').branches[amcView.region || REGION || 'UAE'] || branchDefaults(amcView.region || REGION || 'UAE')).currency;
  const sumOf = list => round2(list.reduce((s, x) => s + payFigures(x.d).total, 0));

  $('#amcRegionTabs').innerHTML = regionTabsHTML(amcView.region, r => docs.filter(d => d.type === 'amc' && (!r || d.branch === r) && amcInfo(d).open).length);
  $('#amcRegionNote').textContent = amcView.region && !canWriteRegion(amcView.region) ? `You are viewing the AMC records of ${theTeam(amcView.region)}. They open as view only.` : '';
  $('#amcStats').innerHTML = `
    <div class="stat"><div class="stat-ic green">${icon('check')}</div><div><div class="stat-l">Active AMC</div><div class="stat-v">${active.length}</div><div class="stat-s">${money(sumOf(active), cur)} under contract</div></div></div>
    <div class="stat"><div class="stat-ic orange">${icon('clock')}</div><div><div class="stat-l">Expiring in 30 days</div><div class="stat-v">${expiring.length}</div><div class="stat-s">${expiring.filter(x => x.i.left <= 5).length} within 5 days</div></div></div>
    <div class="stat"><div class="stat-ic red">${icon('ban')}</div><div><div class="stat-l">Expired</div><div class="stat-v">${expired.length}</div><div class="stat-s">not renewed yet</div></div></div>
    <div class="stat"><div class="stat-ic blue">${icon('doc')}</div><div><div class="stat-l">Letters awaiting payment</div><div class="stat-v">${pending.length}</div><div class="stat-s">${money(sumOf(pending), cur)} to collect</div></div></div>`;

  const q = amcView.q.trim().toLowerCase();
  const filters = { open: open, expiring: expiring.concat(expired), active, pending, all };
  let list = filters[amcView.filter] || open;
  if (q) list = list.filter(x => [x.d.customer.company, x.d.customer.city, x.d.customer.mobile, x.d.amc.licenseNo, x.d.number, x.d.softwareVersion].some(v => String(v || '').toLowerCase().includes(q)));
  list = [...list].sort((p, r) => (p.i.left ?? 9e9) - (r.i.left ?? 9e9));
  $('#amcTabs').innerHTML = [['open', 'Current', open.length], ['expiring', 'Expiring / expired', expiring.length + expired.length], ['active', 'Active', active.length], ['pending', 'Awaiting payment', pending.length], ['all', 'All letters', all.length]]
    .map(([k, l, n]) => `<button data-af="${k}" class="${amcView.filter === k ? 'on' : ''}">${l} <span>${n}</span></button>`).join('');

  const pill = (x) => {
    const i = x.i;
    if (i.renewedBy) return `<span class="amc-pill done">Renewed → ${esc(i.renewedBy.number || 'new letter')}</span>`;
    if (x.d.status === 'Not Renewed') return '<span class="amc-pill off">Not renewed</span>';
    if (i.left === null) return '';
    const cls = i.left < 0 ? 'off' : i.left <= 5 ? 'hot' : i.left <= 30 ? 'warn' : 'ok';
    return `<span class="amc-pill ${cls}">${amcLabelFor(i)}</span>`;
  };
  const reminded = x => AMC_STAGES.filter(s => (x.d.amcReminded || []).includes(s)).map(s => `${s}d`).join(' · ');
  const statusSel = d => `<select class="status-sel s-${esc(d.status).replace(/\s+/g, '-')}" data-amc-status aria-label="Status"${canEdit(d) ? '' : ' disabled'}>${STATUSES.amc.map(st => opt(st, st, d.status)).join('')}</select>`;
  const table = $('#amcTable');
  if (!list.length) {
    table.innerHTML = '';
    $('#amcEmpty').innerHTML = `<div class="empty-ic">${icon('doc')}</div><h3>${all.length ? 'Nothing here' : 'No AMC letters yet'}</h3><p>${all.length ? 'Try another filter or search.' : 'Make an AMC reminder letter from the + New menu, or with “Make AMC letter” on an order form or invoice. Every letter is kept here with its period, days left and reminders.'}</p>${!all.length && (!amcView.region || canWriteRegion(amcView.region)) ? '<div class="empty-actions"><button class="btn primary" data-new-amc>+ New AMC Letter</button></div>' : ''}`;
    $('#amcEmpty').hidden = false; $('#amcFoot').innerHTML = ''; return;
  }
  $('#amcEmpty').hidden = true;
  table.innerHTML = `<thead><tr><th>Party</th><th>License · Software</th><th>AMC period</th><th>Days</th><th class="num">Amount</th><th>Status</th><th class="act-col"><span class="sr">Actions</span></th></tr></thead>
    <tbody>${list.map(x => { const d = x.d, i = x.i, f = payFigures(d); const ed = canEdit(d); const stage = i.active && i.stage ? i.stage : null; return `
      <tr data-id="${d.id}" class="${i.renewedBy ? 'muted-row' : ''}${stage && !(d.amcReminded || []).includes(stage) && stage !== 'expired' ? ' needs-reminder' : ''}" tabindex="0">
        <td><div class="cell-main"><span class="type-dot amc"></span>${esc(d.customer.company) || '<i class="muted">No company name</i>'}</div><div class="cell-sub">${[d.customer.city, d.customer.mobile].filter(Boolean).map(esc).join(' · ') || esc(d.number)}</div></td>
        <td><div class="cell-main">${esc(d.amc.licenseNo) || '<i class="muted">—</i>'}</div><div class="cell-sub">${esc(d.softwareVersion || '')}${d.edition ? ' ' + esc(d.edition) : ''}${d.amc.installDate ? ` · installed ${esc(niceDate(d.amc.installDate))}` : ''}</div></td>
        <td class="nowrap"><div class="cell-main">${esc(niceDate(d.amc.from))} – ${esc(niceDate(d.amc.to))}</div><div class="cell-sub">${esc(d.number)} · FY ${esc(fyLabel(d.amc.from))}</div></td>
        <td>${pill(x)}${reminded(x) ? `<div class="cell-sub">reminded ${reminded(x)}</div>` : ''}</td>
        <td class="num"><div class="cell-main">${amt(f.total, d.currency)} <small>${esc(d.currency)}</small></div>${f.due > 0.004 && f.received ? `<div class="cell-sub">Received ${amt(f.received, d.currency)} · Due ${amt(f.due, d.currency)}</div>` : f.due > 0.004 ? '<div class="cell-sub">unpaid</div>' : '<div class="cell-sub">paid</div>'}</td>
        <td>${statusSel(d)}</td>
        <td class="act-col"><div class="acts">
          <button class="icon-act" data-amc-act="open" title="${ed ? 'Open & edit' : 'View'}">${icon(ed ? 'edit' : 'eye')}</button>
          <button class="icon-act" data-amc-act="pdf" title="Download PDF">${icon('pdf')}</button>
          ${ed && !i.renewedBy ? `<button class="icon-act" data-amc-act="renew" title="Renew: make next year's letter">${icon('convert')}</button>` : '<span class="icon-gap"></span>'}
          ${d.customer.mobile ? `<a class="icon-act" href="${waLink(d.customer.mobile, d.branch, amcReminderText(d))}" target="_blank" rel="noopener" title="Send reminder on WhatsApp">${icon('wa')}</a>` : '<span class="icon-gap"></span>'}
          ${ed && stage && stage !== 'expired' && !(d.amcReminded || []).includes(stage) ? `<button class="icon-act" data-amc-act="reminded" data-stage="${stage}" title="Mark the ${stage}-day reminder as sent">${icon('check')}</button>` : '<span class="icon-gap"></span>'}
        </div></td>
      </tr>`; }).join('')}</tbody>`;
  $('#amcFoot').innerHTML = `<span>Showing <b>${list.length}</b> of ${all.length} AMC letter${all.length === 1 ? '' : 's'}</span><span>Rows marked in orange still need this stage's reminder</span>`;
}

/** The reminder a party gets on WhatsApp. */
function amcReminderText(d) {
  const S = SB(d.branch); const a = d.amc || {}; const f = payFigures(d); const i = amcInfo(d);
  const co = S.companyName || S.legalName;
  const when = i.left < 0 ? `expired on ${fmtDate(a.to)}` : i.left === 0 ? 'expires today' : `expires on ${fmtDate(a.to)} (${i.left} days left)`;
  return `Dear ${d.customer.company || 'Sir / Madam'},\nYour A.M.C. for ${d.softwareVersion || 'the software'}${a.licenseNo ? ` (License ${a.licenseNo})` : ''} ${when}.\nRenewal amount: ${money(f.due > 0.004 ? f.due : f.total, d.currency)} for ${fmtDate(a.from)} to ${fmtDate(a.to)}.\nKindly renew to continue enjoying prompt service support.\n– ${co}`;
}

/** Banner at the top of the app: contracts needing a reminder now. */
function renderAmcBanner() {
  const el = $('#amcBanner');
  if (!el) return;
  if (!USER && API.online) { el.hidden = true; return; }
  const due = docs.filter(d => d.type === 'amc' && canEdit(d)).map(d => ({ d, i: amcInfo(d) })).filter(x => x.i.active && x.i.stage && x.i.stage !== 'expired' && !(x.d.amcReminded || []).includes(x.i.stage));
  const expired = docs.filter(d => d.type === 'amc' && canEdit(d)).map(d => ({ d, i: amcInfo(d) })).filter(x => x.i.open && x.i.left !== null && x.i.left < 0 && x.d.status !== 'Pending');
  if (!due.length && !expired.length) { el.hidden = true; return; }
  const parts = [];
  for (const s of AMC_STAGES) { const n = due.filter(x => x.i.stage === s).length; if (n) parts.push(`<b>${n}</b> within ${s} days`); }
  if (expired.length) parts.push(`<b>${expired.length}</b> expired`);
  el.innerHTML = `<span>${icon('clock')}</span><span>AMC reminders due: ${parts.join(' · ')}. Send the reminder and mark it done.</span><button type="button" class="btn sm" data-view-amc>Open AMC</button>`;
  el.hidden = false;
}

function bindAmc() {
  const view = $('#view-amc');
  if (!view) return;
  $('#amcSearch').addEventListener('input', e => { amcView.q = e.target.value; renderAmc(); });
  document.addEventListener('click', e => { if (e.target.closest('[data-view-amc]')) { showView('amc'); window.scrollTo(0, 0); } });
  view.addEventListener('click', async e => {
    const rt = e.target.closest('#amcRegionTabs button[data-region]');
    if (rt) { amcView.region = rt.dataset.region; renderAmc(); return; }
    const ft = e.target.closest('button[data-af]');
    if (ft) { amcView.filter = ft.dataset.af; renderAmc(); return; }
    if (e.target.closest('[data-new-amc]')) { if (await confirmDiscard()) { openDoc(newDoc('amc')); showView('editor'); window.scrollTo(0, 0); } return; }
    const row = e.target.closest('tr[data-id]');
    if (!row || e.target.closest('select, a')) return;
    const d = docs.find(x => x.id === row.dataset.id);
    if (!d) return;
    const b = e.target.closest('[data-amc-act]');
    const act = b ? b.dataset.amcAct : 'open';
    if (act === 'pdf') { b.disabled = true; b.classList.add('busy'); await exportPdf(clone(d)); b.disabled = false; b.classList.remove('busy'); return; }
    if (act === 'reminded') {
      const stage = Number(b.dataset.stage);
      d.amcReminded = [...new Set([...(d.amcReminded || []), stage])];
      addHistory(d, 'reminder', { by: (USER && USER.displayName) || '', note: `${stage}-day AMC reminder sent` });
      commitDoc(d); Store.set('dc_docs', docs); renderAmc(); renderAmcBanner(); remotePutDoc(d);
      toast(`${stage}-day reminder marked as sent`);
      return;
    }
    if (!(await confirmDiscard())) return;
    if (act === 'renew') { openDoc(renewAmc(d), true); showView('editor'); window.scrollTo(0, 0); toast(`Next year's AMC letter made from ${d.number} – review and Save`); return; }
    openDoc(clone(d)); showView('editor'); window.scrollTo(0, 0);
  });
  view.addEventListener('change', e => {
    const sel = e.target.closest('select[data-amc-status]');
    if (!sel) return;
    const d = docs.find(x => x.id === sel.closest('tr').dataset.id);
    if (!d || !canEdit(d)) return;
    d.status = sel.value;
    addHistory(d, 'status', { by: (USER && USER.displayName) || '', status: d.status });
    commitDoc(d); Store.set('dc_docs', docs); remotePutDoc(d); renderAmc(); renderAmcBanner();
    toast(`${d.number} marked ${d.status}`);
  });
  view.addEventListener('keydown', e => { if (e.key === 'Enter' && e.target.matches('tr[data-id]')) e.target.click(); });
}

/** Next year's letter: same party and software, the period rolls on from the old end date. */
function renewAmc(old) {
  const d = copyAsNew(old, 'amc');
  const from = addDaysISO(old.amc.to, 1);
  d.amc = { ...clone(old.amc), from, to: addYearISO(from) };
  d.amcReminded = [];
  d.renewsId = old.id;
  d.status = 'Pending';
  d.advance = 0; d.payments = [];
  syncAmcItems(d);
  return d;
}
