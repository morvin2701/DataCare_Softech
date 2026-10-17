'use strict';
/* Builds the printable A4 pages for a quotation / invoice and paginates them. */

const PIN_SVG = `<svg class="pin" viewBox="0 0 24 32" width="22" height="30"><path d="M12 0C5.4 0 0 5.2 0 11.7 0 20.4 12 32 12 32s12-11.6 12-20.3C24 5.2 18.6 0 12 0z" fill="#E8483F"/><circle cx="12" cy="11.5" r="4.6" fill="#fff" opacity=".9"/></svg>`;

const LOGO_MARK_SVG = `<svg class="mark" viewBox="0 0 60 60" width="78" height="78">
  <g fill="none" stroke-width="9" stroke-linecap="butt" stroke-linejoin="round">
    <path d="M25 3 V17 Q25 25 17 25 H2" stroke="#E53935"/>
    <path d="M35 3 V17 Q35 25 43 25 H58" stroke="#3FA34D"/>
    <path d="M2 35 H17 Q25 35 25 43 V57" stroke="#F7B82E"/>
    <path d="M58 35 H43 Q35 35 35 43 V57" stroke="#2AA7E0"/>
  </g></svg>`;

const svgImg = (cls, w, h, body) =>
  `<img class="${cls}" width="${w}" height="${h}" alt="" src="data:image/svg+xml;charset=utf-8,${encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">${body}</svg>`)}">`;

// Decorations are <img> (SVG data URIs) so they render identically on screen, in print and in the PDF export.
const DECOR_TOP = svgImg('decor-top', 794, 230, `
  <polyline points="-14,-24 122,90 -14,206" fill="none" stroke="#F28C28" stroke-width="44"/>
  <polyline points="-10,8 82,90 -10,170" fill="none" stroke="#8CC4EA" stroke-width="2"/>
  <polygon points="122,0 196,0 159,36" fill="#1B75BB"/>
  <polygon points="214,26 236,0 250,0 228,26" fill="#8CC4EA"/>
  <polygon points="236,26 258,0 276,0 254,26" fill="#1B75BB"/>
  <rect x="266" y="11" width="528" height="15" fill="#F28C28"/>`);

const DECOR_BOTTOM = svgImg('decor-bottom', 794, 200, `
  <rect x="22" y="160" width="610" height="17" fill="#F28C28"/>
  <polygon points="638,177 658,160 672,160 652,177" fill="#8CC4EA"/>
  <polygon points="660,177 680,160 700,160 680,177" fill="#1B75BB"/>
  <polygon points="708,177 744,142 780,177" fill="#1B75BB"/>
  <polyline points="830,36 730,110 830,184" fill="none" stroke="#F28C28" stroke-width="40"/>
  <polyline points="830,68 772,110 830,152" fill="none" stroke="#8CC4EA" stroke-width="2"/>`);

/** 'UAE' for +971 numbers, 'IN' for +91 numbers, otherwise null. */
function phoneRegion(phone) {
  const d = String(phone || '').replace(/\D/g, '');
  if (d.startsWith('971')) return 'UAE';
  if (d.startsWith('91')) return 'IN';
  return null;
}

/** The two numbers printed on the header: the issuing branch's, then the chosen second number.
    The second number's label follows its country code, so two UAE numbers both read "UAE". */
function headerContacts(d, S) {
  const own = S.branches[d.branch];
  const otherBr = d.branch === 'UAE' ? 'IN' : 'UAE';
  const phone2 = (S.headerContact2 && S.headerContact2.phone) || S.branches[otherBr].phone;
  const r2 = phoneRegion(phone2);
  return [
    { label: own.label, phone: own.phone },
    { label: r2 ? S.branches[r2].label : S.branches[otherBr].label, phone: phone2 }
  ];
}

/** A fully paid invoice: nothing is payable any more, so the documents say "Paid" instead of "Payable". */
const isPaidInvoice = d => d.type === 'invoice' && d.status === 'Paid';

/* ---------- QR code ----------
   Drawn onto a canvas and embedded as a PNG. (A size-less SVG shows on screen and in print, but comes out
   blank in the PDF download, whose renderer needs an image with real pixel dimensions.) */
