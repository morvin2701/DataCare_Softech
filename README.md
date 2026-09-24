# DataCare Softech – Invoice & Quotation Generator

Open **index.html** in Chrome, Edge or Safari (double-click it). You don't need to install anything or be online.

## Daily use
1. Click **+ New Quotation** or **+ New Invoice**.
2. Choose the issuing branch (**UAE** or **India**). This sets the currency (AED/INR), tax label (VAT/GST), phone numbers and header order.
3. Enter the customer. Previously saved customers autofill when you type their company name.
4. Add rows, or pick from **Add from price list…**
5. Click **Save** (Ctrl/Cmd + S). The document number is assigned automatically on the first save.
6. Click **Download PDF**, or **Print** and choose "Save as PDF" for a PDF with selectable text.

- **Saved Documents** lets you search, reopen, duplicate, delete, download a PDF again, or turn a quotation into an invoice (**→ Invoice**).
- Optional extras on each document: discount, VAT/GST, advance received / balance due, amount in words, notes, hardware configuration, the customer signature block, and a company stamp.

## Design
Use the **Premium / Classic** selector above the preview to switch between the two designs. Premium, the new modern design, is the default. Classic follows your original PDF layout.
If you upload a logo in Settings, it replaces the four-colour mark and the company name still appears next to it. Tick **"My logo image already includes the company name"** only if your image contains the name as well.

## Settings
Use the left-hand menu to jump between sections: Company, Branding (logo and stamp, with a live header preview), Branches, Document defaults, Numbering (with a live preview of the next numbers), Price list (an editable table), Default text, and Backup & data. Settings save automatically; the green "All changes saved" pill at the top confirms it.

## Storing data in SQL Server (recommended)
Out of the box the app keeps data inside the browser. To store documents and settings in your SQL Server instead, run the small server in the `server/` folder. It creates its own database, **DcInvoice**, and never touches your other databases.

**One-time setup (on the Windows server, or any PC that can reach SQL Server on port 1433):**
1. Install Node.js LTS from https://nodejs.org (tick "Add to PATH").
2. Open `server/.env` and check the SQL Server details (`DB_SERVER`, `DB_PORT`, `DB_USER`, `DB_PASSWORD`). `.env` contains the password – keep it private.
3. Double-click `server/start.bat`. The first run installs dependencies; you should then see `Open : http://localhost:3000`.

**Daily use:** keep `start.bat` running and open **http://localhost:3000** in the browser. The green pill **"SQL Server · DcInvoice"** in the top bar confirms the connection. Other computers on the same network can use it at `http://<server-ip>:3000` (allow port 3000 in Windows Firewall).

## Sign-in, teams and permissions
When the app runs with the server, everyone signs in with a username and password. Each account belongs to one team: **UAE (Dubai)** or **India**.

- **First sign-in:** username `admin`, password = the `ADMIN_PASSWORD` you set in `server/.env` before the first start. Change it straight away via the user menu (top right) → **Change password**.
- **Adding people:** as `admin`, open **Team** in the top bar and use **+ Add member** under the UAE or India section. Enter their name, mobile, username, team and a starting password. Their name and mobile become the default "Prepared by" on the documents they create.
- **What a member sees:** new documents are always issued from their own team's branch (currency, tax and phone order follow automatically). **Saved Documents** has UAE / India tabs and opens on their own team; the other team's documents can be opened and downloaded as PDF but are **view only**. **Settings** shows and changes only their own team's settings.
- **Administrator:** can switch between teams with the UAE / India switch in the top bar, edit both teams' settings and documents, and manage accounts (edit, set a new password, deactivate / re-activate). The last active administrator cannot be demoted or deactivated.
- **Security notes:** passwords are stored hashed; sessions last 30 days or until sign-out / password change; ten wrong passwords in a row from one computer block sign-in for 15 minutes; the server enforces all team rules, not just the screen.
- Opening `index.html` directly (without the server) needs no sign-in and keeps data in that browser only – there is nothing shared to protect in that mode.

- The first time a browser connects, any documents already saved in that browser are copied up to the database.
- If the server is not running, the app still works and shows **"Browser storage"** – data is kept locally only.
- If the connection drops mid-work, changes are queued (**"Syncing…"**) and sent automatically when it is back.
- Two people saving at the same moment cannot get the same number: the database rejects the duplicate and the app moves that document to the next free number and tells you.
- To run the server automatically at Windows start-up, create a scheduled task that runs `server\start.bat`, or install it as a service with a tool such as NSSM.

## Backups
Use **Settings → Export backup** regularly, whether you use SQL Server or not. **Import backup** restores a file (it replaces the current data). Without the server, clearing the browser's site data erases the documents unless you have a backup.
