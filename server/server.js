'use strict';
/* Web server: serves the app (parent folder) and a JSON API backed by SQL Server, with sign-in. */

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });

const express = require('express');
const db = require('./db');

const PORT = Number(process.env.PORT) || 3000;
const HOST = process.env.HOST || '0.0.0.0';
const COOKIE = 'dc_session';
const app = express();

app.disable('x-powered-by');
if (String(process.env.TRUST_PROXY).toLowerCase() === 'true') app.set('trust proxy', 1);   // behind Caddy / nginx / Cloudflare
app.use(express.json({ limit: '25mb' }));   // settings can carry logo/stamp images

/* ---------- CORS: only for origins listed in ALLOWED_ORIGINS (frontend hosted elsewhere, e.g. Vercel) ---------- */
const allowedOrigins = String(process.env.ALLOWED_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean);
function originAllowed(origin) {
  return allowedOrigins.some(rule => {
    if (rule === '*') return true;
    if (rule.includes('*')) {   // e.g. https://*.vercel.app
      const re = new RegExp('^' + rule.split('*').map(x => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('[^./]+') + '$', 'i');
      return re.test(origin);
    }
    return rule.toLowerCase() === origin.toLowerCase();
  });
}
app.use('/api', (req, res, next) => {
  res.set('Cache-Control', 'no-store');
  const origin = req.headers.origin;
  if (origin && originAllowed(origin)) {
    res.set('Access-Control-Allow-Origin', origin);
    res.set('Vary', 'Origin');
    res.set('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');
    res.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    res.set('Access-Control-Max-Age', '600');
  }
  if (req.method === 'OPTIONS') return res.sendStatus(origin && !originAllowed(origin) ? 403 : 204);
  next();
});

const wrap = fn => (req, res, next) => fn(req, res, next).catch(next);
const fail = (status, error) => { const e = new Error(error); e.status = status; return e; };

/* ---------- sessions ---------- */
/** Session token: Authorization: Bearer … (works cross-site, e.g. from Vercel) or the same-site cookie. */
function requestToken(req) {
  const h = /^Bearer\s+(.+)$/i.exec(req.headers.authorization || '');
  if (h) return h[1].trim();
  const m = /(?:^|;\s*)dc_session=([^;]+)/.exec(req.headers.cookie || '');
  return m ? decodeURIComponent(m[1]) : null;
}
function setCookie(res, token) {
  const parts = [`${COOKIE}=${encodeURIComponent(token)}`, 'Path=/', 'HttpOnly', 'SameSite=Lax', `Max-Age=${30 * 86400}`];
  res.set('Set-Cookie', parts.join('; '));
}
function clearCookie(res) {
  res.set('Set-Cookie', `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`);
}

// attach the signed-in user (if any) to every API request
app.use('/api', wrap(async (req, res, next) => {
  req.token = requestToken(req);
  req.user = await db.sessionUser(req.token);
  next();
}));
const requireUser = (req, res, next) => (req.user ? next() : res.status(401).json({ error: 'sign in required' }));
const requireAdmin = (req, res, next) => (req.user && req.user.role === 'admin' ? next() : res.status(403).json({ error: 'administrator only' }));
const canWriteRegion = (user, region) => user.role === 'admin' || user.homeRegion === region;

// slow down password guessing: 10 failures per IP per 15 minutes
const loginFails = new Map();
function throttled(ip) {
  const e = loginFails.get(ip);
  return e && e.count >= 10 && Date.now() < e.until;
}
function noteFail(ip) {
  const e = loginFails.get(ip) || { count: 0, until: 0 };
  e.count++; e.until = Date.now() + 15 * 60000;
  loginFails.set(ip, e);
}

/* ---------- auth ---------- */
app.get('/api/health', wrap(async (req, res) => {
  const s = await db.stats();
  res.json({ ok: true, database: s.database, auth: true, ...(req.user ? { documents: s.documents } : {}) });
}));

app.post('/api/auth/login', wrap(async (req, res) => {
  const ip = req.ip;
  if (throttled(ip)) return res.status(429).json({ error: 'Too many failed attempts. Try again in 15 minutes.' });
  const { username, password, region } = req.body || {};
  const r = await db.login(username, password, db.REGIONS.includes(region) ? region : null);
  if (!r) { noteFail(ip); return res.status(401).json({ error: 'Incorrect username or password.' }); }
  if (r.wrongRegion) return res.status(403).json({ error: `This account belongs to the ${r.wrongRegion === 'IN' ? 'India' : 'UAE'} team. Select that team to sign in.`, region: r.wrongRegion });
  loginFails.delete(ip);
  setCookie(res, r.token);
  res.json({ ...r.user, token: r.token });
}));

app.post('/api/auth/logout', wrap(async (req, res) => {
  await db.logout(req.token);
  clearCookie(res);
  res.json({ ok: true });
}));

app.get('/api/auth/me', wrap(async (req, res) => {
  if (!req.user) return res.status(401).json({ error: 'sign in required' });
  res.json(req.user);
}));

// administrators can work in either region for the current session
app.post('/api/auth/region', requireUser, requireAdmin, wrap(async (req, res) => {
  const { region } = req.body || {};
  if (!db.REGIONS.includes(region)) throw fail(400, 'region must be UAE or IN');
  await db.setSessionRegion(req.token, region);
  res.json({ ok: true, region });
}));

app.post('/api/auth/password', requireUser, wrap(async (req, res) => {
  const { current, next } = req.body || {};
  const row = await db.getUser(req.user.id);
  if (!db.verifyPassword(String(current || ''), row.PasswordHash)) throw fail(400, 'Current password is incorrect.');
  await db.setPassword(req.user.id, next);
  const r = await db.login(row.Username, next, req.user.region);   // keep this session signed in
  setCookie(res, r.token);
  res.json({ ok: true, token: r.token });
}));

/* ---------- users (admin) ---------- */
app.get('/api/users', requireUser, requireAdmin, wrap(async (req, res) => res.json(await db.listUsers())));

app.post('/api/users', requireUser, requireAdmin, wrap(async (req, res) => {
  try { res.json(await db.createUser(req.body || {})); }
  catch (err) { if (db.isDuplicate(err)) throw fail(409, 'That username is already taken.'); throw err; }
}));

app.put('/api/users/:id', requireUser, requireAdmin, wrap(async (req, res) => {
  const id = Number(req.params.id);
  const body = req.body || {};
  const existing = await db.getUser(id);
  if (!existing) throw fail(404, 'user not found');
  // never lock everyone out: the last active administrator stays an active administrator
  if (existing.Role === 'admin' && existing.Active && (body.role !== 'admin' || body.active === false) && (await db.countActiveAdmins()) <= 1) {
    throw fail(400, 'This is the only active administrator account.');
  }
  try { res.json(await db.updateUser(id, body)); }
  catch (err) { if (db.isDuplicate(err)) throw fail(409, 'That username is already taken.'); throw err; }
}));

app.post('/api/users/:id/password', requireUser, requireAdmin, wrap(async (req, res) => {
  await db.setPassword(Number(req.params.id), (req.body || {}).password);
  res.json({ ok: true });
}));

/* ---------- settings (per region) ---------- */
app.get('/api/settings', requireUser, wrap(async (req, res) => res.json(await db.getAllSettings())));

app.put('/api/settings/:region', requireUser, wrap(async (req, res) => {
  const region = req.params.region;
  if (!db.REGIONS.includes(region)) throw fail(400, 'region must be UAE or IN');
  if (!canWriteRegion(req.user, region)) throw fail(403, `You can only change ${req.user.homeRegion === 'IN' ? 'India' : 'UAE'} settings.`);
  if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body)) throw fail(400, 'settings object expected');
  await db.putSettings(region, req.body, req.user.username);
  res.json({ ok: true });
}));

