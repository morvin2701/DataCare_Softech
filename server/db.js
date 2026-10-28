'use strict';
/* SQL Server access: connection pool, schema creation, and the queries used by the API. */

const crypto = require('crypto');
const sql = require('mssql');

const env = process.env;
const DB_NAME = (env.DB_NAME || 'DcInvoice').replace(/[^\w]/g, '');
/* Regions (teams) are rows in dbo.Regions. Each belongs to a visibility group: a user sees only the regions in
   their own group. UAE and IN share group 'A' (one business, two offices); a separately run team gets its own group. */
let REGIONS = ['UAE', 'IN'];                 // codes, refreshed from the table at start-up and whenever a region is added
let REGION_ROWS = [];                        // [{ code, name, group, country, dial, currency, taxLabel, taxRate, sortOrder }]
const regionGroup = code => (REGION_ROWS.find(r => r.code === code) || {}).group || 'A';
const regionsInGroup = group => REGION_ROWS.filter(r => r.group === group).map(r => r.code);
async function refreshRegions() {
  const r = await pool.request().query('SELECT Code, Name, GroupCode, Country, Dial, Currency, TaxLabel, TaxRate, SortOrder FROM dbo.Regions WHERE Active = 1 ORDER BY SortOrder, Code');
  REGION_ROWS = r.recordset.map(x => ({ code: x.Code, name: x.Name, group: x.GroupCode, country: x.Country, dial: x.Dial, currency: x.Currency, taxLabel: x.TaxLabel, taxRate: Number(x.TaxRate), sortOrder: x.SortOrder }));
  REGIONS = REGION_ROWS.map(x => x.code);
  module.exports.REGIONS = REGIONS;
}

function baseConfig(database) {
  return {
    server: env.DB_SERVER,
    port: Number(env.DB_PORT) || 1433,
    user: env.DB_USER,
    password: env.DB_PASSWORD,
    database,
    pool: { max: 10, min: 0, idleTimeoutMillis: 30000 },
    options: {
      encrypt: String(env.DB_ENCRYPT).toLowerCase() === 'true',
      trustServerCertificate: true,
      enableArithAbort: true
    },
    connectionTimeout: 15000,
    requestTimeout: 30000
  };
}

let pool = null;

/* ---------- passwords ---------- */
function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return `scrypt$${salt}$${hash}`;
}
function verifyPassword(password, stored) {
  const [, salt, hash] = String(stored || '').split('$');
  if (!salt || !hash) return false;
  const test = crypto.scryptSync(password, salt, 64);
  const ref = Buffer.from(hash, 'hex');
  return test.length === ref.length && crypto.timingSafeEqual(test, ref);
}

