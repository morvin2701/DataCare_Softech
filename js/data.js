'use strict';
/* Defaults, storage, numbering, money formatting and amount-in-words. */

const QUOTATION_TERMS = [
  'Product once sold will not be taken back under any condition.',
  'Payment received will not be refundable.',
  'Software license is non-transferable.',
  'Training & Service support: We are providing online service supports only.',
  'Onsite service support will be provided as per our conditions.',
  'We will customize our software as per your requirement.',
  'Annual Maintenance Charge (AMC) will be {AMC} of the software price which is compulsory every year.',
  'If Annual Maintenance Charge will not be paid till due date, Software will be locked automatically.',
  'AMC charge is valid for one year only.',
  'We will modify specific report formats as per software versions & your requirements.',
  'In future, the price of the software products as well as Annual Maintenance Service Charge may be changed due to any circumstances.',
  'All terms & Conditions are subject to Ahmedabad jurisdiction only.'
];

const INVOICE_TERMS = [
  'Product once sold will not be taken back under any condition.',
  'Payment received will not be refundable.',
  'Software license is non-transferable.',
  'Training & Service support: We are providing online & offline service supports.',
  'Onsite service support will be provided as per our conditions.',
  'Expenses like travelling cost and Accommodation cost will be borne by customer.',
  'No customization at all.',
  'We will modify only specific report formats as per software versions.',
  'This proposal is valid up to 30 days only.',
  'Our software price does not include any hardware or any devices.',
  'Annual Maintenance Charge (AMC) will be {AMC} of the software price which is compulsory every year.',
  'If Annual Maintenance Charge will not be paid till due date, Software will be locked automatically.',
  'AMC charge is valid for one year only and you have to pay in starting of the year.',
  'For an extra single computer system to add in local area network, charge will be extra per computer system.',
  'WhatsApp feature is optional and chargeable.',
  'Branch feature optional and chargeable, charge will be extra as on version and per branch.',
  'Annual service charge may be increased in future due to economic circumstances.',
  'Office will be closed on Sunday. From Monday to Saturday, official working time is from 10:00 AM to 7:00 PM.',
  'All terms & Conditions are subject to head office (Ahmedabad) jurisdiction only.',
  'Terms & conditions apply.'
];

const HARDWARE_CONFIG = [
  'Minimum Intel i5 or i7 Processor required.',
  'Operating System Windows 10 Pro or 11 Pro.',
  'Minimum 8 GB RAM or up required.',
  'Android Device 4 GB RAM 64 GB or up and Android version 10 or higher required.'
];

const DEFAULT_SETTINGS = {
  companyName: 'Data Care Softech',
  legalName: 'DataCare Softech FZCO',
  website: 'www.datacaresoftech.com',
  email: '',
  showFooterLine: true,
  template: 'premium',     // 'premium' | 'classic'
  logoHasName: false,      // true when the uploaded logo image already contains the company name
  accent: '#E8772E',
  branches: {
    UAE: { label: 'UAE', phone: '+971 55 176 0454', address: 'Dubai, U.A.E.', currency: 'AED', taxLabel: 'VAT', taxRate: 5, taxId: '' },
    IN:  { label: 'INDIA', phone: '+91 87581 11027', address: 'Ahmedabad, Gujarat, India', currency: 'INR', taxLabel: 'GST', taxRate: 18, taxId: '' }
  },
  preparedBy: 'Shreyash Thumar',
  headerContact2: { phone: '' },   // second number on the header; '' = the other branch's office number
  amcPercent: 10,
  numbering: { quotation: 'DC-{BR}-QT-{YYYY}-{SEQ}', invoice: 'DC-{BR}-INV-{YYYY}-{SEQ}', pad: 4 },
  counters: { 'quotation-UAE': 1, 'quotation-IN': 1, 'invoice-UAE': 1, 'invoice-IN': 1 },
  logo: null,
  stamp: null,
  terms: { quotation: QUOTATION_TERMS, invoice: INVOICE_TERMS },
  hardware: HARDWARE_CONFIG,
  softwareVersions: ['DataCare Next'],
  presets: [
    { desc: 'DataCare Next Software Price (1 Month WhatsApp Free):', AED: 7000, INR: 0 },
    { desc: 'Hardware Price (Printer + Scanner + label + Golden Ribbon):', AED: 1700, INR: 0 },
    { desc: 'Software Price', AED: 6000, INR: 0 },
    { desc: 'Hardware Price', AED: 1000, INR: 0 },
    { desc: 'WhatsApp Feature (1 Year)', AED: 0, INR: 0 },
    { desc: 'Additional Computer System (LAN)', AED: 0, INR: 0 },
    { desc: 'Branch Feature (per branch)', AED: 0, INR: 0 },
    { desc: 'Annual Maintenance Charge (AMC)', AED: 0, INR: 0 }
  ]
};

