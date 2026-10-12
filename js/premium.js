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
  phone: svgImg('p-ic sm', 24, 24, `<circle cx="12" cy="12" r="12" fill="#FFF1E6"/>
    <path d="M9.2 6.6h1.7l.9 2.5-1.2.9c.6 1.3 1.6 2.3 2.9 2.9l.9-1.2 2.5.9v1.7c0 .6-.5 1.1-1.1 1.1C11.400 15.4 8.100 12.100 8.100 7.700c0-.6.5-1.100 1.100-1.100z" fill="#F28C28"/>`),
  chat: svgImg('p-ic sm', 24, 24, `<circle cx="12" cy="12" r="12" fill="#E6F6EC"/>
    <path d="M12 6.4a5.4 5.4 0 0 0-4.700 8.100L6.600 17.400l3-.7A5.400 5.400 0 1 0 12 6.400z" fill="none" stroke="#23884A" stroke-width="1.4" stroke-linejoin="round"/>
    <path d="M10.2 10.100c.2 1.500 1.300 2.700 2.800 3.100l.8-.8 1 .5" fill="none" stroke="#23884A" stroke-width="1.100" stroke-linecap="round"/>`),
  clock: svgImg('p-ic sm', 24, 24, `<circle cx="12" cy="12" r="12" fill="#E8F2FB"/>
    <g fill="none" stroke="#1B75BB" stroke-width="1.4" stroke-linecap="round"><circle cx="12" cy="12" r="5.600"/><path d="M12 9v3.200l2 1.200"/></g>`),
  mailsm: svgImg('p-ic sm', 24, 24, `<circle cx="12" cy="12" r="12" fill="#E8F2FB"/>
    <g fill="none" stroke="#1B75BB" stroke-width="1.300" stroke-linejoin="round"><rect x="6.500" y="8.200" width="11" height="7.800" rx="1.400"/><path d="M7 9l5 3.600L17 9"/></g>`),
  tick: svgImg('p-ic sm', 24, 24, `<circle cx="12" cy="12" r="12" fill="#2A9A58"/>
    <path d="M7.400 12.300l3 3 6.200-6.400" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>`),
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
  const paid = isPaidInvoice(d) ? '<div class="p-paid">Paid</div>' : '';
  return `${P_STRIP_TOP}
    <div class="p-head">
      ${brand}
      <div class="p-doc">
        <div class="p-title-row">${paid}<div class="p-title">${title}</div></div>
        <div class="p-meta">
          <span>${title} No.</span><b>${esc(d.number)}</b>
          <span>Date</span><b>${esc(fmtDate(d.date))}</b>
        </div>
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
  const paidInFull = isPaidInvoice(d);
  if (paidInFull) {
    // fully paid: show what was paid, and that nothing is left to pay
    tot += `<div class="p-grand paid"><span>Total Paid</span><b>${esc(cur)} ${pMoney(T.total, cur)}</b></div>`;
    tot += tr('Balance Due', pMoney(0, cur), 'adv');
  } else {
    tot += `<div class="p-grand"><span>Total Payable</span><b>${esc(cur)} ${pMoney(T.total, cur)}</b></div>`;
    if (T.adv) {
      tot += tr('Advance Received', '− ' + pMoney(T.adv, cur), 'adv');
      tot += `<div class="p-balance"><span>Balance Due</span><b>${esc(cur)} ${pMoney(T.balance, cur)}</b></div>`;
    }
  }
  const wordsAmount = paidInFull || !T.adv ? T.total : T.balance;
  const words = d.showWords
    ? `<div class="p-label">Amount in Words</div><div class="p-words-t">${esc(amountInWords(wordsAmount, cur))}</div>` : '';
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
      <div class="p-hw${hw.some(t => splitTitled(t).title) ? ' titled' : ''}">${hw.map(t => {
        const h = splitTitled(t);
        return `<div>${P_ICON.check}<span>${h.title ? `<b>${esc(h.title)}</b>` : ''}${esc(h.text)}</span></div>`;
      }).join('')}</div>`);
  }

  // Payment received / support / QR code
  const info = infoSection(d, S);
  if (info) {
    const kv = (k, v) => (v ? `<span>${k}</span><b>${esc(v)}</b>` : '');
    const line = (ic, k, v) => (v ? `<div class="p-sup">${ic}<div><small>${k}</small><b>${esc(v)}</b></div></div>` : '');
    const cards = [];
    if (info.payment) {
      const p = info.payment;
      cards.push(`<div class="p-icard pay">
          <div class="p-ihead">${P_ICON.tick}<div class="p-label">${p.title}</div></div>
          <div class="p-kv2">
            ${kv('Amount', `${cur} ${pMoney(p.amount, cur)}`)}${kv('Date', fmtDate(p.date))}${kv('Mode', p.mode)}${kv('Reference', p.ref)}
            ${p.balance !== undefined ? kv('Balance due', `${cur} ${pMoney(p.balance, cur)}`) : ''}
          </div>
          ${p.note ? `<div class="p-inote">${esc(p.note)}</div>` : ''}
        </div>`);
    }
    if (info.support) {
      const s = info.support;
      cards.push(`<div class="p-icard">
          <div class="p-label">Support</div>
          <div class="p-sups${info.payment ? '' : ' two'}">
            ${s.whatsapp.replace(/\D/g, '') === s.phone.replace(/\D/g, '')
              ? line(P_ICON.chat, 'Call / WhatsApp', s.phone)
              : line(P_ICON.phone, 'Call us', s.phone) + line(P_ICON.chat, 'WhatsApp', s.whatsapp)}
            ${line(P_ICON.clock, 'Working hours', s.hours)}
            ${info.payment ? '' : line(P_ICON.mailsm, 'Email', s.email) /* narrow layout: the email is already on the header */}
          </div>
        </div>`);
    }
    if (info.qr) cards.push(`<div class="p-icard qr">${qrImg(info.qr.url, 'p-qr')}<b>${esc(info.qr.title)}</b><small>${esc(info.qr.sub)}</small></div>`);
    add(`<div class="p-info n${cards.length}${info.qr ? ' has-qr' : ''}${info.payment ? ' has-pay' : ''}">${cards.join('')}</div>`, { preferFirst: true });
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