/** Creates the database (if missing), the tables and the first admin account, then opens the pool. */
async function init() {
  const master = await new sql.ConnectionPool(baseConfig('master')).connect();
  try {
    await master.request().query(`IF DB_ID('${DB_NAME}') IS NULL CREATE DATABASE [${DB_NAME}]`);
  } finally {
    await master.close();
  }

  pool = await new sql.ConnectionPool(baseConfig(DB_NAME)).connect();
  await pool.request().batch(`
    -- settings are kept per region (UAE / IN)
    IF OBJECT_ID('dbo.RegionSettings', 'U') IS NULL
    CREATE TABLE dbo.RegionSettings (
      Region    NVARCHAR(8)   NOT NULL CONSTRAINT PK_RegionSettings PRIMARY KEY,
      Data      NVARCHAR(MAX) NOT NULL,
      UpdatedAt DATETIME2     NOT NULL CONSTRAINT DF_RegionSettings_UpdatedAt DEFAULT SYSUTCDATETIME(),
      UpdatedBy NVARCHAR(60)  NULL
    );
    -- the earlier single-row settings table is no longer used; remove it only if it is empty
    IF OBJECT_ID('dbo.AppSettings', 'U') IS NOT NULL
      EXEC('IF NOT EXISTS (SELECT 1 FROM dbo.AppSettings) DROP TABLE dbo.AppSettings');

    IF OBJECT_ID('dbo.Documents', 'U') IS NULL
    CREATE TABLE dbo.Documents (
      Id        NVARCHAR(40)  NOT NULL CONSTRAINT PK_Documents PRIMARY KEY,
      DocType   NVARCHAR(12)  NOT NULL,
      Branch    NVARCHAR(8)   NOT NULL,
      DocNumber NVARCHAR(60)  NOT NULL CONSTRAINT DF_Documents_DocNumber DEFAULT '',
      DocDate   DATE          NULL,
      Status    NVARCHAR(30)  NULL,
      Company   NVARCHAR(200) NULL,
      Currency  NVARCHAR(5)   NULL,
      Total     DECIMAL(18,2) NULL,
      Data      NVARCHAR(MAX) NOT NULL,
      CreatedAt DATETIME2     NOT NULL CONSTRAINT DF_Documents_CreatedAt DEFAULT SYSUTCDATETIME(),
      UpdatedAt DATETIME2     NOT NULL CONSTRAINT DF_Documents_UpdatedAt DEFAULT SYSUTCDATETIME()
    );
    IF COL_LENGTH('dbo.Documents', 'CreatedBy') IS NULL ALTER TABLE dbo.Documents ADD CreatedBy NVARCHAR(60) NULL, UpdatedBy NVARCHAR(60) NULL;

    -- a number may be used only once per document type (blank numbers are allowed while drafting)
    IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'UX_Documents_TypeNumber')
    CREATE UNIQUE INDEX UX_Documents_TypeNumber ON dbo.Documents (DocType, DocNumber) WHERE DocNumber <> '';
    IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_Documents_Updated')
    CREATE INDEX IX_Documents_Updated ON dbo.Documents (UpdatedAt DESC);

    -- signed order forms (PDF / image) uploaded when an order is completed
    IF OBJECT_ID('dbo.DocumentFiles', 'U') IS NULL
    CREATE TABLE dbo.DocumentFiles (
      Id         NVARCHAR(40)   NOT NULL CONSTRAINT PK_DocumentFiles PRIMARY KEY,
      DocId      NVARCHAR(40)   NOT NULL,
      Kind       NVARCHAR(20)   NOT NULL,
      FileName   NVARCHAR(200)  NOT NULL,
      MimeType   NVARCHAR(100)  NOT NULL,
      Size       INT            NOT NULL,
      Content    VARBINARY(MAX) NOT NULL,
      UploadedBy NVARCHAR(100)  NULL,
      UploadedAt DATETIME2      NOT NULL CONSTRAINT DF_DocumentFiles_UploadedAt DEFAULT SYSUTCDATETIME()
    );
    IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_DocumentFiles_Doc')
    CREATE INDEX IX_DocumentFiles_Doc ON dbo.DocumentFiles (DocId);

    IF OBJECT_ID('dbo.Users', 'U') IS NULL
    CREATE TABLE dbo.Users (
      Id           INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_Users PRIMARY KEY,
      Username     NVARCHAR(60)  NOT NULL,
      PasswordHash NVARCHAR(200) NOT NULL,
      DisplayName  NVARCHAR(100) NOT NULL,
      Phone        NVARCHAR(40)  NULL,
      Region       NVARCHAR(8)   NOT NULL,
      Role         NVARCHAR(12)  NOT NULL CONSTRAINT DF_Users_Role DEFAULT 'user',
      Active       BIT           NOT NULL CONSTRAINT DF_Users_Active DEFAULT 1,
      CreatedAt    DATETIME2     NOT NULL CONSTRAINT DF_Users_CreatedAt DEFAULT SYSUTCDATETIME(),
      LastLoginAt  DATETIME2     NULL
    );
    IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'UX_Users_Username')
    CREATE UNIQUE INDEX UX_Users_Username ON dbo.Users (Username);

    IF OBJECT_ID('dbo.Regions', 'U') IS NULL
    BEGIN
      CREATE TABLE dbo.Regions (
        Code      NVARCHAR(8)   NOT NULL CONSTRAINT PK_Regions PRIMARY KEY,
        Name      NVARCHAR(60)  NOT NULL,
        GroupCode NVARCHAR(8)   NOT NULL,     -- visibility group
        Country   NVARCHAR(40)  NOT NULL,
        Dial      NVARCHAR(8)   NOT NULL,     -- login password prefix, e.g. +91
        Currency  NVARCHAR(5)   NOT NULL,
        TaxLabel  NVARCHAR(10)  NOT NULL,
        TaxRate   DECIMAL(5,2)  NOT NULL,
        SortOrder INT           NOT NULL CONSTRAINT DF_Regions_Sort DEFAULT 0,
        Active    BIT           NOT NULL CONSTRAINT DF_Regions_Active DEFAULT 1
      );
      INSERT INTO dbo.Regions (Code, Name, GroupCode, Country, Dial, Currency, TaxLabel, TaxRate, SortOrder) VALUES
        ('UAE', 'UAE · Dubai', 'A', 'UAE',   '+971', 'AED', 'VAT', 5,  1),
        ('IN',  'India',       'A', 'India', '+91',  'INR', 'GST', 18, 2);
    END

    IF OBJECT_ID('dbo.Sessions', 'U') IS NULL
    CREATE TABLE dbo.Sessions (
      Token     NVARCHAR(80) NOT NULL CONSTRAINT PK_Sessions PRIMARY KEY,
      UserId    INT          NOT NULL,
      Region    NVARCHAR(8)  NOT NULL,
      CreatedAt DATETIME2    NOT NULL CONSTRAINT DF_Sessions_CreatedAt DEFAULT SYSUTCDATETIME(),
      ExpiresAt DATETIME2    NOT NULL
    );
  `);

  await refreshRegions();

  // first run: create the administrator account
  const users = await pool.request().query('SELECT COUNT(*) AS n FROM dbo.Users');
  if (users.recordset[0].n === 0) {
    const generated = !env.ADMIN_PASSWORD;
    const pw = env.ADMIN_PASSWORD || crypto.randomBytes(6).toString('base64url');
    await createUser({ username: 'admin', password: pw, displayName: 'Administrator', phone: '', region: 'UAE', role: 'admin' });
    console.log(generated
      ? `  First run: created user "admin" with password  ${pw}  (no ADMIN_PASSWORD in .env). Write it down and change it after signing in.`
      : '  First run: created user "admin" (password from ADMIN_PASSWORD in .env). Change it after signing in.');
  }
  return pool;
}