const _qrCache = {};
function qrImg(text, cls) {
  if (typeof qrcode !== 'function' || !text) return '';
  if (!_qrCache[text]) {
    const q = qrcode(0, 'M'); q.addData(text); q.make();
    const n = q.getModuleCount();
    const quiet = 2, scale = 12;                       // 12 px per module keeps it sharp when printed
    const size = (n + quiet * 2) * scale;
    const c = document.createElement('canvas');
    c.width = c.height = size;
    const g = c.getContext('2d');
    g.fillStyle = '#ffffff'; g.fillRect(0, 0, size, size);
    g.fillStyle = '#1B2A4A';
    for (let r = 0; r < n; r++) for (let col = 0; col < n; col++) {
      if (q.isDark(r, col)) g.fillRect((col + quiet) * scale, (r + quiet) * scale, scale, scale);
    }
    _qrCache[text] = { src: c.toDataURL('image/png'), size };
  }
  const { src, size } = _qrCache[text];
  return `<img class="${cls}" src="${src}" width="${size}" height="${size}" alt="QR code">`;
}

/**
 * What the "payment received / support / QR" section shows, for both designs.
 * - payment: only on invoices that are Paid (or Partially Paid with an advance)
 * - support + qr: when "Show support details & QR code" is on (default: invoices)
 */