/* ---------- documents ---------- */
app.get('/api/docs', requireUser, wrap(async (req, res) => res.json(await db.listDocs())));

app.put('/api/docs/:id', requireUser, wrap(async (req, res) => {
  const d = req.body;
  if (!d || d.id !== req.params.id) throw fail(400, 'document id mismatch');
  const current = await db.getDocBranch(d.id);
  if ((current && !canWriteRegion(req.user, current)) || !canWriteRegion(req.user, d.branch)) {
    throw fail(403, 'This document belongs to the other team and can only be viewed.');
  }
  try {
    await db.putDoc(d, req.user.username);
    res.json({ ok: true });
  } catch (err) {
    if (db.isDuplicate(err)) return res.status(409).json({ error: 'duplicate-number', number: d.number });
    throw err;
  }
}));

app.delete('/api/docs/:id', requireUser, wrap(async (req, res) => {
  const current = await db.getDocBranch(req.params.id);
  if (current && !canWriteRegion(req.user, current)) throw fail(403, 'This document belongs to the other team.');
  res.json({ ok: true, deleted: await db.deleteDoc(req.params.id) });
}));

app.post('/api/import', requireUser, wrap(async (req, res) => {
  const { settings, docs, region } = req.body || {};
  const target = db.REGIONS.includes(region) ? region : req.user.region;
  if (!Array.isArray(docs)) throw fail(400, 'docs array expected');
  if (!canWriteRegion(req.user, target)) throw fail(403, 'You can only import into your own team.');
  await db.importRegion(target, settings, docs, req.user.username);
  res.json({ ok: true, region: target, documents: docs.filter(d => d.branch === target).length });
}));

// the web app itself
const root = path.join(__dirname, '..');
app.use(express.static(root, { index: 'index.html', extensions: ['html'] }));

app.use('/api', (req, res) => res.status(404).json({ error: 'not found' }));
app.use((err, req, res, next) => { // eslint-disable-line no-unused-vars
  if (!err.status) console.error(new Date().toISOString(), err);
  res.status(err.status || 500).json({ error: err.status ? err.message : 'database error', detail: err.message });
});

db.init()
  .then(() => app.listen(PORT, HOST, () => {
    console.log('DataCare Invoice & Quotation');
    console.log(`  Database : ${process.env.DB_SERVER} / ${db.DB_NAME}`);
    console.log(`  Open     : http://localhost:${PORT}`);
    if (allowedOrigins.length) console.log(`  CORS     : ${allowedOrigins.join(', ')}`);
  }))
  .catch(err => {
    console.error('Could not connect to SQL Server:', err.message);
    console.error('Check server/.env (DB_SERVER, DB_PORT, DB_USER, DB_PASSWORD) and that port 1433 is reachable.');
    process.exit(1);
  });