const DUPLICATE_ERRORS = new Set([2601, 2627]);
const isDuplicate = err => DUPLICATE_ERRORS.has(err && err.number);

/* ---------- regions ---------- */
function validRegion(r) {
  const errors = [];
  if (!/^[A-Z0-9]{2,8}$/.test(r.code || '')) errors.push('Code: 2–8 capital letters or digits, e.g. IN2.');
  if (!(r.name || '').trim()) errors.push('Name is required.');
  if (!/^[A-Z0-9]{1,8}$/.test(r.group || '')) errors.push('Group: 1–8 capital letters or digits, e.g. B.');
  if (!/^\+\d{1,4}$/.test(r.dial || '')) errors.push('Dial code must look like +91.');
  if (!/^[A-Z]{3}$/.test(r.currency || '')) errors.push('Currency must be a 3-letter code, e.g. INR.');
  if (!(r.taxLabel || '').trim()) errors.push('Tax label is required (e.g. GST).');
  if (!(Number(r.taxRate) >= 0)) errors.push('Tax rate must be a number.');
  return errors;
}
async function createRegion(r) {
  const errors = validRegion(r);
  if (errors.length) { const e = new Error(errors.join(' ')); e.status = 400; throw e; }
  await pool.request()
    .input('code', sql.NVarChar(8), r.code).input('name', sql.NVarChar(60), r.name.trim()).input('group', sql.NVarChar(8), r.group)
    .input('country', sql.NVarChar(40), (r.country || r.name).trim()).input('dial', sql.NVarChar(8), r.dial).input('cur', sql.NVarChar(5), r.currency)
    .input('tl', sql.NVarChar(10), r.taxLabel.trim()).input('tr', sql.Decimal(5, 2), Number(r.taxRate)).input('so', sql.Int, REGION_ROWS.length + 1)
    .query('INSERT INTO dbo.Regions (Code, Name, GroupCode, Country, Dial, Currency, TaxLabel, TaxRate, SortOrder) VALUES (@code, @name, @group, @country, @dial, @cur, @tl, @tr, @so)');
  await refreshRegions();
  return REGION_ROWS.find(x => x.code === r.code);
}

/* ---------- users & sessions ---------- */
const publicUser = u => u && ({
  id: u.Id, username: u.Username, displayName: u.DisplayName, phone: u.Phone || '',
  region: u.Region, group: regionGroup(u.Region), role: u.Role, active: !!u.Active, lastLoginAt: u.LastLoginAt, createdAt: u.CreatedAt
});

