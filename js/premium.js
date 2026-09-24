'use strict';
/* "Premium" document design. Uses the same block/pagination engine as the classic design (document.js). */

const P_ICON = {
  pin: svgImg('p-ic', 28, 28, `<circle cx="14" cy="14" r="14" fill="#FFF1E6"/>
    <path d="M14 6.8c-2.8 0-5 2.2-5 4.9 0 3.7 5 9.3 5 9.3s5-5.6 5-9.3c0-2.7-2.2-4.9-5-4.9z" fill="#F28C28"/>
    <circle cx="14" cy="11.8" r="1.9" fill="#fff"/>`),
  web: svgImg('p-ic', 28, 28, `<circle cx="14" cy="14" r="14" fill="#E8F2FB"/>
    <g fill="none" stroke="#1B75BB" stroke-width="1.5"><circle cx="14" cy="14" r="6.5"/><ellipse cx="14" cy="14" rx="2.8" ry="6.5"/><path d="M7.5 14h13"/></g>`),
  mail: svgImg('p-ic', 28, 28, `<circle cx="14" cy="14" r="14" fill="#E8F2FB"/>
    <g fill="none" stroke="#1B75BB" stroke-width="1.5" stroke-linejoin="round"><rect x="7.5" y="9.5" width="13" height="9.5" rx="1.6"/><path d="M8 10.4l6 4.4 6-4.4"/></g>`),
  check: svgImg('p-chk', 16, 16, `<circle cx="8" cy="8" r="8" fill="#1B75BB"/>
    <path d="M4.6 8.3l2.2 2.2 4.5-4.7" fill="none" stroke="#fff" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>`)
};

const P_STRIP_TOP = svgImg('p-strip top', 794, 8, `<rect width="794" height="8" fill="#F28C28"/>
  <polygon points="560,0 578,0 570,8 552,8" fill="#8CC4EA"/><polygon points="578,0 794,0 794,8 570,8" fill="#1B75BB"/>`);
const P_STRIP_BOTTOM = svgImg('p-strip bottom', 794, 8, `<rect width="794" height="8" fill="#1B75BB"/>
  <polygon points="224,0 242,0 234,8 216,8" fill="#8CC4EA"/><polygon points="242,0 794,0 794,8 234,8" fill="#F28C28"/>`);
const P_WATERMARK = svgImg('p-wm', 320, 340, `
  <polyline points="340,10 170,170 340,330" fill="none" stroke="#F28C28" stroke-width="52" opacity=".07"/>
  <polyline points="340,74 238,170 340,266" fill="none" stroke="#1B75BB" stroke-width="3" opacity=".14"/>`);

