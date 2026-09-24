# Deployment: frontend on Vercel, backend on your Windows server

```
 Team's browsers ──HTTPS──▶ Vercel (index.html, css, js)
        │
        └────────HTTPS──▶ api.datacaresoftech.com  (Caddy, port 443)
                                   │
                                   ▼  127.0.0.1:3000
                            Node backend  (server/server.js)
                                   │
                                   ▼  <your-sql-server-ip>:1433
                            SQL Server  (database DcInvoice)
```

Sign-in uses a token sent in a header (not a cookie), so it works from Vercel in every browser, including Safari/iPhone.

---

## Part A – Backend on your Windows server

### A1. Install and run the backend
1. Copy the **`server/`** folder to the server (e.g. `C:\DataCareInvoice\server`).
2. Install **Node.js LTS** from https://nodejs.org (tick "Add to PATH").
3. Edit `server\.env`:
   ```ini
   DB_SERVER=<your-sql-server-ip>        # or 127.0.0.1 if SQL Server runs on the same machine
   DB_PORT=1433
   DB_USER=<sql-login>
   DB_PASSWORD=********
   DB_NAME=DcInvoice
   PORT=3000
   HOST=127.0.0.1                 # only Caddy on this machine may talk to Node directly
   TRUST_PROXY=true               # behind Caddy
   ALLOWED_ORIGINS=https://YOUR-PROJECT.vercel.app,https://*.vercel.app
   ADMIN_PASSWORD=********        # only used the very first time (admin account already exists now)
   ```
   Put your real Vercel address in `ALLOWED_ORIGINS` (you get it in Part B). `https://*.vercel.app` additionally allows Vercel preview deployments; remove it if you don't want that. If you later attach a custom domain to Vercel (e.g. `https://billing.datacaresoftech.com`), add it here too, comma separated.
4. Double-click `start.bat` once to confirm it starts: you should see `Open : http://localhost:3000` and `CORS : …`.

### A2. Give it a public HTTPS address (required – Vercel pages cannot call plain HTTP)
1. **DNS:** create an A record, e.g. `api.datacaresoftech.com → <server public IP>`.
2. **Firewall / router:** allow inbound **80** and **443** to this server. Keep **3000** closed to the internet.
3. **Caddy** (simplest way to get automatic HTTPS on Windows):
   - Download `caddy_windows_amd64.exe` from https://caddyserver.com/download, rename to `caddy.exe`, put it in `C:\DataCareInvoice\`.
   - Copy `server\Caddyfile` next to it and change the hostname to yours.
   - Run `caddy run --config Caddyfile` in that folder. Caddy obtains the certificate automatically within a few seconds.
   - Test in a browser: `https://api.datacaresoftech.com/api/health` → `{"ok":true,"database":"DcInvoice","auth":true}`.

   *Alternative without opening ports:* a **Cloudflare Tunnel** (`cloudflared`) pointing `api.datacaresoftech.com` at `http://127.0.0.1:3000` also works and gives HTTPS.

### A3. Keep it running after reboots
Install both programs as Windows services with **NSSM** (https://nssm.cc):
```
nssm install DataCareInvoiceAPI "C:\Program Files\nodejs\node.exe" "C:\DataCareInvoice\server\server.js"
nssm set     DataCareInvoiceAPI AppDirectory "C:\DataCareInvoice\server"
nssm install DataCareCaddy "C:\DataCareInvoice\caddy.exe" "run --config C:\DataCareInvoice\Caddyfile"
nssm set     DataCareCaddy AppDirectory "C:\DataCareInvoice"
nssm start DataCareInvoiceAPI
nssm start DataCareCaddy
```

---

## Part B – Frontend on Vercel

1. Edit **`js/config.js`** in the project root:
   ```js
   window.APP_CONFIG = { apiBase: 'https://api.datacaresoftech.com' };
   ```
   (no trailing slash; must be `https://`).
2. Deploy the **project root** to Vercel – either connect the Git repository or run `npx vercel` in the project folder. Framework preset: **Other**; no build command; output directory: leave empty (the root *is* the site). `.vercelignore` already excludes the `server/` folder, and `vercel.json` sets cache/security headers.
3. Note the deployed address (e.g. `https://datacare-invoice.vercel.app`) and put it in `ALLOWED_ORIGINS` on the server (Part A1), then restart the backend.
4. Open the Vercel address → the sign-in screen appears → sign in. The top bar shows **"SQL Server · DcInvoice"**.

If instead you see **"Cannot reach the server at https://api…"** with a *Retry connection* button:
- the backend is down, or
- the certificate/DNS isn't ready yet (open `https://api…/api/health` directly to check), or
- the Vercel origin isn't in `ALLOWED_ORIGINS` (check the backend's start-up line `CORS : …`).
The app deliberately does **not** fall back to browser-only storage in this mode, so nobody ends up with documents saved only on their own PC.

---

## Updating later
- **Frontend change:** push to Git (Vercel redeploys) or run `npx vercel --prod` again.
- **Backend change:** copy the new `server/` files over and restart the `DataCareInvoiceAPI` service.
- Keep `js/config.js` pointing at the API on the Vercel side; keep `.env` on the server side. Neither file should be shared publicly (`.env` holds passwords).

## Same-origin option (still supported)
Running only `server/start.bat` and opening `http://<server>:3000` continues to work exactly as before, with `apiBase: ''`.
