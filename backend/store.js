/* ============================================================================
 *  store.js — Data + auth persistence
 *  - Supabase (portfolio_data table) = PRIMARY store when configured
 *  - data.json / auth.json = local fallback (PC pe chalta hai)
 *  Isse Render/Vercel par bhi data permanent rehta hai.
 * ==========================================================================*/

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const SUPABASE_URL = (process.env.SUPABASE_URL || "")
  .replace(/\/+$/, "")
  .replace(/\/rest\/v1$/i, "");
const SUPABASE_SECRET_KEY =
  process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || "";

const SB_ON = !!(SUPABASE_URL && SUPABASE_SECRET_KEY);
const SB_TABLE = process.env.SUPABASE_DATA_TABLE || "portfolio_data";
const SB_TIMEOUT_MS = Number(process.env.SUPABASE_TIMEOUT_MS) || 5000;
const SB_COOLDOWN_MS = Number(process.env.SUPABASE_COOLDOWN_MS) || 30000;

const DATA_FILE = path.join(__dirname, "data.json");
const AUTH_FILE = path.join(__dirname, "auth.json");

/* ── Circuit breaker: Supabase fail ho to thodi der ke liye chhod do ── */
let sbDownUntil = 0;
let sbHealthy = false;

function sbUsable() {
  if (!SB_ON) return false;
  if (Date.now() < sbDownUntil) return false;
  return true;
}
function sbMarkOk() {
  sbHealthy = true;
  sbDownUntil = 0;
}
function sbMarkFail(reason) {
  sbHealthy = false;
  sbDownUntil = Date.now() + SB_COOLDOWN_MS;
  console.error("Supabase unavailable (" + reason + ") - local mode for " + (SB_COOLDOWN_MS / 1000) + "s");
}

/* Fetch with timeout — Supabase hang na ho to server freeze na ho */
async function sbFetch(url, options) {
  const ctrl = new AbortController();
  const timer = setTimeout(function () { ctrl.abort(); }, SB_TIMEOUT_MS);
  try {
    return await fetch(url, Object.assign({}, options, { signal: ctrl.signal }));
  } finally {
    clearTimeout(timer);
  }
}

/* ── Supabase REST helpers ── */
async function sbRequest(method, body, extraHeaders) {
  if (!SB_ON) return null;
  const headers = {
    apikey: SUPABASE_SECRET_KEY,
    Authorization: "Bearer " + SUPABASE_SECRET_KEY,
    "Content-Type": "application/json"
  };
  Object.assign(headers, extraHeaders || {});
  const res = await sbFetch(SUPABASE_URL + "/rest/v1/" + SB_TABLE, {
    method: method,
    headers: headers,
    body: body == null ? undefined : JSON.stringify(body)
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(
      "Supabase " + method + " " + SB_TABLE + " -> " + res.status + " " + text.slice(0, 300)
    );
  }
  return text ? JSON.parse(text) : null;
}

/* Ek row lo (id = n) */
async function sbGetRow(id) {
  if (!sbUsable()) return null;
  try {
    const q = await sbFetch(
      SUPABASE_URL + "/rest/v1/" + SB_TABLE + "?id=eq." + Number(id) + "&limit=1",
      {
        method: "GET",
        headers: {
          apikey: SUPABASE_SECRET_KEY,
          Authorization: "Bearer " + SUPABASE_SECRET_KEY
        }
      }
    );
    if (!q.ok) {
      const t = await q.text();
      throw new Error("GET row " + id + " -> " + q.status + " " + t.slice(0, 200));
    }
    sbMarkOk();
    return await q.json();
  } catch (e) {
    sbMarkFail(e && e.message);
    return null;
  }
}

/* Row likho / update karo */
async function sbPutRow(id, dataObj) {
  if (!sbUsable()) return false;
  try {
    await sbRequest("POST", [{ id: Number(id), data: dataObj, updated_at: new Date().toISOString() }], {
      Prefer: "resolution=merge-duplicates,return=minimal"
    });
    sbMarkOk();
    return true;
  } catch (e) {
    sbMarkFail(e && e.message);
    return false;
  }
}


function readJsonFile(file) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (e) {
    return null;
  }
}

function writeJsonFile(file, obj) {
  try {
    fs.writeFileSync(file, JSON.stringify(obj, null, 2));
    return true;
  } catch (e) {
    console.error("Local write failed (" + path.basename(file) + "):", e && e.message);
    return false;
  }
}

/* ── Data store ── */

/* Server start par: pehle Supabase, warna local file */
async function loadStore() {
  if (SB_ON) {
    const list = await sbGetRow(1);
    if (Array.isArray(list) && list.length && list[0].data && Object.keys(list[0].data).length) {
      console.log("Store: loaded from Supabase");
      return list[0].data;
    }
    console.log("Store: using local data.json (Supabase empty or offline)");
  }
  return readJsonFile(DATA_FILE) || {};
}

/* Save: Supabase primary + local mirror (backup) */
async function saveStore(store) {
  await sbPutRow(1, store);
  writeJsonFile(DATA_FILE, store);
}

/* ── Auth (admin credentials) ── */
function hashPassword(pw, salt) {
  const s = salt || crypto.randomBytes(16).toString("hex");
  const h = crypto.scryptSync(String(pw), s, 64).toString("hex");
  return { salt: s, hash: h };
}

async function loadAuth() {
  /* 1. env se banao (Render par env se hi chalega) */
  const envUser = String(process.env.ADMIN_USER || "").trim();
  const envPass = process.env.ADMIN_PASS || "";

  /* 2. Supabase table (same table, alag row) */
  if (SB_ON) {
    const list = await sbGetRow(2);
    if (Array.isArray(list) && list.length && list[0].data && list[0].data.hash) {
      console.log("Auth: loaded from Supabase");
      return {
        username: String(list[0].data.username),
        salt: String(list[0].data.salt),
        hash: String(list[0].data.hash)
      };
    }
  }

  /* 3. local auth.json */
  const saved = readJsonFile(AUTH_FILE);
  if (saved && saved.username && saved.salt && saved.hash) {
    return { username: String(saved.username), salt: String(saved.salt), hash: String(saved.hash) };
  }

  /* 4. env se fresh banao aur save karo */
  const user = envUser || "admin";
  const pass = envPass || "admin123";
  const fresh = { username: user, salt: "", hash: "" };
  Object.assign(fresh, hashPassword(pass));
  writeJsonFile(AUTH_FILE, fresh);
  await sbPutRow(2, fresh);
  return fresh;
}

async function saveAuth(auth) {
  writeJsonFile(AUTH_FILE, auth);
  await sbPutRow(2, auth);
}

module.exports = {
  SB_ON: SB_ON,
  SB_TABLE: SB_TABLE,
  SUPABASE_URL: SUPABASE_URL,
  SUPABASE_SECRET_KEY: SUPABASE_SECRET_KEY,
  sbHealthy: function () { return sbHealthy; },
  sbRequest: sbRequest,
  loadStore: loadStore,
  saveStore: saveStore,
  loadAuth: loadAuth,
  saveAuth: saveAuth,
  hashPassword: hashPassword
};