const pMoney = (n, cur) => round2(n).toLocaleString((CURRENCIES[cur] || CURRENCIES.AED).locale,
  { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** Logo mark: uploaded image, or the drawn four-colour mark. */
function brandMark(S, size) {
  return S.logo
    ? `<img class="p-mark" src="${S.logo}" style="height:${size}px" alt="">`
    : LOGO_MARK_SVG.replace('width="78" height="78"', `width="${size}" height="${size}"`);
}
/** "Data Care Softech" -> "Data Care" + accented "Softech". */
function brandName(S) {
  const w = String(S.companyName || '').trim().split(/\s+/);
  const last = w.length > 1 ? w.pop() : '';
  return `<span>${esc(w.join(' '))}</span>${last ? ` <span class="acc">${esc(last)}</span>` : ''}`;
}

function premiumHeader(d, S, first) {
  const isInv = d.type === 'invoice';
  const title = isInv ? 'Invoice' : 'Quotation';
  const brand = S.logo && S.logoHasName
    ? `<img class="p-logo-full${first ? '' : ' sm'}" src="${S.logo}" alt="">`
    : `<div class="p-brand">${brandMark(S, first ? 64 : 36)}
         <div><div class="p-name">${brandName(S)}</div>${first ? `<div class="p-legal">${esc(S.legalName)}</div>` : ''}</div>
       </div>`;

  if (!first) {
    return `${P_STRIP_TOP}<div class="p-head small">${brand}
      <div class="p-doc-s"><b>${title}</b><span>${esc(d.number)}</span></div></div>`;
  }
  const [own, other] = headerContacts(d, S);
  const ct = (icon, label, value) => value
    ? `<div class="p-ct">${icon}<div><small>${esc(label)}</small><b>${esc(value)}</b></div></div>` : '';
  const paid = isInv && d.status === 'Paid' ? '<div class="p-paid">Paid</div>' : '';
  return `${P_STRIP_TOP}
    <div class="p-head">
      ${brand}
      <div class="p-doc">
        <div class="p-title">${title}</div>
        <div class="p-meta">
          <span>${title} No.</span><b>${esc(d.number)}</b>
          <span>Date</span><b>${esc(fmtDate(d.date))}</b>
        </div>
        ${paid}
      </div>
    </div>
    <div class="p-contacts">
      ${ct(P_ICON.pin, `${own.label} Office`, own.phone)}
      ${ct(P_ICON.pin, `${other.label} Office`, other.phone)}
      ${ct(P_ICON.web, 'Website', S.website)}
      ${ct(P_ICON.mail, 'Email', S.email)}
    </div>`;
}

function premiumFooter(d, S) {
  const b = S.branches[d.branch];
  const bits = [S.legalName, b.address, b.taxId ? `${b.taxLabel === 'GST' ? 'GSTIN' : 'TRN'}: ${b.taxId}` : '']
    .filter(Boolean).map(esc).join('<i>•</i>');
  return `<div class="p-foot"><span>${S.showFooterLine ? bits : ''}</span>
      <span>Page <b class="pn"></b> of <b class="pt"></b></span></div>${P_STRIP_BOTTOM}`;
}

function newPagePremium(d, S, index) {
  const page = document.createElement('div');
  page.className = `page tpl-premium doc-${d.type}`;
  page.innerHTML = `<div class="pg-head">${premiumHeader(d, S, index === 0)}</div>${P_WATERMARK}
    <div class="pg-body${index === 0 ? ' first' : ''}"></div><div class="pg-foot">${premiumFooter(d, S)}</div>`;
  return page;
}

function buildBlocksPremium(d, S) {
  const isInv = d.type === 'invoice';
  const cur = d.currency;
  const c = d.customer;
  const T = docTotals(d);
  const uae = /^(uae|u\.a\.e\.?|united arab emirates)$/i.test((c.country || '').trim());
  const blocks = [];
  const add = (html, opts = {}) => blocks.push({ html, ...opts });
  const line = (k, v) => (v ? `<div class="p-line">${k ? `<span>${k}</span>` : ''}${esc(v)}</div>` : '');

  // Parties
  const place = [c.city && `${uae ? 'Emirate' : 'City'}: ${c.city}`, c.country && `Country: ${c.country}`].filter(Boolean);
  add(`<p class="p-intro">${isInv
      ? 'We are going to book the order as per following details confirmed by you:'
      : 'We are going to quote as per following details confirmed by you:'}</p>
    <div class="p-parties">
      <div class="p-card">
        <div class="p-label">${isInv ? 'Billed To' : 'Prepared For'}</div>
        <div class="p-company">${esc(c.company) || '&nbsp;'}</div>
        ${line('Contact', c.contact)}
        ${line('', c.address)}
        ${place.length ? `<div class="p-line">${place.map(esc).join('<i>•</i>')}</div>` : ''}
        ${line('Mobile', c.mobile)}
        ${line('Email', c.email)}
        ${line(uae ? 'TRN' : 'GSTIN', c.taxId)}
      </div>
      <div class="p-card alt">
        <div class="p-label">Order Details</div>
        <div class="p-kv">
          <span>Customer</span><b><span class="p-pill${d.customerType === 'existing' ? ' blue' : ''}">${d.customerType === 'existing' ? 'Existing Customer' : 'New Customer'}</span></b>
          ${d.showVersion && d.softwareVersion ? `<span>Software</span><b>${esc(d.softwareVersion)}</b>` : ''}
          <span>Prepared by</span><b>${esc(d.preparedBy)}</b>
          <span>Mobile</span><b>${esc(d.preparedMobile)}</b>
          ${d.fromQuotation ? `<span>Quotation Ref.</span><b>${esc(d.fromQuotation)}</b>` : ''}
        </div>
      </div>
    </div>`);

  // Items
  const items = d.items.filter(it => it.desc || Number(it.amount));
  const rows = items.map((it, i) => `<tr><td class="n">${String(i + 1).padStart(2, '0')}</td>
      <td>${esc(it.desc)}</td><td class="a">${pMoney(it.amount, cur)}</td></tr>`).join('')
    || '<tr><td class="n">01</td><td>&nbsp;</td><td class="a"></td></tr>';
  add(`<div class="p-items"><table>
      <thead><tr><th class="n">#</th><th>Description</th><th class="a">Amount (${esc(cur)})</th></tr></thead>
      <tbody>${rows}</tbody></table></div>`);

  // Totals + amount in words
  const tr = (k, v, cls = '') => `<div class="p-tr ${cls}"><span>${k}</span><b>${v}</b></div>`;
  let tot = tr('Sub Total', pMoney(T.sub, cur));
  if (T.disc) tot += tr('Discount', '− ' + pMoney(T.disc, cur));
  if (d.taxEnabled) tot += tr(`${esc(d.taxLabel)} @ ${Number(d.taxRate) || 0}%`, pMoney(T.tax, cur));
  tot += `<div class="p-grand"><span>Total Payable</span><b>${esc(cur)} ${pMoney(T.total, cur)}</b></div>`;
  if (T.adv) {
    tot += tr('Advance Received', '− ' + pMoney(T.adv, cur), 'adv');
    tot += `<div class="p-balance"><span>Balance Due</span><b>${esc(cur)} ${pMoney(T.balance, cur)}</b></div>`;
  }
  const words = d.showWords
    ? `<div class="p-label">Amount in Words</div><div class="p-words-t">${esc(amountInWords(T.adv ? T.balance : T.total, cur))}</div>` : '';
  const notes = d.notes && d.notes.trim()
    ? `<div class="p-label${words ? ' mt' : ''}">Note</div><div class="p-note">${esc(d.notes).replace(/\n/g, '<br>')}</div>` : '';
  add(`<div class="p-sum">
      <div class="p-words${words || notes ? '' : ' empty'}">${words}${notes}</div>
      <div class="p-totals">${tot}</div>
    </div>`);

  // Hardware configuration
  const hw = (d.hardware || []).filter(Boolean);
  if (d.showHardware && hw.length) {
    add(`<div class="p-sec">Hardware Configuration</div>
      <div class="p-hw">${hw.map(t => `<div>${P_ICON.check}<span>${esc(t)}</span></div>`).join('')}</div>`);
  }

  // Terms, in chunks so long lists can flow across pages
  const terms = (d.terms || []).filter(t => t && t.trim());
  const CHUNK = 6;
  for (let i = 0; i < terms.length; i += CHUNK) {
    const html = terms.slice(i, i + CHUNK).map((t, j) =>
      `<div class="p-term"><b>${String(i + j + 1).padStart(2, '0')}</b><span>${renderTerm(t, d.amcPercent)}</span></div>`).join('');
    add(`${i === 0 ? '<div class="p-sec">Terms &amp; Conditions</div>' : ''}<div class="p-terms">${html}</div>`,
      i === 0 ? { breakBefore: d.termsNewPage } : {});
  }

  // Signatures: a compact "prepared by" bar when no signature/stamp is needed (like the original quotation)
  if (!d.showAcceptance && !(d.showStamp && S.stamp)) {
    add(`<div class="p-prep">
        <div><div class="p-label">Prepared By</div><b>${esc(d.preparedBy)}</b><span>${esc(d.preparedMobile)}</span></div>
        <div class="p-thanks">Thank you for choosing ${esc(S.companyName)}!</div>
      </div>`);
    return blocks;
  }
  const stamp = d.showStamp && S.stamp ? `<img class="p-stamp-img" src="${S.stamp}" alt="">` : '';
  const card = (label, desc, space, title, sub) => `
      <div class="p-sigcard">
        <div class="p-label">${label}</div>
        <div class="p-sigdesc">${desc}</div>
        <div class="p-sigbox">${space}</div>
        <div class="p-sigline"></div>
        <div class="p-sigcap"><b>${title}</b><small>${sub}</small></div>
      </div>`;
  const left = card(`For ${esc(S.legalName)}`, 'Issued and authorised on behalf of the company.',
    stamp, 'Authorised Signatory', `${esc(d.preparedBy)} &nbsp;·&nbsp; ${esc(d.preparedMobile)}`);
  const right = d.showAcceptance
    ? card('Customer Acceptance', 'Read and accepted above mentioned all the terms and conditions.',
      '', 'Customer Signature &amp; Stamp', 'Date: &nbsp;____ / ____ / ________')
    : `<div class="p-sigcard thanks">
        <div class="p-thanks">Thank you for choosing ${esc(S.companyName)}!</div>
        <small>For any queries, contact ${esc(d.preparedBy)} on ${esc(d.preparedMobile)}.</small>
      </div>`;
  add(`<div class="p-sign">${left}${right}</div>`);
  return blocks;
}

/** Shrink the contact bar text to fit one line; fall back to a 2 x 2 grid for long details. */
function fitContacts(page) {
  const bar = page.querySelector('.p-contacts');
  if (!bar) return;
  const over = () => bar.scrollWidth > bar.clientWidth + 1;
  for (let fs = 12.5; over() && fs > 11; fs -= 0.5) bar.style.setProperty('--ct-fs', (fs - 0.5) + 'px');
  if (over()) {
    bar.style.removeProperty('--ct-fs');
    bar.classList.add('two-rows');
    page.classList.add('ct2');
  }
}
