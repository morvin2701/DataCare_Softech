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

// Order form terms start as a copy of the invoice terms (edit them in Settings > Default text).
const ORDER_TERMS = INVOICE_TERMS;

const HARDWARE_CONFIG = [
  'Minimum Intel i5 or i7 Processor required.',
  'Operating System Windows 10 Pro or 11 Pro.',
  'Minimum 8 GB RAM or up required.',
  'Android Device 4 GB RAM 64 GB or up and Android version 10 or higher required.'
];

// Detailed version for invoices. "Title: text" lines print the title in bold.
const HARDWARE_CONFIG_DETAILED = [
  'Processor: Minimum Intel Core i5 or i7 processor.',
  'Operating System: Genuine Windows 10 Pro or 11 Pro (64-bit).',
  'Memory (RAM): Minimum 8 GB RAM. 16 GB is recommended when several users work at the same time.',
  'Storage: SSD drive recommended, with enough free space for the database and daily backups.',
  'Mobile App Device: Android phone or tablet with 4 GB RAM, 64 GB storage and Android version 10 or higher.',
  'Internet: Stable internet connection for online support, software updates and WhatsApp features.',
  'Printer & Scanner: Barcode label printer and barcode scanner.',
  'Power & Backup: UPS recommended, with a regular data backup.'
];

/* ---------- software versions and the feature comparison list ----------
   Codes: v = √ included, x = X not included, + = add-on (chargeable). Order: Lite Basic Standard Ultra Pro Advance Enterprise.
   The 8th version (Web Based) starts empty – fill it in Settings > Versions & comparison. */
