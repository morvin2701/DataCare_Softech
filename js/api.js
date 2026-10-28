'use strict';
/* Talks to server/server.js (SQL Server + sign-in). Falls back to browser storage when the app is opened
   without the server. Writes that fail (server restarting, network blip) are queued and retried. */

const API = {
  base: null,          // ".../api"
  configured: false,   // true when APP_CONFIG.apiBase points at a separate backend (e.g. frontend on Vercel)
  cross: false,        // backend is on another origin
  token: null,         // session token (sent as a header – works cross-site where cookies do not)
  online: false,
  info: null,          // from /api/health
  onStatus: null,      // callback(state) – 'db' | 'local' | 'queued'
  onUnauthorized: null,// callback() – session expired
  _flushing: false,
  _waiters: {},        // key -> { seq, resolve, reject } for callers awaiting a reply

  /** Finds the backend: the configured apiBase, else the same origin the page was served from. */
  async detect() {
    const cfg = (window.APP_CONFIG && String(window.APP_CONFIG.apiBase || '').trim().replace(/\/+$/, '')) || '';
    this.token = Store.get('dc_token', null);
    let origin = null;
    if (cfg) { origin = cfg; this.configured = true; this.cross = cfg !== location.origin; }
    else if (/^https?:$/.test(location.protocol)) origin = location.origin;
    if (origin) {
      try {
        const r = await this._fetch(origin + '/api/health', {}, 6000, origin + '/api');
        if (r.ok) {
          this.info = await r.json();
          this.base = origin + '/api';
          this.online = true;
          this._status(this._queue().length ? 'queued' : 'db');
          return true;
        }
      } catch (e) { /* backend not reachable */ }
    }
    this.online = false;
    this._status('local');
    return false;
  },

  _status(state) { if (this.onStatus) this.onStatus(state); },

  _fetch(url, opts = {}, timeout = 20000) {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), timeout);
    const headers = { 'Content-Type': 'application/json', ...(opts.headers || {}) };
    if (this.token) headers.Authorization = 'Bearer ' + this.token;
    return fetch(url, { credentials: this.cross ? 'omit' : 'same-origin', ...opts, signal: ctl.signal, headers })
      .finally(() => clearTimeout(t));
  },

  _setToken(token) {
    this.token = token || null;
    if (token) Store.set('dc_token', token); else { try { localStorage.removeItem('dc_token'); } catch (e) { /* ignore */ } }
  },

  async _json(method, path, body, timeout) {
    const r = await this._fetch(this.base + path, { method, body: body === undefined ? undefined : JSON.stringify(body) }, timeout);
    if (!r.ok) {
      const err = new Error(`HTTP ${r.status}`);
      err.status = r.status;
      try { err.body = await r.json(); } catch (e) { /* no body */ }
      if (err.body && err.body.error) err.message = err.body.error;
      if (r.status === 401 && !path.startsWith('/auth/')) { this._setToken(null); if (this.onUnauthorized) this.onUnauthorized(); }
      throw err;
    }
    return r.status === 204 ? null : r.json();
  },

  /* ---- auth ---- */
  async login(region, username, password) {
    const u = await this._json('POST', '/auth/login', { region, username, password });
    this._setToken(u.token); delete u.token;
    return u;
  },
  async logout() { try { await this._json('POST', '/auth/logout'); } finally { this._setToken(null); } },
  me() { return this._json('GET', '/auth/me').catch(err => { if (err.status === 401) { this._setToken(null); return null; } throw err; }); },
  setRegion(region) { return this._json('POST', '/auth/region', { region }); },
  async changePassword(current, next) {
    const r = await this._json('POST', '/auth/password', { current, next });
    if (r && r.token) this._setToken(r.token);
    return r;
  },
  health() { return this._json('GET', '/health'); },

  /* ---- users (admin) ---- */
  contacts() { return this._json('GET', '/contacts'); },
  employees() { return this._json('GET', '/employees'); },
  regions() { const t = new URLSearchParams(location.search).get('team'); return this._json('GET', '/regions' + (t ? '?team=' + encodeURIComponent(t) : '')); },
  createRegion(r) { return this._json('POST', '/regions', r); },
  users() { return this._json('GET', '/users'); },
  createUser(u) { return this._json('POST', '/users', u); },
  updateUser(id, u) { return this._json('PUT', '/users/' + id, u); },
  resetPassword(id, password) { return this._json('POST', `/users/${id}/password`, { password }); },

  /* ---- data ---- */
  getAllSettings() { return this._json('GET', '/settings'); },
  getDocs() { return this._json('GET', '/docs'); },
  /** Uploads a signed copy for a saved document; the file is read into base64 first. */
  async uploadFile(docId, file, kind = 'signed') {
    const prepared = await prepareUpload(file);
    const data = await new Promise((resolve, reject) => { const fr = new FileReader(); fr.onerror = reject; fr.onload = () => resolve(String(fr.result).split(',')[1]); fr.readAsDataURL(prepared.blob); });
    const timeout = 60000 + Math.ceil(prepared.blob.size / (100 * 1024)) * 1000;
    return this._json('POST', `/docs/${encodeURIComponent(docId)}/files`, { fileName: prepared.name, mimeType: prepared.type, data, kind }, timeout);
  },
  fileUrl(id, download) { return `${this.base}/files/${encodeURIComponent(id)}${download ? '?download=1' : ''}`; },
  /** Fetches a stored file as a blob URL (works even when the session is held as a header token). */
  async fileBlobUrl(id) { const r = await this._fetch(this.fileUrl(id)); if (!r.ok) throw new Error('Could not load the file'); return URL.createObjectURL(await r.blob()); },
  importRegion(region, settings, docs) { return this._json('POST', '/import', { region, settings, docs }); },

  /* ---- queued writes: survive a server restart / network blip ---- */
  _queue() { return Store.get('dc_pending', []); },
  _setQueue(q) { Store.set('dc_pending', q); this._status(q.length ? 'queued' : 'db'); },
  _key: item => item.op + ':' + (item.id || ''),

  /** Each resolves with the server reply once sent, or rejects with the server's 4xx error. */
  putSettings(region, data) { return this._enqueue({ op: 'settings', id: region, payload: data }); },
  putDoc(d) { return this._enqueue({ op: 'doc', id: d.id, payload: d }); },
  deleteDoc(id) { return this._enqueue({ op: 'delete', id }); },

  _enqueue(item) {
    item.seq = Date.now() + Math.random();
    const key = this._key(item);
    // a newer write for the same target replaces an older queued one
    const q = this._queue().filter(x => this._key(x) !== key);
    q.push(item);
    this._setQueue(q);
    const old = this._waiters[key];
    if (old) old.resolve({ superseded: true });
    const p = new Promise((resolve, reject) => { this._waiters[key] = { seq: item.seq, resolve, reject }; });
    this.flush();
    return p;
  },

  /** Sends queued writes in order, re-reading the queue each step so writes made meanwhile are kept. */
  async flush() {
    if (!this.online || this._flushing) return;
    this._flushing = true;
    try {
      for (;;) {
        const q = this._queue();
        if (!q.length) break;
        const item = q[0];
        let reply = null, error = null;
        try { reply = (await this._send(item)) || { ok: true }; }
        catch (err) { error = err; }

        if (error && !(error.status >= 400 && error.status < 500)) break;   // network / server error: keep it, retry later
        if (error && error.status === 401) break;                             // signed out: keep until signed in again

        // done with this item (sent, or rejected by the server): drop exactly this item
        this._setQueue(this._queue().filter(x => x.seq !== item.seq));
        const key = this._key(item);
        const w = this._waiters[key];
        if (w && w.seq === item.seq) {
          delete this._waiters[key];
          error ? w.reject(error) : w.resolve(reply);
        }
      }
    } finally {
      this._flushing = false;
    }
  },

  _send(item) {
    if (item.op === 'settings') return this._json('PUT', '/settings/' + encodeURIComponent(item.id), item.payload);
    if (item.op === 'doc') return this._json('PUT', '/docs/' + encodeURIComponent(item.id), item.payload);
    if (item.op === 'delete') return this._json('DELETE', '/docs/' + encodeURIComponent(item.id));
    return Promise.resolve(null);
  }
};