async function listUsers(group) {
  const r = await pool.request().query('SELECT * FROM dbo.Users ORDER BY Region, DisplayName');
  return r.recordset.map(publicUser).filter(u => !group || u.group === group);
}

async function getUser(id) {
  const r = await pool.request().input('id', sql.Int, id).query('SELECT * FROM dbo.Users WHERE Id = @id');
  return r.recordset[0] || null;
}

function validUser(u, { requirePassword }) {
  const errors = [];
  if (!/^[a-z0-9._-]{3,60}$/i.test(u.username || '')) errors.push('Username: 3–60 letters, numbers, dots, dashes or underscores.');
  if (!(u.displayName || '').trim()) errors.push('Name is required.');
  if (!REGIONS.includes(u.region)) errors.push(`Team must be one of: ${REGIONS.join(', ')}.`);
  if (!['admin', 'user'].includes(u.role)) errors.push('Role must be admin or user.');
  if (requirePassword && String(u.password || '').length < 6) errors.push('Password must be at least 6 characters.');
  return errors;
}

async function createUser(u) {
  const errors = validUser(u, { requirePassword: true });
  if (errors.length) { const e = new Error(errors.join(' ')); e.status = 400; throw e; }
  const r = await pool.request()
    .input('username', sql.NVarChar(60), u.username.trim().toLowerCase())
    .input('hash', sql.NVarChar(200), hashPassword(u.password))
    .input('name', sql.NVarChar(100), u.displayName.trim())
    .input('phone', sql.NVarChar(40), (u.phone || '').trim())
    .input('region', sql.NVarChar(8), u.region)
    .input('role', sql.NVarChar(12), u.role)
    .query(`INSERT INTO dbo.Users (Username, PasswordHash, DisplayName, Phone, Region, Role)
            OUTPUT INSERTED.* VALUES (@username, @hash, @name, @phone, @region, @role)`);
  return publicUser(r.recordset[0]);
}

async function updateUser(id, u) {
  const errors = validUser(u, { requirePassword: false });
  if (errors.length) { const e = new Error(errors.join(' ')); e.status = 400; throw e; }
  const r = await pool.request()
    .input('id', sql.Int, id)
    .input('username', sql.NVarChar(60), u.username.trim().toLowerCase())
    .input('name', sql.NVarChar(100), u.displayName.trim())
    .input('phone', sql.NVarChar(40), (u.phone || '').trim())
    .input('region', sql.NVarChar(8), u.region)
    .input('role', sql.NVarChar(12), u.role)
    .input('active', sql.Bit, u.active === false ? 0 : 1)
    .query(`UPDATE dbo.Users SET Username=@username, DisplayName=@name, Phone=@phone, Region=@region, Role=@role, Active=@active
            OUTPUT INSERTED.* WHERE Id = @id`);
  if (!r.recordset.length) { const e = new Error('user not found'); e.status = 404; throw e; }
  if (!u.active) await pool.request().input('id', sql.Int, id).query('DELETE FROM dbo.Sessions WHERE UserId = @id');
  return publicUser(r.recordset[0]);
}

async function setPassword(id, password) {
  if (String(password || '').length < 6) { const e = new Error('Password must be at least 6 characters.'); e.status = 400; throw e; }
  await pool.request().input('id', sql.Int, id).input('hash', sql.NVarChar(200), hashPassword(password))
    .query('UPDATE dbo.Users SET PasswordHash = @hash WHERE Id = @id; DELETE FROM dbo.Sessions WHERE UserId = @id');
}

async function countActiveAdmins() {
  const r = await pool.request().query(`SELECT COUNT(*) AS n FROM dbo.Users WHERE Role = 'admin' AND Active = 1`);
  return r.recordset[0].n;
}

const SESSION_DAYS = 30;