const DEFAULT_EDITIONS = ['Lite', 'Basic', 'Standard', 'Ultra', 'Pro', 'Advance', 'Enterprise', 'Web Based'];
const DEFAULT_COMPARISON = (() => {
  const mark = code => [...code].map(c => (c === 'v' ? '√' : c === 'x' ? 'X' : '+')).concat(['']);
  const groups = [
    ['Overview', false, [
      ['Computer / LAN (Users)', ['1', '1', '1', '1', '1', '2', '4', '']],
      ['Company Management', ['1', '2', 'MULTI', 'MULTI', 'MULTI', 'MULTI', 'MULTI', '']],
      ['Mobile App (Android)', ['NO', 'YES', 'YES', 'YES', 'YES', 'YES', 'YES', '']],
      ['Mobile App (Apple iOS)', ['NO', 'NO', 'NO', 'YES', 'YES', 'YES', 'YES', '']]]],
    ['Transactions', true, [
      ['Barcode / QR Code', 'vvvvvvv'], ['Sales / Estimate / Sales Return', 'vvvvvvv'], ['RFID Integration', 'xxxxxx+'],
      ['Purchase / Debit Note', 'vvvvvvv'], ['Approval Issue / Receive', 'vvvvvvv'], ['Wholesale / Ratecut', 'vvvvvvv'],
      ['Tag Generate / Edit / Cancel', 'vvvvvvv'], ['Tag Weight Change', 'xvvvvvv'], ['Tag Split', 'xxxxxvv'],
      ['Sale Quotation / Purchase Quotation', 'xvvvvvv'], ['Counter wise stock management', 'xvvvvvv'], ['E-Invoice / E-Credit Note', 'x++++++'],
      ['Labour Invoice', 'xvvvvvv'], ['Old Item Refinery Process', 'xxvvvvv'], ['Bill wise payment receive', 'xxvvvvv'],
      ['Other Income / Expense', 'xvvvvvv'], ['Lot / Batch wise purchase management', 'xxxxxxv']]],
    ['Order / Repairing', true, [
      ['Sales order / Order cancel', 'vvvvvvv'], ['Order tracking report', 'xxxxxxv'], ['Repairing Issue / Received', 'xxvvvvv']]],
    ['User Security System', true, [
      ['User create', 'vvvvvvv'], ['User rights', 'xvvvvvv'], ['User request (Edit / Delete)', 'xxxxxxv'],
      ['Data backup', 'vvvvvvv'], ['Day wise data lock', 'xxvvvvv']]],
    ['Analysis Reports', true, [
      ['Dead stock', 'xxvvvvv'], ['Sales Zoom (Month / City / Party / Item wise)', 'xxvvvvv'], ['Purchase Zoom (Month / City / Party / Item wise)', 'xxvvvvv'],
      ["Customer's last visit report", 'xxxxvvv'], ['Stock movement (with weight range)', 'xxxxvvv'], ['Delete data report', 'xxxxvvv'],
      ['Minimum stock level report', 'xxxxxxv'], ["Graph reports (Sales / Expense / Employee's sale)", 'xxxxxxv'], ['Bill wise profit / Item wise profit', 'xxxxxxv'],
      ["User's activity report", 'xxxxxxv'], ["Supplier's stock movement report", 'xxxxxxv'], ["User's entry modification report", 'xxxxxxv'],
      ["Employee's incentive & target", 'xxxxxxv'], ['Employee wise sales analysis report', 'xxxxxxv']]],
    ['Financial', true, [
      ['Cash / Bank Contra Entry', 'vvvvvvv'], ['Ledger with metal and cash', 'vvvvvvv'], ['Final Reports (Balance Sheet / Profit & Loss)', 'xxvvvvv'],
      ['GST Reports', 'vvvvvvv'], ['Audit Interest Report / Depreciation Report', 'xxxxxvv'], ['TDS / TCS Reports', 'xxvvvvv'], ['Total Fine Report', 'xxvvvvv']]],
    ['Reports', true, [
      ['Sale / Purchase / Order / Approval', 'vvvvvvv'], ['Tag stock report / HUID report', 'vvvvvvv'], ['Cash book / Bank book', 'vvvvvvv'],
      ['Day book / Rojmel', 'xvvvvvv'], ['Outstanding Report', 'xvvvvvv'], ['Address print report / Parcel Receipt Print', 'xvvvvvv']]],
    ['Others', true, [
      ['Saving scheme / Chit fund Management', 'xxxvvvv'], ['Girvi / Money Lending / Loan (Amount / Metal)', 'xxxxvvv'], ['WhatsApp Module', 'x++++++'],
      ['Weight scale connectivity', 'xx+++++'], ['Customer Loyalty Program', 'xxxxxxv'], ["Employee's Salary Calculation", 'xxxxxvv'], ['CRM Module', 'xxxxxx+']]],
    ['Branch Management (Add-on feature)', true, [
      ['Cash inward / outward', 'xxxxxxv'], ['Stock inward / outward', 'xxxxxxv'], ['Store (Branch) wise report', 'xxxxxxv']]],
    ['Mobile App Features', true, [
      ['Sales / Order / Stock / Ledger Reports', 'xvvvvvv'], ['Sales Quotation', 'xvvvvvv'], ['Image wise item catalogue', 'xxvvvvv'], ['Scheme / Money Lending Report', 'xxxxvvv']]],
    ['Image Catalogue Android App (Add-on feature)', true, [
      ['Admin / Client module app', '+++++++'], ['Available stock & order design display', '+++++++']]]
  ];
  return groups.map(([name, numbered, rows], gi) => ({
    id: 'g' + (gi + 1), name, numbered,
    rows: rows.map(([rname, v], ri) => ({ id: `g${gi + 1}r${ri + 1}`, name: rname, values: Array.isArray(v) ? v : mark(v) }))
  }));
})();

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
  // Support box + QR code printed on documents. Empty phone / WhatsApp = the issuing branch's number.
  support: { phone: '', whatsapp: '', hours: 'Monday to Saturday, 10:00 AM to 7:00 PM (Sunday closed)' },
  qrTarget: 'whatsapp',   // 'whatsapp' | 'website' | 'none'
  preparedBy: 'Shreyash Thumar',
  headerContact2: { phone: '' },   // second number on the header; '' = the other branch's office number
  amcPercent: 10,
  amcMode: 'percent',   // 'percent' = % of the software price, 'amount' = fixed amount per year
  amcAmount: 0,
  numbering: { quotation: 'DC-{BR}-QT-{YYYY}-{SEQ}', order: 'DC-{BR}-OF-{YYYY}-{SEQ}', invoice: 'DC-{BR}-INV-{YYYY}-{SEQ}', pad: 4 },
  counters: { 'quotation-UAE': 1, 'quotation-IN': 1, 'order-UAE': 1, 'order-IN': 1, 'invoice-UAE': 1, 'invoice-IN': 1 },
  logo: null,
  stamp: null,
  terms: { quotation: QUOTATION_TERMS, order: ORDER_TERMS, invoice: INVOICE_TERMS },
  hardware: HARDWARE_CONFIG,                    // quotations (short, keeps them on one page)
  hardwareInvoice: HARDWARE_CONFIG_DETAILED,    // invoices (detailed)
  softwareVersions: ['DataCare Next'],
  editions: DEFAULT_EDITIONS,          // printed on every document, the chosen one ticked
  comparison: DEFAULT_COMPARISON,      // feature comparison list (attachable to a document)
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