const BRANCH_NAMES = { UAE: 'UAE (Dubai)', IN: 'India' };
const STATUSES = {
  quotation: ['Draft', 'Sent', 'Accepted', 'Rejected'],
  invoice: ['Unpaid', 'Partially Paid', 'Paid', 'Cancelled']
};
const CURRENCIES = {
  AED: { major: 'UAE Dirhams', minor: 'Fils', locale: 'en-US' },
  INR: { major: 'Rupees', minor: 'Paise', locale: 'en-IN' },
  USD: { major: 'US Dollars', minor: 'Cents', locale: 'en-US' }
};

/* ---------- storage ---------- */
const Store = {
  get(key, fallback) {
    try { const v = localStorage.getItem(key); return v ? JSON.parse(v) : fallback; }
    catch (e) { return fallback; }
  },
  set(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); return true; }
    catch (e) { console.error(e); return false; }
  }
};

const clone = o => JSON.parse(JSON.stringify(o));

/** Deep-merge saved settings over defaults so new default keys appear after upgrades. */
function mergeDefaults(def, saved) {
  if (Array.isArray(def) || typeof def !== 'object' || def === null) return saved === undefined ? clone(def) : saved;
  const out = {};
  const src = saved && typeof saved === 'object' ? saved : {};
  for (const k of new Set([...Object.keys(def), ...Object.keys(src)])) {
    out[k] = k in def ? mergeDefaults(def[k], src[k]) : src[k];
  }
  return out;
}

/* ---------- helpers ---------- */
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const round2 = n => Math.round((Number(n) || 0) * 100) / 100;
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function todayISO() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function fmtDate(iso) {
  if (!iso) return '';
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y}`;
}

/** 7000 -> "7,000/-" ; 7000.5 -> "7,000.50" (Indian grouping for INR). */
function fmtMoney(n, cur, slashStyle = true) {
  const v = round2(n);
  const locale = (CURRENCIES[cur] || CURRENCIES.AED).locale;
  if (Number.isInteger(v)) return v.toLocaleString(locale) + (slashStyle ? '/-' : '');
  return v.toLocaleString(locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/* ---------- document numbering ---------- */
function formatNumber(pattern, branch, dateISO, seq, pad) {
  const d = dateISO ? new Date(dateISO + 'T00:00:00') : new Date();
  const y = d.getFullYear();
  const fy = d.getMonth() >= 3 ? y : y - 1; // Indian financial year starts April
  return pattern
    .replace(/\{BR\}/g, branch)
    .replace(/\{YYYY\}/g, y)
    .replace(/\{YY\}/g, String(y).slice(-2))
    .replace(/\{MM\}/g, String(d.getMonth() + 1).padStart(2, '0'))
    .replace(/\{FY\}/g, `${String(fy).slice(-2)}-${String(fy + 1).slice(-2)}`)
    .replace(/\{SEQ\}/g, String(seq).padStart(pad || 1, '0'));
}

/* ---------- amount in words ---------- */
const ONES = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve',
  'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
const TENS = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];

const w99 = n => n < 20 ? ONES[n] : TENS[Math.floor(n / 10)] + (n % 10 ? ' ' + ONES[n % 10] : '');
const w999 = n => [Math.floor(n / 100) ? ONES[Math.floor(n / 100)] + ' Hundred' : '', n % 100 ? w99(n % 100) : '']
  .filter(Boolean).join(' ');

function wordsIntl(n) {
  if (!n) return 'Zero';
  const out = [];
  for (const [v, name] of [[1e9, 'Billion'], [1e6, 'Million'], [1e3, 'Thousand']]) {
    if (n >= v) { out.push(wordsIntl(Math.floor(n / v)) + ' ' + name); n %= v; }
  }
  if (n) out.push(w999(n));
  return out.join(' ');
}

function wordsIndian(n) {
  if (!n) return 'Zero';
  const out = [];
  const crore = Math.floor(n / 1e7); n %= 1e7;
  if (crore) out.push(wordsIndian(crore) + ' Crore');
  const lakh = Math.floor(n / 1e5); n %= 1e5;
  if (lakh) out.push(w99(lakh) + ' Lakh');
  const th = Math.floor(n / 1e3); n %= 1e3;
  if (th) out.push(w99(th) + ' Thousand');
  if (n) out.push(w999(n));
  return out.join(' ');
}

function amountInWords(amount, cur) {
  const c = CURRENCIES[cur] || CURRENCIES.AED;
  const v = Math.abs(round2(amount));
  const whole = Math.floor(v);
  const frac = Math.round((v - whole) * 100);
  const words = cur === 'INR' ? wordsIndian : wordsIntl;
  let s = `${c.major} ${words(whole)}`;
  if (frac) s += ` and ${w99(frac)} ${c.minor}`;
  return s + ' Only';
}