/** Checks credentials and opens a session. Returns { token, user } or null. */
async function login(username, password, region) {
  const r = await pool.request().input('u', sql.NVarChar(60), String(username || '').trim().toLowerCase())
    .query('SELECT * FROM dbo.Users WHERE Username = @u');
  const row = r.recordset[0];
  if (!row || !row.Active || !verifyPassword(String(password || ''), row.PasswordHash)) return null;
  if (row.Role !== 'admin' && region && region !== row.Region) return { wrongRegion: row.Region };
  const useRegion = REGIONS.includes(region) ? region : row.Region;
  const token = crypto.randomBytes(32).toString('base64url');
  await pool.request().input('t', sql.NVarChar(80), token).input('id', sql.Int, row.Id).input('r', sql.NVarChar(8), useRegion)
    .input('exp', sql.DateTime2, new Date(Date.now() + SESSION_DAYS * 864e5))
    .query(`DELETE FROM dbo.Sessions WHERE ExpiresAt < SYSUTCDATETIME();
            INSERT INTO dbo.Sessions (Token, UserId, Region, ExpiresAt) VALUES (@t, @id, @r, @exp);
            UPDATE dbo.Users SET LastLoginAt = SYSUTCDATETIME() WHERE Id = @id`);
  return { token, user: { ...publicUser(row), region: useRegion, homeRegion: row.Region } };
}

async function sessionUser(token) {
  if (!token) return null;
  const r = await pool.request().input('t', sql.NVarChar(80), token).query(`
    SELECT u.*, s.Region AS SessionRegion FROM dbo.Sessions s JOIN dbo.Users u ON u.Id = s.UserId
    WHERE s.Token = @t AND s.ExpiresAt > SYSUTCDATETIME() AND u.Active = 1`);
  const row = r.recordset[0];
  if (!row) return null;
  return { ...publicUser(row), region: row.Role === 'admin' ? row.SessionRegion : row.Region, homeRegion: row.Region };
}

async function setSessionRegion(token, region) {
  await pool.request().input('t', sql.NVarChar(80), token).input('r', sql.NVarChar(8), region)
    .query('UPDATE dbo.Sessions SET Region = @r WHERE Token = @t');
}

async function logout(token) {
  if (token) await pool.request().input('t', sql.NVarChar(80), token).query('DELETE FROM dbo.Sessions WHERE Token = @t');
}

/* ---------- settings ---------- */
async function getAllSettings(group) {
  const r = await pool.request().query('SELECT Region, Data FROM dbo.RegionSettings');
  const out = {};
  for (const row of r.recordset) if (!group || regionGroup(row.Region) === group) out[row.Region] = JSON.parse(row.Data);
  return out;
}

async function putSettings(region, data, by, request = pool.request()) {
  await request.input('region', sql.NVarChar(8), region).input('data', sql.NVarChar(sql.MAX), JSON.stringify(data))
    .input('by', sql.NVarChar(60), by || null).query(`
    MERGE dbo.RegionSettings AS t
    USING (SELECT @region AS Region) AS s ON t.Region = s.Region
    WHEN MATCHED THEN UPDATE SET Data = @data, UpdatedAt = SYSUTCDATETIME(), UpdatedBy = @by
    WHEN NOT MATCHED THEN INSERT (Region, Data, UpdatedBy) VALUES (@region, @data, @by);`);
}

/* ---------- documents ---------- */
async function listDocs(group) {
  const codes = group ? regionsInGroup(group) : null;
  const r = await pool.request().query('SELECT Branch, Data FROM dbo.Documents ORDER BY UpdatedAt DESC');
  return r.recordset.filter(row => !codes || codes.includes(row.Branch)).map(row => JSON.parse(row.Data));
}

async function getDocBranch(id) {
  const r = await pool.request().input('id', sql.NVarChar(40), id).query('SELECT Branch FROM dbo.Documents WHERE Id = @id');
  return r.recordset.length ? r.recordset[0].Branch : null;
}

function docColumns(d) {
  const items = Array.isArray(d.items) ? d.items : [];
  const sub = items.reduce((s, it) => s + (Number(it.amount) || 0), 0);
  const disc = Math.min(Number(d.discount) || 0, sub);
  const tax = d.taxEnabled ? (sub - disc) * (Number(d.taxRate) || 0) / 100 : 0;
  return {
    id: String(d.id || '').slice(0, 40),
    type: String(d.type || '').slice(0, 12),
    branch: String(d.branch || '').slice(0, 8),
    number: String(d.number || '').slice(0, 60),
    date: /^\d{4}-\d{2}-\d{2}$/.test(d.date || '') ? d.date : null,
    status: String(d.status || '').slice(0, 30),
    company: String((d.customer && d.customer.company) || '').slice(0, 200),
    currency: String(d.currency || '').slice(0, 5),
    total: Math.round((sub - disc + tax) * 100) / 100
  };
}

