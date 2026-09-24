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

function docTotals(d) {
  const sub = round2(d.items.reduce((s, it) => s + (Number(it.amount) || 0), 0));
  const disc = Math.min(round2(d.discount), sub);
  const taxable = round2(sub - disc);
  const tax = d.taxEnabled ? round2(taxable * (Number(d.taxRate) || 0) / 100) : 0;
  const total = round2(taxable + tax);
  const adv = round2(d.advance);
  return { sub, disc, tax, total, adv, balance: round2(total - adv) };
}

function renderTerm(text, amc) {
  return esc(text).replace(/\{AMC\}/g, `<b><u>${Number(amc || 0).toFixed(2)} %</u></b>`);
}

function checkbox(on) {
  return `<span class="cb${on ? ' on' : ''}">${on ? '✓' : ''}</span>`;
}

function headerHTML(d, S) {
  const own = S.branches[d.branch];
  const other = S.branches[d.branch === 'UAE' ? 'IN' : 'UAE'];
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
      <h1>${isInv ? 'Invoice' : 'Quotation'}</h1>
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

  if (d.showVersion) {
    add(`<h3 class="sec-h">Software Version:</h3>
      <div class="ctype-row">${custType}</div>
      <table class="ver"><tr><td>${esc(d.softwareVersion)}</td><td></td><td></td></tr></table>`);
    add(`<h3 class="sec-h">Order Details are as per under:</h3>`, { keepWithNext: true });
  } else {
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
  tot += `<tr class="total"><td>Total Payable Amount:</td><td class="amt">${fmtMoney(T.total, cur)}</td></tr>`;
  if (T.adv) {
    tot += `<tr class="sub"><td>Advance Received:</td><td class="amt">${fmtMoney(T.adv, cur)}</td></tr>`;
    tot += `<tr class="total"><td>Balance Due:</td><td class="amt">${fmtMoney(T.balance, cur)}</td></tr>`;
  }
  add(`<table class="items">
      <thead><tr><th>Description</th><th class="amt">Price (${esc(cur)})</th></tr></thead>
      <tbody>${rows || '<tr><td>&nbsp;</td><td></td></tr>'}${tot}</tbody>
    </table>
    ${d.showWords ? `<p class="words"><b>Amount in words:</b> ${esc(amountInWords(T.adv ? T.balance : T.total, cur))}</p>` : ''}`);

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
  if (d.showHardware) bullets('Hardware Configuration:', d.hardware);
  bullets('Our Terms &amp; Conditions:', d.terms, { breakBefore: d.termsNewPage });

  // Prepared by
  add(`<div class="prep">
      <div>Prepared By: ${esc(d.preparedBy)}</div>
      <div>Mobile: ${esc(d.preparedMobile)}</div>
    </div>
    ${d.showStamp && S.stamp ? `<div class="stamp-wrap"><img class="stamp" src="${S.stamp}" alt=""><div class="stamp-cap">For ${esc(S.legalName)}</div></div>` : ''}`);

  if (d.showAcceptance) {
    add(`<div class="accept">
        <p>Read and accepted above mentioned all the terms and conditions.</p>
        <div class="sign-space"></div>
        <div class="sign-line">Customer Signature &amp; Stamp</div>
      </div>`);
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
  container.innerHTML = '';
  const premium = S.template !== 'classic';
  const blocks = premium ? buildBlocksPremium(d, S) : buildBlocks(d, S);
  let page, body;
  const next = () => {
    page = premium ? newPagePremium(d, S, container.children.length) : newPageEl(d, S);
    container.appendChild(page);
    if (premium) fitContacts(page);
    body = page.querySelector('.pg-body');
  };
  const overflows = () => body.scrollHeight > body.clientHeight + 1;
  next();

  for (let i = 0; i < blocks.length; i++) {
    const b = blocks[i];
    if (b.breakBefore && body.children.length) next();

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
      els.forEach(el => body.appendChild(el));
    }
    i += group.length - 1;
  }

  const pages = container.querySelectorAll('.page');
  pages.forEach((p, i) => {
    p.querySelector('.pn').textContent = i + 1;
    p.querySelector('.pt').textContent = pages.length;
  });
  return pages.length;
}
