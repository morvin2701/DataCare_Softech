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

  async _json(method, path, body) {
    const r = await this._fetch(this.base + path, { method, body: body === undefined ? undefined : JSON.stringify(body) });
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
  users() { return this._json('GET', '/users'); },
  createUser(u) { return this._json('POST', '/users', u); },
  updateUser(id, u) { return this._json('PUT', '/users/' + id, u); },
  resetPassword(id, password) { return this._json('POST', `/users/${id}/password`, { password }); },

  /* ---- data ---- */
  getAllSettings() { return this._json('GET', '/settings'); },
  getDocs() { return this._json('GET', '/docs'); },
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