/* ---------- upload helpers ---------- */
const UPLOAD_TYPES = { pdf: 'application/pdf', jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', heic: 'image/heic', heif: 'image/heif' };

/** The real type of a picked file: the browser's type when it is a known one, else from the extension (iPhone HEIC often reports none). */
function uploadType(file) {
  const t = String(file.type || '').toLowerCase();
  if (Object.values(UPLOAD_TYPES).includes(t)) return t;
  return UPLOAD_TYPES[String(file.name || '').toLowerCase().split('.').pop()] || null;
}

/** Photos are shrunk before upload: a signed form photographed by a phone is 3-8 MB, which is slow and can fail on the
    link to the server, while a 1600px JPEG (200-400 KB) is just as legible. HEIC is converted to JPEG at the same time
    so it opens in any browser later. PDFs are sent as they are. If the device cannot decode the image, the original is kept. */
async function prepareUpload(file) {
  const type = uploadType(file) || 'application/octet-stream';
  if (!/^image\//.test(type)) return { blob: file, name: file.name, type };
  const isHeic = type === 'image/heic' || type === 'image/heif';
  const smallEnough = !isHeic && file.size <= 600 * 1024;
  if (smallEnough) return { blob: file, name: file.name, type };
  try {
    const bmp = await createImageBitmap(file);
    const max = 1600, scale = Math.min(1, max / Math.max(bmp.width, bmp.height));
    const c = document.createElement('canvas'); c.width = Math.round(bmp.width * scale); c.height = Math.round(bmp.height * scale);
    c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
    const blob = await new Promise(r => c.toBlob(r, 'image/jpeg', 0.85));
    if (blob && (isHeic || blob.size < file.size)) return { blob, name: file.name.replace(/\.[^.]+$/, '') + '.jpg', type: 'image/jpeg' };
  } catch (e) { /* cannot decode on this device: keep the original */ }
  return { blob: file, name: file.name, type };
}