async function putDoc(d, by, request = pool.request()) {
  const c = docColumns(d);
  if (!c.id || !c.type || !REGIONS.includes(c.branch)) { const e = new Error('id, type and a valid branch are required'); e.status = 400; throw e; }
  await request
    .input('id', sql.NVarChar(40), c.id)
    .input('type', sql.NVarChar(12), c.type)
    .input('branch', sql.NVarChar(8), c.branch)
    .input('number', sql.NVarChar(60), c.number)
    .input('date', sql.Date, c.date)
    .input('status', sql.NVarChar(30), c.status)
    .input('company', sql.NVarChar(200), c.company)
    .input('currency', sql.NVarChar(5), c.currency)
    .input('total', sql.Decimal(18, 2), c.total)
    .input('data', sql.NVarChar(sql.MAX), JSON.stringify(d))
    .input('by', sql.NVarChar(60), by || null)
    .query(`
      MERGE dbo.Documents AS t
      USING (SELECT @id AS Id) AS s ON t.Id = s.Id
      WHEN MATCHED THEN UPDATE SET DocType=@type, Branch=@branch, DocNumber=@number, DocDate=@date, Status=@status,
        Company=@company, Currency=@currency, Total=@total, Data=@data, UpdatedAt=SYSUTCDATETIME(), UpdatedBy=@by
      WHEN NOT MATCHED THEN INSERT (Id, DocType, Branch, DocNumber, DocDate, Status, Company, Currency, Total, Data, CreatedBy, UpdatedBy)
        VALUES (@id, @type, @branch, @number, @date, @status, @company, @currency, @total, @data, @by, @by);`);
}

async function deleteDoc(id) {
  const r = await pool.request().input('id', sql.NVarChar(40), id)
    .query('DELETE FROM dbo.DocumentFiles WHERE DocId = @id; DELETE FROM dbo.Documents WHERE Id = @id');
  return r.rowsAffected[r.rowsAffected.length - 1] > 0;
}

/* ---------- files attached to a document (signed order forms) ---------- */
async function putFile(f) {
  await pool.request()
    .input('id', sql.NVarChar(40), f.id).input('doc', sql.NVarChar(40), f.docId).input('kind', sql.NVarChar(20), f.kind)
    .input('name', sql.NVarChar(200), f.fileName).input('mime', sql.NVarChar(100), f.mimeType).input('size', sql.Int, f.size)
    .input('content', sql.VarBinary(sql.MAX), f.content).input('by', sql.NVarChar(100), f.uploadedBy || null)
    .query(`INSERT INTO dbo.DocumentFiles (Id, DocId, Kind, FileName, MimeType, Size, Content, UploadedBy)
            VALUES (@id, @doc, @kind, @name, @mime, @size, @content, @by)`);
}

async function getFile(id) {
  const r = await pool.request().input('id', sql.NVarChar(40), id)
    .query('SELECT Id, DocId, Kind, FileName, MimeType, Size, Content, UploadedBy, UploadedAt FROM dbo.DocumentFiles WHERE Id = @id');
  return r.recordset[0] || null;
}

/** Replaces one region's settings and documents (used by "Import backup"). All or nothing. */
async function importRegion(region, settings, docs, by) {
  const tx = new sql.Transaction(pool);
  await tx.begin();
  try {
    await new sql.Request(tx).input('r', sql.NVarChar(8), region).query('DELETE FROM dbo.Documents WHERE Branch = @r');
    if (settings) await putSettings(region, settings, by, new sql.Request(tx));
    for (const d of docs) if (d.branch === region) await putDoc(d, by, new sql.Request(tx));
    await tx.commit();
  } catch (err) {
    await tx.rollback();
    throw err;
  }
}

async function stats() {
  const r = await pool.request().query('SELECT Branch, COUNT(*) AS n FROM dbo.Documents GROUP BY Branch');
  const documents = {};
  for (const row of r.recordset) documents[row.Branch] = row.n;
  return { database: DB_NAME, documents };
}

module.exports = {
  init, isDuplicate, REGIONS, DB_NAME,
  listUsers, getUser, createUser, updateUser, setPassword, countActiveAdmins, verifyPassword,
  login, sessionUser, setSessionRegion, logout,
  getAllSettings, putSettings, listDocs, getDocBranch, putDoc, deleteDoc, importRegion, stats,
  putFile, getFile,
  regionRows: () => REGION_ROWS, regionGroup, regionsInGroup, createRegion, refreshRegions
};