function infoSection(d, S) {
  const T = docTotals(d);
  const pay = d.payment || {};
  let payment = null;
  if (isPaidInvoice(d)) payment = { title: 'Payment Received', amount: T.total, note: 'Paid in full. Thank you for your payment.' };
  else if (d.type === 'invoice' && d.status === 'Partially Paid' && T.adv) payment = { title: 'Advance Received', amount: T.adv, balance: T.balance };
  if (payment) Object.assign(payment, { date: pay.date || '', mode: pay.mode || '', ref: pay.ref || '' });

  const on = d.showSupport === undefined ? d.type === 'invoice' : !!d.showSupport;
  let support = null, qr = null;
  if (on) {
    const sup = S.support || {};
    const phone = (sup.phone || '').trim() || S.branches[d.branch].phone;
    const whatsapp = (sup.whatsapp || '').trim() || phone;
    support = { phone, whatsapp, hours: (sup.hours || '').trim(), email: (S.email || '').trim() };
    const target = S.qrTarget || 'whatsapp';
    const waDigits = whatsapp.replace(/\D/g, '');
    const site = (S.website || '').trim();
    if (target === 'whatsapp' && waDigits) qr = { url: 'https://wa.me/' + waDigits, title: 'Scan to chat', sub: 'WhatsApp support' };
    else if (target === 'website' && site) qr = { url: /^https?:\/\//i.test(site) ? site : 'https://' + site, title: 'Scan to visit', sub: site.replace(/^https?:\/\//i, '') };
  }
  return payment || support ? { payment, support, qr } : null;
}

/* ---------- software versions + comparison list ---------- */
const editionList = S => (S.editions || []).map(e => String(e || '').trim()).filter(Boolean);
const showEditionsOn = d => d.showEditions !== false;

/** Columns, groups and rows of the comparison list for one document (respecting its on/off choices). */
/** A document's own copy of the list (made with "Edit list for this quotation"), else the team default. */
function compSource(d, S) {
  return d.compCustom && Array.isArray(d.compCustom.groups)
    ? { editions: d.compCustom.editions || [], groups: d.compCustom.groups, custom: true }
    : { editions: S.editions || [], groups: S.comparison || [], custom: false };
}

function comparisonModel(d, S) {
  const src = compSource(d, S);
  const eds = src.editions.map(e => String(e || '').trim());
  const hideCols = new Set(d.compHideCols || []), hideRows = new Set(d.compHideRows || []);
  const cols = eds.map((name, i) => ({ name, i })).filter(c => c.name && !hideCols.has(c.name));
  let n = 0;
  const groups = src.groups.map(g => {
    const rows = [];
    for (const r of g.rows || []) {
      if (!String(r.name || '').trim() || hideRows.has(r.id)) continue;
      rows.push({ ...r, num: g.numbered === false ? '' : ++n });
    }
    return { ...g, rows };
  }).filter(g => g.rows.length);
  return { cols, groups, chosen: d.edition || '' };
}

/** One comparison cell: √ / X / + become symbols, anything else is shown as typed. */
function compCell(v) {
  const t = String(v ?? '').trim();
  if (t === '√' || /^v$/i.test(t)) return { cls: 'ok', html: '✓' };
  if (/^x$/i.test(t)) return { cls: 'no', html: '✗' };
  if (t === '+') return { cls: 'add', html: '+' };
  if (!t) return { cls: 'na', html: '–' };
  return { cls: 'txt', html: esc(t) };
}

/** Splits each group into small chunks so groups can continue across pages.
    first: chunk starts the group (has the heading row); last: chunk ends the group. */
function comparisonChunks(model, size = 5) {
  const out = [];
  for (const g of model.groups) for (let i = 0; i < g.rows.length; i += size) {
    out.push({ group: g, rows: g.rows.slice(i, i + size), first: i === 0, last: i + size >= g.rows.length });
  }
  return out;
}

function docTotals(d) {
  const sub = round2(d.items.reduce((s, it) => s + (Number(it.amount) || 0), 0));
  const disc = Math.min(round2(d.discount), sub);
  const taxable = round2(sub - disc);
  const tax = d.taxEnabled ? round2(taxable * (Number(d.taxRate) || 0) / 100) : 0;
  const total = round2(taxable + tax);
  const adv = round2(d.advance);
  return { sub, disc, tax, total, adv, balance: round2(total - adv) };
}

/** Splits "Title: text" into its two parts; lines without a short title return { title: '' }. */
function splitTitled(line) {
  const m = /^([^:]{2,34}):\s+(.+)$/.exec(String(line || '').trim());
  return m ? { title: m[1], text: m[2] } : { title: '', text: String(line || '').trim() };
}

function renderTerm(text, amc) {
  return esc(text).replace(/\{AMC\}/g, `<b><u>${Number(amc || 0).toFixed(2)} %</u></b>`);
}

function checkbox(on) {
  return `<span class="cb${on ? ' on' : ''}">${on ? '✓' : ''}</span>`;
}

function headerHTML(d, S) {
  const [own, other] = headerContacts(d, S);
  const contact = b => `<div class="ct">${PIN_SVG}<div><b>${esc(b.label)}</b><br><b>${esc(b.phone)}</b></div></div>`;
  const full = S.logo && S.logoHasName;
  const mark = S.logo ? `<img class="mark-img" src="${S.logo}" alt="">` : LOGO_MARK_SVG;
  const brand = full
    ? `<img class="logo-img" src="${S.logo}" alt="">`
    : `<div class="brand-row">${mark}<div class="brand-text">${brandText(S.companyName)}</div></div>`;
  return `${DECOR_TOP}
    <div class="pg-brand${full ? ' has-img' : ''}">
      ${brand}
      <div class="contact-row">
        ${contact(own)}
        <div class="web"><span class="sq"></span>${esc(S.website)}</div>
        ${contact(other)}
      </div>
    </div>`;
}

/** "Data Care Softech" -> big coloured first words, smaller last word, red initials. */
function brandText(name) {
  const words = String(name || '').trim().split(/\s+/);
  const last = words.length > 1 ? words.pop() : '';
  const big = words.map(w => `<span class="r">${esc(w)}</span>`).join(' ');
  const small = last ? ` <span class="small"><span class="r">${esc(last[0])}</span>${esc(last.slice(1))}</span>` : '';
  return big + small;
}

function footerHTML(d, S) {
  const b = S.branches[d.branch];
  const bits = [S.legalName, b.address, b.taxId ? `${b.taxLabel === 'GST' ? 'GSTIN' : 'TRN'}: ${b.taxId}` : '', S.email]
    .filter(Boolean).map(esc).join('  ·  ');
  return `${DECOR_BOTTOM}
    ${S.showFooterLine && bits ? `<div class="foot-line">${bits}</div>` : ''}
    <div class="pg-num">Page <b class="pn"></b> of <b class="pt"></b></div>`;
}

/** Returns the flowing body blocks, in order. */
function buildBlocks(d, S) {
  const isInv = d.type === 'invoice';
  const cur = d.currency;
  const c = d.customer;
  const T = docTotals(d);
  const regionLabel = /^(uae|u\.a\.e\.?|united arab emirates)$/i.test((c.country || '').trim()) ? 'Emirate' : 'City';
  const blocks = [];
  const add = (html, opts = {}) => blocks.push({ html, ...opts });

  // Title row: number | title | date
  add(`<div class="d-title">
      <div>${d.number ? `<div class="box">${isInv ? 'Inv' : 'Quot'} No: ${esc(d.number)}</div>` : ''}</div>
      <h1>${isInv ? 'Invoice' : 'Quotation'}${isPaidInvoice(d) ? ' <span class="paid-tag">PAID</span>' : ''}</h1>
      <div class="right"><div class="box">Date:&nbsp;&nbsp; ${esc(fmtDate(d.date))}</div></div>
    </div>
    <p class="intro${isInv ? ' b' : ''}">${isInv
      ? 'We are going to book the order as per following details confirmed by you:'
      : 'We are going to quote as per following details confirmed by you:'}</p>`);

  // Customer details
  const extra = [];
  if (c.email) extra.push(`Email: ${esc(c.email)}`);
  if (c.taxId) extra.push(`${regionLabel === 'Emirate' ? 'TRN' : 'GSTIN / Tax No'}: ${esc(c.taxId)}`);
  add(`<table class="cust">
      <tr><td colspan="3">Company Name:&nbsp; ${esc(c.company)}</td></tr>
      <tr><td colspan="3">Contact Person:&nbsp; ${esc(c.contact)}</td></tr>
      <tr><td colspan="3">Address:&nbsp; ${esc(c.address)}</td></tr>
      ${extra.length ? `<tr><td colspan="3">${extra.join('&nbsp;&nbsp;&nbsp;|&nbsp;&nbsp;&nbsp;')}</td></tr>` : ''}
      <tr><td class="w33">${regionLabel}:&nbsp; ${esc(c.city)}</td><td class="w33">Country:&nbsp; ${esc(c.country)}</td><td>Mobile No:&nbsp; ${esc(c.mobile)}</td></tr>
    </table>`);

  const custType = `<span class="ctype">${checkbox(d.customerType === 'existing')} Existing Customer
      &nbsp;&nbsp; ${checkbox(d.customerType === 'new')} New Customer</span>`;

  const eds = showEditionsOn(d) ? editionList(S) : [];
  const edRow = eds.length ? `<table class="ver eds"><tr><td class="prod">${esc(d.softwareVersion)}</td>${eds.map(e =>
    `<td class="${e === d.edition ? 'on' : ''}">${checkbox(e === d.edition)} ${esc(e)}</td>`).join('')}</tr></table>` : '';
  if (d.showVersion) {
    add(`<h3 class="sec-h">Software Version:</h3>
      <div class="ctype-row">${custType}</div>
      ${edRow || `<table class="ver"><tr><td>${esc(d.softwareVersion)}${d.edition ? ' ' + esc(d.edition) : ''}</td><td></td><td></td></tr></table>`}`);
    add(`<h3 class="sec-h">Order Details are as per under:</h3>`, { keepWithNext: true });
  } else {
    if (eds.length) add(`<table class="ver eds one"><tr><td class="prod">Software Version:<br><b>${esc(d.softwareVersion)}</b></td>${eds.map(e =>
      `<td class="${e === d.edition ? 'on' : ''}">${checkbox(e === d.edition)} ${esc(e)}</td>`).join('')}</tr></table>`);
    add(`<h3 class="sec-h inline"><span>Order Details are as per under:</span></h3>${custType}`, { keepWithNext: true, cls: 'order-h' });
  }

  // Items table
  const rows = d.items.filter(it => it.desc || Number(it.amount))
    .map(it => `<tr><td>${esc(it.desc)}</td><td class="amt">${fmtMoney(it.amount, cur)}</td></tr>`).join('');
  let tot = '';
  if (T.disc || d.taxEnabled) {
    tot += `<tr class="sub"><td>Sub Total:</td><td class="amt">${fmtMoney(T.sub, cur)}</td></tr>`;
    if (T.disc) tot += `<tr class="sub"><td>Less: Discount:</td><td class="amt">- ${fmtMoney(T.disc, cur)}</td></tr>`;
    if (d.taxEnabled) tot += `<tr class="sub"><td>${esc(d.taxLabel)} @ ${Number(d.taxRate) || 0}%:</td><td class="amt">${fmtMoney(T.tax, cur)}</td></tr>`;
  }
  const paidInFull = isPaidInvoice(d);
  if (paidInFull) {
    tot += `<tr class="total"><td>Total Paid Amount:</td><td class="amt">${fmtMoney(T.total, cur)}</td></tr>`;
    tot += `<tr class="sub"><td>Balance Due:</td><td class="amt">Nil</td></tr>`;
  } else {
    tot += `<tr class="total"><td>Total Payable Amount:</td><td class="amt">${fmtMoney(T.total, cur)}</td></tr>`;
    if (T.adv) {
      tot += `<tr class="sub"><td>Advance Received:</td><td class="amt">${fmtMoney(T.adv, cur)}</td></tr>`;
      tot += `<tr class="total"><td>Balance Due:</td><td class="amt">${fmtMoney(T.balance, cur)}</td></tr>`;
    }
  }
  add(`<table class="items">
      <thead><tr><th>Description</th><th class="amt">Price (${esc(cur)})</th></tr></thead>
      <tbody>${rows || '<tr><td>&nbsp;</td><td></td></tr>'}${tot}</tbody>
    </table>
    ${d.showWords ? `<p class="words"><b>Amount in words:</b> ${esc(amountInWords(paidInFull || !T.adv ? T.total : T.balance, cur))}</p>` : ''}`);

  if (d.notes && d.notes.trim()) {
    add(`<div class="notes"><b>Note:</b> ${esc(d.notes).replace(/\n/g, '<br>')}</div>`);
  }

  // Bulleted sections: heading is glued to its first bullet so it never ends a page alone.
  const bullets = (title, list, opts = {}) => {
    const items = list.filter(t => t && t.trim());
    if (!items.length) return;
    items.forEach((t, i) => {
      const li = `<div class="bl">${renderTerm(t, d.amcPercent)}</div>`;
      add(i === 0 ? `<h3 class="sec-h">${title}</h3>${li}` : li, i === 0 ? opts : {});
    });
  };
  if (d.showHardware) {
    (d.hardware || []).filter(t => t && t.trim()).forEach((t, i) => {
      const h = splitTitled(t);
      const li = `<div class="bl">${h.title ? `<b>${esc(h.title)}:</b> ` : ''}${esc(h.text)}</div>`;
      add(i === 0 ? `<h3 class="sec-h">Hardware Configuration:</h3>${li}` : li);
    });
  }

  // Payment received / support / QR code
  const info = infoSection(d, S);
  if (info) {
    const row = (k, v) => (v ? `<div><span>${k}:</span> ${esc(v)}</div>` : '');
    const cells = [];
    if (info.payment) cells.push(`<td><b class="info-h paid">${info.payment.title}</b>
        ${row('Amount', `${cur} ${fmtMoney(info.payment.amount, cur)}`)}${row('Date', fmtDate(info.payment.date))}${row('Mode', info.payment.mode)}${row('Reference', info.payment.ref)}
        ${info.payment.balance !== undefined ? row('Balance due', `${cur} ${fmtMoney(info.payment.balance, cur)}`) : '<div class="info-note">Paid in full.</div>'}</td>`);
    if (info.support) cells.push(`<td><b class="info-h">Support</b>
        ${row('Phone', info.support.phone)}${info.support.whatsapp !== info.support.phone ? row('WhatsApp', info.support.whatsapp) : ''}${row('Email', info.support.email)}${row('Hours', info.support.hours)}</td>`);
    if (info.qr) cells.push(`<td class="info-qr">${qrImg(info.qr.url, 'qr')}<div><b>${esc(info.qr.title)}</b><br>${esc(info.qr.sub)}</div></td>`);
    add(`<table class="info"><tr>${cells.join('')}</tr></table>`, { preferFirst: true });
  }

  bullets('Our Terms &amp; Conditions:', d.terms, { breakBefore: d.termsNewPage });

  // Prepared by
  add(`<div class="prep">
      <div>Prepared By: ${esc(d.preparedBy)}</div>
      <div>Mobile: ${esc(d.preparedMobile)}</div>
    </div>
    ${d.showStamp && S.stamp ? `<div class="stamp-wrap"><img class="stamp" src="${S.stamp}" alt=""><div class="stamp-cap">For ${esc(S.legalName)}</div></div>` : ''}`, d.type === 'quotation' ? { preferFirst: true } : {});

  if (d.showAcceptance) {
    add(`<div class="accept">
        <p>Read and accepted above mentioned all the terms and conditions.</p>
        <div class="sign-space"></div>
        <div class="sign-line">Customer Signature &amp; Stamp</div>
      </div>`);
  }

  // Version comparison list (attachment, starts on a new page)
  if (d.showComparison) {
    const m = comparisonModel(d, S);
    if (m.cols.length && m.groups.length) {
      add(`<h1 class="comp-title">Version Comparison – ${esc(d.softwareVersion)}</h1>
        <p class="comp-sub">${m.chosen ? `Chosen version: <b>${esc(m.chosen)}</b> &nbsp;·&nbsp; ` : ''}√ included &nbsp; X not included &nbsp; + add-on (chargeable)</p>`, { forceBreak: true });
      const head = (ch, cont) => `<tr class="gh"><th class="f">${esc(ch.group.name)}${cont ? ' (cont.)' : ''}</th>${m.cols.map(c => `<th class="${c.name === m.chosen ? 'on' : ''}">${esc(c.name)}</th>`).join('')}</tr>`;
      const body = ch => ch.rows.map(r => `<tr><td class="f">${r.num ? `<span class="n">${r.num}</span>` : ''}${esc(r.name)}</td>${m.cols.map(c => { const x = compCell(r.values[c.i]); return `<td class="${x.cls}${c.name === m.chosen ? ' on' : ''}">${x.html}</td>`; }).join('')}</tr>`).join('');
      for (const ch of comparisonChunks(m)) {
        const cls = `comp${ch.first ? '' : ' join'}${ch.last ? '' : ' open'}`;
        add(`<table class="${cls}">${ch.first ? head(ch, false) : ''}${body(ch)}</table>`,
          ch.first ? {} : { contHtml: `<table class="comp${ch.last ? '' : ' open'}">${head(ch, true)}${body(ch)}</table>` });
      }
    }
  }
  return blocks;
}

function newPageEl(d, S) {
  const page = document.createElement('div');
  page.className = `page doc-${d.type}`;
  page.style.setProperty('--accent', S.accent || '#E8772E');
  page.innerHTML = `<div class="pg-head">${headerHTML(d, S)}</div><div class="pg-body"></div><div class="pg-foot">${footerHTML(d, S)}</div>`;
  return page;
}

/**
 * Lays out the document into A4 pages inside `container` (which must be rendered,
 * i.e. not display:none, so heights can be measured).
 */
function renderPages(d, S, container) {
  const premium = S.template !== 'classic';
  const blocks = premium ? buildBlocksPremium(d, S) : buildBlocks(d, S);

  /** Lays the blocks out. Returns false when a block that belongs on page 1 (preferFirst) did not fit there. */
  const layout = tight => {
    container.innerHTML = '';
    let page, body, firstPageOk = true;
    const next = () => {
      page = premium ? newPagePremium(d, S, container.children.length) : newPageEl(d, S);
      page.classList.toggle('fit-tight', tight);
      container.appendChild(page);
      if (premium) fitContacts(page);
      body = page.querySelector('.pg-body');
    };
    const overflows = () => body.scrollHeight > body.clientHeight + 1;
    next();

    for (let i = 0; i < blocks.length; i++) {
      const b = blocks[i];
      // "Start on a new page" keeps page 1 free of terms. If earlier content already ran onto page 2,
      // the terms simply follow it there instead of leaving that page almost empty.
      if (b.breakBefore && body.children.length && container.children.length === 1) next();
      if (b.forceBreak && body.children.length) next();   // attachments such as the comparison list

      const group = [b];
      // keep headings with the following block
      while (group[group.length - 1].keepWithNext && blocks[i + group.length]) group.push(blocks[i + group.length]);

      const els = group.map(g => {
        const el = document.createElement('div');
        el.className = 'blk' + (g.cls ? ' ' + g.cls : '');
        el.innerHTML = g.html;
        return el;
      });
      els.forEach(el => body.appendChild(el));
      if (overflows() && body.children.length > els.length) {
        els.forEach(el => el.remove());
        next();
        // a block that continues something (e.g. a comparison group) gets its heading back at the top of the page
        group.forEach((g, k) => { if (g.contHtml) els[k].innerHTML = g.contHtml; });
        els.forEach(el => body.appendChild(el));
      }
      if (group.some(g => g.preferFirst) && container.children.length > 1) firstPageOk = false;
      i += group.length - 1;
    }
    return { ok: firstPageOk, pages: container.children.length };
  };

  // Normal spacing first. If that pushes the page-1 info row onto page 2 (leaving a gap at the bottom of
  // page 1), try slightly tighter spacing, and keep it only when it brings the row back or saves a page.
  const normal = layout(false);
  if (!normal.ok) {
    const tight = layout(true);
    if (!tight.ok && tight.pages >= normal.pages) layout(false);
  }

  const pages = container.querySelectorAll('.page');
  pages.forEach((p, i) => {
    p.querySelector('.pn').textContent = i + 1;
    p.querySelector('.pt').textContent = pages.length;
  });
  return pages.length;
}