/* The three kinds of document. Order forms sit between a quotation and the invoice. */
const DOC_KINDS = {
  quotation: { title: 'Quotation', short: 'Quot', lower: 'quotation', plural: 'Quotations' },
  order: { title: 'Order Form', short: 'Order', lower: 'order form', plural: 'Order Forms' },
  invoice: { title: 'Invoice', short: 'Inv', lower: 'invoice', plural: 'Invoices' }
};
const kindOf = t => DOC_KINDS[t] || DOC_KINDS.quotation;

/** Default on/off switches for each kind of document. */
function typeDefaults(t) {
  const q = t === 'quotation';
  return { showHardware: true, showVersion: !q, showAcceptance: !q, termsNewPage: !q, showWords: !q, showSupport: t === 'invoice' };
}

/* Teams (regions). This is the built-in list used when the app runs without the server; with the server the list
   comes from /api/regions (which may add more teams) and replaces it at sign-in. */
let REGION_LIST = [
  { code: 'UAE', name: 'UAE · Dubai', country: 'UAE', dial: '+971', currency: 'AED', taxLabel: 'VAT', taxRate: 5, flag: '🇦🇪' },
  { code: 'IN', name: 'India', country: 'India', dial: '+91', currency: 'INR', taxLabel: 'GST', taxRate: 18, flag: '🇮🇳' }
];
const FLAG_BY_COUNTRY = { UAE: '🇦🇪', India: '🇮🇳' };
const regionInfo = code => REGION_LIST.find(r => r.code === code) || { code, name: code, country: code, dial: '', currency: 'AED', taxLabel: 'Tax', taxRate: 0, flag: '' };
const regionCodes = () => REGION_LIST.map(r => r.code);
/** Default branch settings for a team, used when a team has no saved settings yet (e.g. a newly added team). */
function branchDefaults(code) {
  const r = regionInfo(code);
  return { label: r.name.split('·')[0].trim().toUpperCase(), phone: '', address: r.country, currency: r.currency, taxLabel: r.taxLabel, taxRate: r.taxRate, taxId: '' };
}
const BRANCH_NAMES = { UAE: 'UAE (Dubai)', IN: 'India' };
const STATUSES = {
  quotation: ['Draft', 'Sent', 'Accepted', 'Rejected'],
  order: ['Pending', 'Completed', 'Cancelled'],
  invoice: ['Unpaid', 'Partially Paid', 'Paid', 'Cancelled']
};
/** "just now", "2 hours ago", "yesterday", then the date. */
function timeAgo(iso) {
  if (!iso) return '';
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return '';
  const s = Math.max(0, (Date.now() - t) / 1000);
  if (s < 60) return 'just now';
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} hour${h === 1 ? '' : 's'} ago`;
  const d = new Date(t), now = new Date();
  const startOf = x => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const days = Math.round((startOf(now) - startOf(d)) / 864e5);
  if (days === 1) return 'yesterday';
  const local = `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`;
  return local;
}
function fmtDateTime(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const hh = d.getHours() % 12 || 12, ap = d.getHours() < 12 ? 'AM' : 'PM';
  return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}, ${hh}:${String(d.getMinutes()).padStart(2, '0')} ${ap}`;
}

const PAYMENT_MODES = ['Cash', 'Bank Transfer', 'Cheque', 'Card', 'Online / UPI'];
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
