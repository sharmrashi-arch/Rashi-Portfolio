/* ═══════════════════════════════════════════════════════
   Rashi Portfolio — backend/server.js
   Dependency-free Node http server:
   • Serves frontend (static)
   • POST /api/send       → Resend email + saves to data.json + Supabase sync
   • GET  /admin          → admin login page
   • POST /api/admin/login → session cookie (HttpOnly)
   • POST /api/admin/recover/{start,verify,reset} → forgot-password via email code
   • GET  /admin/dashboard → protected dashboard page
   • /api/admin/*          → protected CRUD API
                           (site/hero/about/journey/skills/projects/credentials)
   • Credentials live in auth.json (scrypt-hashed, git-ignored), seeded from .env
   • Supabase sync (optional): SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY in .env
   ═══════════════════════════════════════════════════════ */
const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

/* ── Tiny .env loader (no deps) ── */
function loadEnv(file) {
  try {
    const content = fs.readFileSync(file, "utf8");
    content.split(/\r?\n/).forEach(function (line) {
      line = line.trim();
      if (!line || line.startsWith("#")) return;
      const eq = line.indexOf("=");
      if (eq === -1) return;
      const key = line.slice(0, eq).trim();
      let value = line.slice(eq + 1).trim();
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
      if (!(key in process.env)) {
        process.env[key] = value;
      }
    });
  } catch (e) {
    console.warn("Missing .env file, using environment variables.");
  }
}
loadEnv(path.join(__dirname, ".env"));

/* store.js ko .env load ke BAAD require karo (usko env chahiye) */
const storeLib = require("./store.js");

/* ── Config ── */
const PORT = Number(process.env.PORT) || 3000;
const RESEND_KEY = process.env.RESEND_KEY || (process.env.RESENDKEY || "");
const FROM_EMAIL = process.env.FROM_EMAIL || "onboarding@resend.dev";
const TO_EMAIL = process.env.TO_EMAIL || "sharmaaaarashi@gmail.com";

const SESSION_SECRET = process.env.ADMIN_SESSION_SECRET || "dev-session-secret-change-me";
const SESSION_TTL_MS = 12 * 60 * 60 * 1000;

/* ── Allowed origins (Vercel frontend → Render backend) ──
   Defaults are ALWAYS allowed; ALLOWED_ORIGINS (comma separated) can only
   ADD origins, never remove the defaults. A stray or typo'd Render env value
   must not be able to break CORS for the real frontend. */
const DEFAULT_ALLOWED_ORIGINS = [
  "https://rashisharma-portfolio.vercel.app",
  "http://localhost:3000",
];
const ALLOWED_ORIGINS = DEFAULT_ALLOWED_ORIGINS.concat(
  (process.env.ALLOWED_ORIGINS || "")
    .split(",")
    .map(function (s) { return s.trim().replace(/\/+$/, ""); })
    .filter(function (s) { return s && DEFAULT_ALLOWED_ORIGINS.indexOf(s) === -1; })
);

const RECOVERY_EMAIL = String(process.env.RECOVERY_EMAIL || TO_EMAIL).trim().toLowerCase();
const RESET_CODE_TTL_MS = 10 * 60 * 1000;
const RESET_TOKEN_TTL_MS = 15 * 60 * 1000;
const RESET_MAX_ATTEMPTS = 5;
const RESET_RESEND_COOLDOWN_MS = 45 * 1000;

const SUPABASE_URL = (process.env.SUPABASE_URL || "")
  .replace(/\/+$/, "")
  .replace(/\/rest\/v1$/i, "");
const SUPABASE_PUBLISHABLE_KEY = process.env.SUPABASE_PUBLISHABLE_KEY || "";
const SUPABASE_SECRET_KEY =
  process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const supabaseOn = !!(SUPABASE_URL && SUPABASE_SECRET_KEY);
const SB_BUCKET = String(process.env.SUPABASE_BUCKET || "portfolio-images").replace(/[^a-z0-9_-]/gi, "");
/* Cached result of the startup bucket check. "null" = not checked yet
   (Supabase off), "ready"/"unavailable" = storage works / falls back. */
let SB_STORAGE_STATUS = null;

const BASE = path.join(__dirname, "..", "frontend");
const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".ico": "image/x-icon",
  ".json": "application/json; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".xml": "application/xml; charset=utf-8"
};

/* ── Admin credentials (auth.json — git-ignored) ── */
const sessions = new Map();
const resetCodes = new Map();
const resetTokens = new Map();
const loginFails = new Map();

function hashPassword(pw, salt) {
  const s = salt || crypto.randomBytes(16).toString("hex");
  const h = crypto.scryptSync(String(pw), s, 64).toString("hex");
  return { salt: s, hash: h };
}
function verifyPassword(pw, salt, expectedHash) {
  try {
    const got = Buffer.from(hashPassword(pw, salt).hash, "hex");
    const want = Buffer.from(String(expectedHash), "hex");
    if (got.length !== want.length) return false;
    return crypto.timingSafeEqual(got, want);
  } catch (e) {
    return false;
  }
}
function safeUsername(u) {
  return String(u || "").trim().slice(0, 64);
}
function passwordProblem(pw) {
  const s = String(pw == null ? "" : pw);
  if (s.length < 6) return "Password must be at least 6 characters.";
  if (s.length > 200) return "Password is too long.";
  return null;
}

function saveAuth() {
  storeLib.saveAuth(auth);
}
let auth = { username: "admin", salt: "", hash: "" };

function clientIp(req) {
  return String(req.socket && req.socket.remoteAddress ? req.socket.remoteAddress : "unknown");
}
function loginBlocked(ip) {
  const rec = loginFails.get(ip);
  if (!rec) return 0;
  if (Date.now() > rec.until) {
    loginFails.delete(ip);
    return 0;
  }
  return rec.until - Date.now();
}
function noteLoginFail(ip) {
  const rec = loginFails.get(ip) || { count: 0, until: 0 };
  rec.count += 1;
  if (rec.count >= 8) {
    rec.until = Date.now() + 15 * 60 * 1000;
    rec.count = 0;
  }
  loginFails.set(ip, rec);
}
function clearLoginFails(ip) {
  loginFails.delete(ip);
}

/* ── Data store (data.json) ── */

const UPLOAD_DIR = path.join(BASE, "images", "uploads");
const IMAGE_EXTS = [".jpg", ".jpeg", ".png", ".webp", ".gif", ".svg", ".avif"];

const DEFAULT_SITE = {
  projectsVisible: 2,
  projectsCtaText: "View All Projects",
  heroImage: "images/portfolio.webp",
  heroGreeting: "Hello, welcome to my world",
  heroTagline: "The creative mind behind intelligent digital experiences",
  heroCtaText: "Get In Touch",
  aboutSubhead: "Digital Marketer & AI Enthusiast",
  aboutImage: "images/rashi-about.svg",
  aboutParas: [
    "Rashi Sharma is a web developer and digital marketing specialist from Pundri, Haryana, India, who builds modern websites, browser games and AI-powered experiences. I believe technology and marketing, when combined with creativity, can build experiences people remember.",
    "I completed my schooling in Pundri - finishing 10th in 2023 and 12th in 2024. Then I successfully completed my NIELIT O Level course, where I mastered essential programming languages including HTML, CSS, JavaScript, Python, IoT and C++. I am currently pursuing a Digital Marketing with AI course to bring intelligent, data-driven strategies to brands.",
    "Beyond studies, I love building things. I have designed websites and developed games that turn ideas into working, interactive products - every project is a chance to learn, create and grow."
  ],
  aboutHighlight: "Technology is my canvas, and marketing is my voice - I create work that people remember.",
  contactEmail: "rashi.sharma@email.com",
  contactLocation: "Pundri, Haryana, India",
  socialLinkedin: "",
  socialInstagram: "",
  socialGithub: "",
  footerTagline: "The Future of Digital Innovation",
  visionSlides: [
    "I don't chase trends. I create value.",
    "I don't build projects. I build experiences.",
    "I don't just market. I make brands unforgettable."
  ],
  stats: [
    { id: 1, number: 6, label: "Languages Learned" },
    { id: 2, number: 4, label: "Projects Built" },
    { id: 3, number: 100, label: "Percent Dedication" }
  ]
};

const DEFAULT_JOURNEY = {
  title: "My Journey",
  intro:
    "I didn't stop at just learning - I applied everything. From writing my first lines of code in O Level to building complete websites and games, my journey has been powered by curiosity and a habit of turning knowledge into creation.",
  items: [
    { id: 1, year: "2023", text: "Completed my Class 10th - this is where I discovered my love for technology." },
    { id: 2, year: "2024", text: "Completed my Class 12th and began exploring computers and programming seriously." },
    { id: 3, year: "2025", text: "Completed my NIELIT O Level - mastering HTML, CSS, JavaScript, Python, IoT and C++." }
  ]
};

const DEFAULT_SKILLS = [
  ["HTML & CSS", "Building clean, responsive and accessible web pages.", "images/icons/html5.svg"],
  ["JavaScript", "Adding interactivity and logic to modern websites.", "images/icons/javascript.svg"],
  ["Python", "Programming, automation and data-driven thinking.", "images/icons/python.svg"],
  ["C++", "Strong fundamentals in logic building and programming.", "images/icons/cpp.svg"],
  ["IoT", "Connecting smart devices with real-world applications.", "images/icons/iot.svg"],
  ["MS Office", "Word, PowerPoint and everyday productivity tools.", "images/icons/msoffice.svg"],
  ["Excel", "Spreadsheets, formulas, charts and data analysis.", "images/icons/excel.svg"],
  ["LibreOffice", "Open-source office suite for efficient document work.", "images/icons/libre.svg"],
  ["Website Development", "Designing and developing complete, functional websites.", "images/icons/webdev.svg"],
  ["Game Development", "Creating interactive games that are fun to play.", "images/icons/game.svg"],
  ["Digital Marketing", "Growing brands with modern marketing strategies.", "images/icons/marketing.svg"],
  ["AI Tools & Automation", "Using artificial intelligence to work smarter and faster.", "images/icons/ai.svg"],
  ["SEO & Content", "Optimising content so the right people find it.", "images/icons/seo.svg"]
].map(function (row, i) {
  return { id: i + 1, name: row[0], desc: row[1], icon: row[2], level: 0 };
});

const DEFAULT_PROJECTS = [
  {
    id: 1,
    title: "Anjali Kids School Website",
    tag: "Web Development",
    desc: "A modern, responsive website for kids school - designed and developed from scratch using HTML, CSS and JavaScript. Clean layouts, smooth interactions and a user-first experience.",
    url: "https://zip-repl-anjali-kids-school.vercel.app/",
    chips: ["HTML", "CSS", "JavaScript"],
    cta: "View Website",
    image: "images/anjali-hero.webp"
  },
  {
    id: 2,
    title: "Block Blast Game",
    tag: "Game Development",
    desc: "An interactive block puzzle game built with JavaScript - featuring fun mechanics, score tracking and smooth gameplay. Proof that I can turn ideas into playable experiences.",
    url: "https://block-blast-7161.ai.studio",
    chips: ["JavaScript", "HTML", "CSS"],
    cta: "View Game",
    image: "images/real-game.webp"
  },
  {
    id: 3,
    title: "AI Marketing Campaign",
    tag: "Digital Marketing",
    desc: "A digital marketing strategy powered by AI tools - content planning, audience targeting and automation to grow visibility and engagement.",
    url: "",
    chips: ["AI Tools", "SEO", "Content"],
    cta: "View Website",
    image: "images/project-marketing.svg"
  },
  {
    id: 4,
    title: "Next Project Coming Soon",
    tag: "More Coming Soon",
    desc: "I'm always building. New projects are in progress - more websites, more games and more intelligent solutions to share with the world.",
    url: "",
    chips: ["HTML", "JavaScript", "Python"],
    cta: "Let's Talk",
    image: "images/project-soon.svg"
  }
];

function loadData(raw) {
  const d = raw && typeof raw === "object" ? raw : {};
  const legacy = !raw || raw.site === undefined;
  d.messages = Array.isArray(d.messages) ? d.messages : [];
  d.blog = Array.isArray(d.blog) ? d.blog : [];
  d.content = d.content && typeof d.content === "object" ? d.content : {};
  d.site = Object.assign({}, DEFAULT_SITE, d.site || {});
  if (!Array.isArray(d.site.aboutParas)) d.site.aboutParas = DEFAULT_SITE.aboutParas.slice();
  if (!Array.isArray(d.site.visionSlides) || !d.site.visionSlides.length) {
    d.site.visionSlides = DEFAULT_SITE.visionSlides.slice();
  }
  if (!Array.isArray(d.site.stats) || !d.site.stats.length) {
    d.site.stats = DEFAULT_SITE.stats.map(function (s) { return Object.assign({}, s); });
  }
  if (!d.site.projectsCtaText) d.site.projectsCtaText = DEFAULT_SITE.projectsCtaText;
  if (!d.site.aboutImage) d.site.aboutImage = DEFAULT_SITE.aboutImage;
  d.journey = normaliseJourney(d.journey);
  d.skills = Array.isArray(d.skills) ? d.skills : [];
  d.projects = Array.isArray(d.projects) ? d.projects : [];
  if (legacy && !d.skills.length && !d.projects.length) {
    d.skills = DEFAULT_SKILLS;
    d.projects = DEFAULT_PROJECTS;
  }
  return d;
}

function normaliseJourney(raw) {
  const base = {
    title: DEFAULT_JOURNEY.title,
    intro: DEFAULT_JOURNEY.intro,
    items: DEFAULT_JOURNEY.items.map(function (i) { return Object.assign({}, i); })
  };
  if (!raw || typeof raw !== "object") return base;
  base.title = String(raw.title || base.title);
  base.intro = String(raw.intro == null ? base.intro : raw.intro);
  if (Array.isArray(raw.items)) {
    base.items = raw.items
      .map(function (it, i) {
        return {
          id: Number(it && it.id) || i + 1,
          year: String((it && it.year) || ""),
          text: String((it && it.text) || "")
        };
      })
      .filter(function (it) { return it.text.trim() || it.year.trim(); });
  }
  return base;
}
/* ── Boot: Supabase se load, warna local file ── */
let store = {};
let ready = false;

/* Writes ko jod-ta hai: bahut saare changes par ek hi Supabase call */
let saveTimer = null;
let savePending = false;

function saveData() {
  if (!ready) return;
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(function () {
    saveTimer = null;
    storeLib.saveStore(store);
  }, 400);
}

async function boot() {
  /* data aur credentials dono ek saath lo (parallel) */
  const results = await Promise.all([storeLib.loadStore(), storeLib.loadAuth()]);
  store = loadData(results[0]);
  auth = results[1];
  ready = true;
  saveData();
  console.log("Data store ready (" + (storeLib.SB_ON ? "Supabase" : "local file") + ")");
  console.log("Supabase link: " + (storeLib.sbHealthy() ? "healthy" : "offline -> local mode"));
}

/* ── Sessions ── */
function tokenHash(t) {
  return crypto.createHmac("sha256", SESSION_SECRET).update(String(t)).digest("hex");
}
function createSession(req, res) {
  const token = crypto.randomBytes(24).toString("hex");
  sessions.set(tokenHash(token), { expires: Date.now() + SESSION_TTL_MS });
  res.setHeader(
    "Set-Cookie",
    "admin_session=" + token + "; HttpOnly; SameSite=Strict; Path=/; Max-Age=" + (SESSION_TTL_MS / 1000)
  );
}
function verifySession(req) {
  const c = String(req.headers.cookie || "");
  const m = c.match(/admin_session=([^;]+)/);
  if (!m) return false;
  const s = sessions.get(tokenHash(m[1]));
  if (!s) return false;
  if (Date.now() > s.expires) {
    sessions.delete(tokenHash(m[1]));
    return false;
  }
  return true;
}
function clearSession(req) {
  const c = String(req.headers.cookie || "");
  const m = c.match(/admin_session=([^;]+)/);
  if (m) sessions.delete(tokenHash(m[1]));
}

/* ── JSON helpers ── */
function sendJson(res, status, obj) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(obj));
}
function readBody(req, limit) {
  const max = limit || 1e6;
  return new Promise(function (resolve, reject) {
    let body = "";
    req.on("data", function (chunk) {
      body += chunk;
      if (body.length > max) {
        req.destroy();
        reject(new Error("Too large"));
      }
    });
    req.on("end", function () { resolve(body); });
    req.on("error", reject);
  });
}
function escapeHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/* ── Image uploads (admin) ── */
function safeUploadName(original) {
  const ext = path.extname(String(original || "")).toLowerCase();
  if (IMAGE_EXTS.indexOf(ext) === -1) return null;
  const base = path
    .basename(String(original), ext)
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  const stamp = Date.now().toString(36);
  return (base || "image") + "-" + stamp + ext;
}

function isManagedUpload(pubPath) {
  return typeof pubPath === "string" && pubPath.indexOf("images/uploads/") !== -1;
}

function deleteUploadFile(pubPath) {
  if (!isManagedUpload(pubPath)) return false;
  const rel = pubPath.replace(/^\/+/, "");
  const abs = path.resolve(BASE, rel);
  if (abs !== UPLOAD_DIR && abs.indexOf(UPLOAD_DIR + path.sep) !== 0) return false;
  try {
    fs.unlinkSync(abs);
    return true;
  } catch (e) {
    return false;
  }
}

/* ── Supabase Storage: permanent image hosting ──
   Uploads go to a public bucket so they survive Render redeploys and load
   from Vercel too. Falls back to the local disk when Supabase is off. */
async function sbStorageFetch(url, options, timeoutMs) {
  const ctrl = new AbortController();
  const timer = setTimeout(function () { ctrl.abort(); }, timeoutMs || 8000);
  try {
    return await fetch(url, Object.assign({}, options, { signal: ctrl.signal }));
  } finally {
    clearTimeout(timer);
  }
}

function sbStorageHeaders(extra) {
  const headers = {
    apikey: SUPABASE_SECRET_KEY,
    Authorization: "Bearer " + SUPABASE_SECRET_KEY
  };
  Object.assign(headers, extra || {});
  return headers;
}

async function sbEnsureBucket() {
  try {
    const res = await sbStorageFetch(SUPABASE_URL + "/storage/v1/bucket", {
      method: "POST",
      headers: sbStorageHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify({ id: SB_BUCKET, name: SB_BUCKET, public: true })
    });
    /* 400 = "name already exists" -> fine, the bucket is there */
    return res.ok || res.status === 400;
  } catch (e) {
    console.error("Supabase bucket ensure failed:", e && e.message);
    return false;
  }
}

async function sbUploadObject(buf, ext, originalFilename) {
  if (!supabaseOn || !SB_BUCKET) return null;
  const name = safeUploadName(originalFilename || "image." + ext);
  const objectPath = SB_BUCKET + "/" + name;
  const mime = ext === "svg" ? "image/svg+xml" : "image/" + ext;
  try {
    await sbEnsureBucket();
    const res = await sbStorageFetch(
      SUPABASE_URL + "/storage/v1/object/" + objectPath,
      {
        method: "POST",
        headers: sbStorageHeaders({ "Content-Type": mime }),
        body: buf
      }
    );
    if (!res.ok) {
      const t = await res.text().catch(function () { return ""; });
      throw new Error("storage POST " + res.status + " " + t.slice(0, 200));
    }
    return SUPABASE_URL + "/storage/v1/object/public/" + objectPath;
  } catch (e) {
    console.error("Supabase storage upload failed:", e && e.message);
    return null;
  }
}

async function sbDeleteObject(publicUrl) {
  if (!supabaseOn || typeof publicUrl !== "string") return true;
  const m = publicUrl.match(/\/storage\/v1\/object\/public\/([^?#]+)/);
  if (!m) return true;
  try {
    const res = await sbStorageFetch(SUPABASE_URL + "/storage/v1/object/" + m[1], {
      method: "DELETE",
      headers: sbStorageHeaders()
    });
    return res.ok;
  } catch (e) {
    console.error("Supabase storage delete failed:", e && e.message);
    return false;
  }
}

/* Old uploaded image hatana jab nayi lagi hai: local file + Storage doono.
   Repo images (portfolio.webp etc.) kabhi touch nahi hote. */
async function removeImageAsset(raw) {
  if (typeof raw !== "string" || !raw) return;
  deleteUploadFile(raw);
  await sbDeleteObject(raw);
}

async function handleUpload(req, res) {
  let d;
  try {
    d = JSON.parse(await readBody(req, 12e6));
  } catch (e) {
    sendJson(res, 400, { ok: false, error: "Upload failed: file too large or invalid body." });
    return;
  }
  const dataUrl = String(d.dataUrl || "");
  const m = dataUrl.match(/^data:image\/(png|jpeg|jpg|webp|gif|svg\+xml|avif);base64,(.+)$/i);
  if (!m) {
    sendJson(res, 400, { ok: false, error: "Only PNG, JPG, WebP, GIF, AVIF or SVG images are allowed." });
    return;
  }
  let ext = m[1].toLowerCase();
  if (ext === "svg+xml") ext = "svg";
  if (ext === "jpeg") ext = "jpg";
  const name = safeUploadName(d.filename || "image." + ext);
  if (!name) {
    sendJson(res, 400, { ok: false, error: "That file type is not allowed." });
    return;
  }
  let buf;
  try {
    buf = Buffer.from(m[2], "base64");
  } catch (e) {
    sendJson(res, 400, { ok: false, error: "Could not decode the image." });
    return;
  }
  if (!buf.length) {
    sendJson(res, 400, { ok: false, error: "Empty file." });
    return;
  }
  if (buf.length > 8e6) {
    sendJson(res, 400, { ok: false, error: "Image is too large (max 8 MB)." });
    return;
  }
  /* Permanent storage first (Supabase public bucket), then local disk */
  const remote = await sbUploadObject(buf, ext, d.filename);
  if (remote) {
    sendJson(res, 200, { ok: true, data: { path: remote, bytes: buf.length, storage: "supabase" } });
    return;
  }
  try {
    fs.mkdirSync(UPLOAD_DIR, { recursive: true });
    fs.writeFileSync(path.join(UPLOAD_DIR, name), buf);
  } catch (e) {
    sendJson(res, 500, { ok: false, error: "Could not save the image on disk." });
    return;
  }
  sendJson(res, 200, { ok: true, data: { path: "images/uploads/" + name, bytes: buf.length, storage: "local" } });
}

/* ── Supabase sync (optional) ── */
async function supabaseRequest(table, method, body, extraHeaders) {
  if (!supabaseOn) return { skipped: true };
  const headers = {
    apikey: SUPABASE_SECRET_KEY,
    Authorization: "Bearer " + SUPABASE_SECRET_KEY,
    "Content-Type": "application/json",
    Prefer: "return=minimal"
  };
  Object.assign(headers, extraHeaders || {});
  const res = await fetch(SUPABASE_URL + "/rest/v1/" + table, {
    method: method,
    headers: headers,
    body: body == null ? undefined : JSON.stringify(body)
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error("Supabase " + method + " " + table + " -> " + res.status + " " + text.slice(0, 300));
  }
  return text ? JSON.parse(text) : null;
}

async function supabaseUpsert(table, rows) {
  if (!supabaseOn) return;
  try {
    const src = Array.isArray(rows) ? rows : [rows];
    if (!src.length) return;
    const list = src.map(function (row) {
      const copy = Object.assign({}, row);
      delete copy.id;
      return copy;
    });
    await supabaseRequest(table, "POST", list, {
      Prefer: "return=minimal"
    });
  } catch (e) {
    console.error("Supabase upsert " + table + " failed:", e && e.message);
  }
}

/* ── Static serving ── */
/* SEO: clean, lowercase, extension-less URLs.
   /blog.html -> /blog  (301, permanent — keeps any old inbound links alive)
   /index.html -> /     (301)
   /blog and / resolve to the .html file on disk, but the canonical URL that
   gets indexed is the clean one, declared in each page's <link rel="canonical">. */
const CLEAN_URLS = {
  "/blog.html": "/blog",
  "/index.html": "/"
};

function serveStatic(req, res) {
  let urlPath = decodeURIComponent((req.url || "").split("?")[0]);

  /* permanent redirect old .html URLs to their clean slug */
  const clean = CLEAN_URLS[urlPath.toLowerCase()];
  if (clean) {
    res.writeHead(301, {
      Location: clean,
      "Cache-Control": "public, max-age=31536000, immutable"
    });
    res.end();
    return;
  }

  if (urlPath === "/") urlPath = "/index.html";
  else if (urlPath === "/blog") urlPath = "/blog.html";

  const filePath = path.resolve(BASE, "." + urlPath);
  if (filePath !== BASE && !filePath.startsWith(BASE + path.sep)) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }
  fs.readFile(filePath, function (err, data) {
    if (err) {
      res.writeHead(404);
      res.end("Not found");
      return;
    }
    const ext = path.extname(filePath).toLowerCase();
    const headers = { "Content-Type": MIME[ext] || "application/octet-stream" };
    /* HTML must never be cached hard, or a deploy won't reach visitors */
    if (ext === ".html") headers["Cache-Control"] = "no-cache, must-revalidate";
    res.writeHead(200, headers);
    res.end(data);
  });
}
function serveFile(res, file, contentType) {
  fs.readFile(path.join(__dirname, file), function (err, data) {
    if (err) {
      res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("Admin page missing: " + file);
      return;
    }
    res.writeHead(200, { "Content-Type": contentType || "text/html; charset=utf-8" });
    res.end(data);
  });
}

/* ── Canonical site origin (SEO) ──
   The frontend is deployed on Vercel; this Render service also serves a copy of
   the same static files for the API. robots.txt and sitemap.xml must ALWAYS
   advertise the canonical Vercel origin — never the request host — otherwise the
   two hosts emit conflicting signals and search engines split ranking between them.
   Override with the SITE_ORIGIN env var if the domain ever changes. */
const SITE_ORIGIN = String(process.env.SITE_ORIGIN || "https://rashisharma-portfolio.vercel.app")
  .replace(/\/+$/, "");

function siteOrigin(req) {
  /* localhost dev keeps working on a dynamic host */
  const host = String(req.headers.host || "localhost:" + PORT);
  const isLocal = /^localhost$|^127\.0\.0\.1$|^\[::1\]$/i.test(host.split(":")[0]);
  if (isLocal) return "http://" + host;
  return SITE_ORIGIN;
}

/* Base URL of THIS backend (where admin-uploaded images actually live).
   Uploads are served from the API host, not from Vercel. */
function assetBase(req) {
  const host = String(req.headers.host || "localhost:" + PORT);
  const proto = String(req.headers["x-forwarded-proto"] || "")
    .split(",")[0]
    .trim();
  const scheme = (proto === "http" || proto === "https")
    ? proto
    : (req.socket && req.socket.encrypted ? "https" : "http");
  return scheme + "://" + host;
}

/* Relative images/uploads/* paths only resolve on the API host - the API
   host - so point them at it. Absolute (Supabase/CDN) and repo-relative
   paths (portfolio.webp etc.) are left untouched. */
function assetUrlPublic(raw, req) {
  if (typeof raw !== "string" || !raw) return raw;
  if (/^(https?:|data:|blob:|\/\/)/.test(raw)) return raw;
  if (raw.indexOf("images/uploads/") === 0) return assetBase(req) + "/" + raw;
  return raw;
}

/* ── CORS: Vercel frontend → Render backend ──
   Vary: Origin is set on every response that saw an Origin header, even when
   the origin is rejected, so shared caches never serve one origin's response
   (with its ACAO) to another origin. */
function applyCors(req, res) {
  const origin = String(req.headers.origin || "").replace(/\/+$/, "");
  if (!origin) return;

  res.setHeader("Vary", "Origin");

  if (ALLOWED_ORIGINS.indexOf(origin) === -1) return;

  res.setHeader("Access-Control-Allow-Origin", origin);
  res.setHeader("Access-Control-Allow-Credentials", "true");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  res.setHeader("Access-Control-Expose-Headers", "Content-Length, Content-Type");
  res.setHeader("Access-Control-Max-Age", "86400");
}

/* ── Contact send via Resend ── */
async function handleSend(req, res) {
  try {
    const d = JSON.parse(await readBody(req));
    const name = String(d.name || "").trim();
    const email = String(d.email || "").trim();
    const message = String(d.message || "").trim();

    if (!name || !email || !message) {
      sendJson(res, 400, { ok: false, error: "Please fill in all the fields." });
      return;
    }
    if (!/^\S+@\S+\.\S+$/.test(email)) {
      sendJson(res, 400, { ok: false, error: "Please enter a valid email address." });
      return;
    }

    /* store locally (admin inbox) */
    const rec = {
      id: store.messages.length
        ? Math.max.apply(null, store.messages.map(function (m) { return m.id; })) + 1
        : 1,
      name: name,
      email: email,
      message: message,
      time: new Date().toISOString(),
      status: "new"
    };
    store.messages.push(rec);
    saveData();
    supabaseUpsert("contact_messages", [rec]);

    const html =
      "<h2>New message from Rashi's Portfolio</h2>" +
      "<p><strong>Name:</strong> " + escapeHtml(name) + "</p>" +
      "<p><strong>Email:</strong> " + escapeHtml(email) + "</p>" +
      "<h3>Message</h3>" +
      "<p>" + escapeHtml(message).replace(/\n/g, "<br/>") + "</p>";

    const payload = {
      from: FROM_EMAIL,
      to: [TO_EMAIL],
      subject: "Portfolio message from " + name,
      reply_to: email,
      html: html
    };

    let apiRes = null;
    let apiData = {};
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        apiRes = await fetch("https://api.resend.com/emails", {
          method: "POST",
          headers: {
            Authorization: "Bearer " + RESEND_KEY,
            "Content-Type": "application/json"
          },
          body: JSON.stringify(payload)
        });
        apiData = await apiRes.json().catch(function () { return {}; });
        if (apiRes.ok) break;
        if (apiRes.status === 429 || apiRes.status >= 500) {
          await new Promise(function (r) { setTimeout(r, 700 * (attempt + 1)); });
          continue;
        }
        break;
      } catch (networkError) {
        await new Promise(function (r) { setTimeout(r, 700 * (attempt + 1)); });
        apiData = { message: "Email network error (attempt " + (attempt + 1) + ")" };
      }
    }

    if (apiRes && apiRes.ok) {
      console.log("Email sent to " + TO_EMAIL + " from " + name + " (" + email + ")");
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true }));
    } else {
      console.error("Resend error:", apiData);
      res.writeHead(502, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: false, error: apiData.message || "Email service error. Please try again." }));
    }
  } catch (e) {
    console.error("Send handler error:", e && e.stack ? e.stack : e);
    res.writeHead(500, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: false, error: "Server error. Please try again." }));
  }
}

/* ── Password recovery: email code → verify → reset ── */
function codeHash(email, code) {
  return crypto
    .createHmac("sha256", SESSION_SECRET)
    .update(String(email).toLowerCase() + ":" + String(code))
    .digest("hex");
}

async function deliverEmail(payload) {
  if (!RESEND_KEY) {
    return { ok: false, error: "Email service is not configured (RESEND_KEY missing)." };
  }
  let apiRes = null;
  let apiData = {};
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      apiRes = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          Authorization: "Bearer " + RESEND_KEY,
          "Content-Type": "application/json"
        },
        body: JSON.stringify(payload)
      });
      apiData = await apiRes.json().catch(function () { return {}; });
      if (apiRes.ok) break;
      if (apiRes.status === 429 || apiRes.status >= 500) {
        await new Promise(function (r) { setTimeout(r, 700 * (attempt + 1)); });
        continue;
      }
      break;
    } catch (networkError) {
      await new Promise(function (r) { setTimeout(r, 700 * (attempt + 1)); });
      apiData = { message: "Email network error." };
    }
  }
  if (apiRes && apiRes.ok) return { ok: true };
  return { ok: false, error: apiData.message || "Email service error." };
}

function sixDigitCode() {
  return String(crypto.randomInt(0, 1000000)).padStart(6, "0");
}

async function handleRecoverStart(req, res) {
  let d = {};
  try {
    d = JSON.parse(await readBody(req));
  } catch (e) {
    sendJson(res, 400, { ok: false, error: "Invalid request." });
    return;
  }
  const email = String(d.email || "").trim().toLowerCase();
  if (!/^\S+@\S+\.\S+$/.test(email)) {
    sendJson(res, 400, { ok: false, error: "Please enter a valid email address." });
    return;
  }
  if (email !== RECOVERY_EMAIL) {
    sendJson(res, 400, { ok: false, error: "This email is not linked to the admin panel." });
    return;
  }

  const prev = resetCodes.get(email);
  if (prev && Date.now() - prev.sentAt < RESET_RESEND_COOLDOWN_MS) {
    const wait = Math.ceil((RESET_RESEND_COOLDOWN_MS - (Date.now() - prev.sentAt)) / 1000);
    sendJson(res, 429, { ok: false, error: "Please wait " + wait + "s before requesting a new code." });
    return;
  }

  const code = sixDigitCode();
  resetCodes.set(email, {
    hash: codeHash(email, code),
    expires: Date.now() + RESET_CODE_TTL_MS,
    attempts: 0,
    sentAt: Date.now()
  });

  const delivery = await deliverEmail({
    from: FROM_EMAIL,
    to: [email],
    subject: "Your portfolio admin login code",
    html:
      "<h2>Admin password reset</h2>" +
      "<p>A password reset was requested for your portfolio admin panel.</p>" +
      '<p style="font-size:26px;letter-spacing:6px;font-weight:700;margin:18px 0">' + code + "</p>" +
      "<p>This code expires in 10 minutes and can be used only once. " +
      "If you did not request this, you can safely ignore this email.</p>"
  });

  if (delivery.ok) {
    console.log("Recovery code sent to " + email);
    sendJson(res, 200, { ok: true, emailSent: true, expiresIn: 600 });
    return;
  }

  console.error("Recovery email failed:", delivery.error);
  console.log(">>> RECOVERY CODE for " + email + " (email delivery failed): " + code);
  sendJson(res, 200, {
    ok: true,
    emailSent: false,
    expiresIn: 600,
    warning: "Email could not be sent (" + delivery.error + "). The code has been printed in the server console."
  });
}

async function handleRecoverVerify(req, res) {
  let d = {};
  try {
    d = JSON.parse(await readBody(req));
  } catch (e) {
    sendJson(res, 400, { ok: false, error: "Invalid request." });
    return;
  }
  const email = String(d.email || "").trim().toLowerCase();
  const code = String(d.code || "").trim();
  const rec = resetCodes.get(email);
  if (!rec) {
    sendJson(res, 400, { ok: false, error: "No code found. Please request a new one." });
    return;
  }
  if (Date.now() > rec.expires) {
    resetCodes.delete(email);
    sendJson(res, 400, { ok: false, error: "That code has expired. Please request a new one." });
    return;
  }
  if (rec.attempts >= RESET_MAX_ATTEMPTS) {
    resetCodes.delete(email);
    sendJson(res, 429, { ok: false, error: "Too many wrong attempts. Please request a new code." });
    return;
  }
  const given = Buffer.from(codeHash(email, code), "hex");
  const known = Buffer.from(rec.hash, "hex");
  if (given.length !== known.length || !crypto.timingSafeEqual(given, known)) {
    rec.attempts += 1;
    sendJson(res, 400, {
      ok: false,
      error: "Incorrect code. " + (RESET_MAX_ATTEMPTS - rec.attempts) + " attempt(s) left."
    });
    return;
  }

  const token = crypto.randomBytes(24).toString("hex");
  resetTokens.set(token, { email: email, expires: Date.now() + RESET_TOKEN_TTL_MS });
  resetCodes.delete(email);
  sendJson(res, 200, { ok: true, token: token });
}

async function handleRecoverReset(req, res) {
  let d = {};
  try {
    d = JSON.parse(await readBody(req));
  } catch (e) {
    sendJson(res, 400, { ok: false, error: "Invalid request." });
    return;
  }
  const token = String(d.token || "");
  const rec = resetTokens.get(token);
  if (!rec || Date.now() > rec.expires) {
    resetTokens.delete(token);
    sendJson(res, 400, { ok: false, error: "Your reset session expired. Please start over." });
    return;
  }
  const problem = passwordProblem(d.newPassword);
  if (problem) {
    sendJson(res, 400, { ok: false, error: problem });
    return;
  }
  auth.salt = "";
  auth.hash = "";
  Object.assign(auth, hashPassword(d.newPassword));
  saveAuth();
  resetTokens.delete(token);
  resetCodes.clear();
  loginFails.clear();
  console.log("Admin password reset completed for " + rec.email);
  sendJson(res, 200, { ok: true });
}

/* ── Static + admin pages (server pages live in backend/) ── */
function serveAdminHtml(res) {
  serveFile(res, "admin.html", "text/html; charset=utf-8");
}
function serveAdminDashboard(res) {
  serveFile(res, "admin-dashboard.html", "text/html; charset=utf-8");
}

/* ── Router ── */
const server = http.createServer(function (req, res) {
  const url = new URL(req.url, "http://localhost");
  const pathname = url.pathname;
  const method = req.method || "GET";
  const isAdmin = verifySession(req);

  /* CORS for every request (Vercel frontend -> Render backend) */
  applyCors(req, res);

  /* Preflight */
  if (method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  /* health check for uptime monitors */
  if (pathname === "/api/health" && method === "GET") {
    sendJson(res, 200, {
      ok: true,
      ready: ready,
      supabase: storeLib.SB_ON,
      storageBucket: SB_STORAGE_STATUS,
      uptime: process.uptime()
    });
    return;
  }

  /* public: site content consumed by the frontend */
  if (pathname === "/api/site" && method === "GET") {
    if (!ready) {
      sendJson(res, 503, { ok: false, error: "Server is starting, please retry in a few seconds." });
      return;
    }
    sendJson(res, 200, {
      ok: true,
      data: {
        site: Object.assign({}, store.site, {
          heroImage: assetUrlPublic(store.site.heroImage, req),
          aboutImage: assetUrlPublic(store.site.aboutImage, req)
        }),
        skills: (store.skills || []).map(function (s) {
          var c = Object.assign({}, s);
          if (typeof c.icon === "string") c.icon = assetUrlPublic(c.icon, req);
          return c;
        }),
        projects: (store.projects || []).map(function (p) {
          var c = Object.assign({}, p);
          if (typeof c.image === "string") c.image = assetUrlPublic(c.image, req);
          return c;
        }),
        journey: store.journey,
        blog: store.blog
      }
    });
    return;
  }

  /* public: send message */
  if (pathname === "/api/send" && method === "POST") {
    handleSend(req, res);
    return;
  }

  /* public: SEO files generated from the real request host */
  if (pathname === "/robots.txt" && method === "GET") {
    const origin = siteOrigin(req);
    res.writeHead(200, {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "public, max-age=3600"
    });
    /* Must match frontend/robots.txt. Named agent groups do not inherit the
       `*` group, so each AI crawler repeats the admin/API block. */
    var aiBots = [
      "GPTBot", "OAI-SearchBot", "ChatGPT-User", "PerplexityBot", "Perplexity-User",
      "ClaudeBot", "Claude-SearchBot", "Google-Extended", "Bingbot"
    ];
    res.end(
      "User-agent: *\n" +
      "Allow: /\n" +
      "Disallow: /admin\n" +
      "Disallow: /api/\n" +
      "\n" +
      "# AI / answer engines are explicitly welcome (GEO).\n" +
      aiBots
        .map(function (b) {
          return "User-agent: " + b + "\nAllow: /\nDisallow: /admin\nDisallow: /api/\n";
        })
        .join("\n") +
      "Sitemap: " + origin + "/sitemap.xml\n"
    );
    return;
  }

  if (pathname === "/sitemap.xml" && method === "GET") {
    const origin = siteOrigin(req);
    const today = new Date().toISOString().slice(0, 10);
    const urls = [
      { loc: origin + "/", changefreq: "weekly", priority: "1.0" },
      { loc: origin + "/blog", changefreq: "monthly", priority: "0.8" }
    ];
    const xml =
      '<?xml version="1.0" encoding="UTF-8"?>\n' +
      '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' +
      urls
        .map(function (u) {
          return (
            "  <url>\n" +
            "    <loc>" + u.loc + "</loc>\n" +
            "    <lastmod>" + today + "</lastmod>\n" +
            "    <changefreq>" + u.changefreq + "</changefreq>\n" +
            "    <priority>" + u.priority + "</priority>\n" +
            "  </url>\n"
          );
        })
        .join("") +
      "</urlset>\n";
    res.writeHead(200, {
      "Content-Type": "application/xml; charset=utf-8",
      "Cache-Control": "public, max-age=3600"
    });
    res.end(xml);
    return;
  }

  /* admin login page */
  if (pathname === "/admin" || pathname === "/admin/" || pathname === "/admin/login") {
    if (isAdmin) {
      res.writeHead(302, { Location: "/admin/dashboard" });
      res.end();
      return;
    }
    serveAdminHtml(res);
    return;
  }

  /* admin API: login */
  if (pathname === "/api/admin/login" && method === "POST") {
    const ip = clientIp(req);
    const wait = loginBlocked(ip);
    if (wait) {
      sendJson(res, 429, {
        ok: false,
        error: "Too many failed attempts. Try again in " + Math.ceil(wait / 60000) + " minute(s)."
      });
      return;
    }
    readBody(req).then(function (body) {
      let d = {};
      try { d = JSON.parse(body); } catch (e) { d = {}; }
      const u = safeUsername(d.username);
      const p = String(d.password == null ? "" : d.password);
      if (u === auth.username && verifyPassword(p, auth.salt, auth.hash)) {
        clearLoginFails(ip);
        createSession(req, res);
        sendJson(res, 200, { ok: true });
      } else {
        noteLoginFail(ip);
        sendJson(res, 401, { ok: false, error: "Invalid username or password." });
      }
    });
    return;
  }

  /* public: forgot password — step 1, email a 6-digit code */
  if (pathname === "/api/admin/recover/start" && method === "POST") {
    handleRecoverStart(req, res);
    return;
  }
  /* public: forgot password — step 2, verify the code */
  if (pathname === "/api/admin/recover/verify" && method === "POST") {
    handleRecoverVerify(req, res);
    return;
  }
  /* public: forgot password — step 3, set the new password */
  if (pathname === "/api/admin/recover/reset" && method === "POST") {
    handleRecoverReset(req, res);
    return;
  }

  /* admin: logout */
  if (pathname === "/api/admin/logout" && method === "POST") {
    clearSession(req);
    res.writeHead(200, {
      "Content-Type": "application/json",
      "Set-Cookie": "admin_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0"
    });
    res.end(JSON.stringify({ ok: true }));
    return;
  }

  /* protected: dashboard page */
  if (pathname === "/admin/dashboard" || pathname === "/admin/dashboard/") {
    if (!isAdmin) {
      res.writeHead(302, { Location: "/admin" });
      res.end();
      return;
    }
    serveAdminDashboard(res);
    return;
  }

  /* protected: admin API CRUD */
  if (pathname.startsWith("/api/admin") && pathname !== "/api/admin/login" && pathname !== "/api/admin/logout") {
    if (!isAdmin) {
      sendJson(res, 401, { ok: false, error: "Not signed in." });
      return;
    }
    handleAdminApi(req, res, pathname, method);
    return;
  }

  serveStatic(req, res);
});

function overviewMap() {
  const unread = store.messages.filter(function (m) { return m.status !== "read"; }).length;
  return {
    messages: store.messages.length,
    unread: unread,
    skills: store.skills.length,
    projects: store.projects.length,
    milestones: store.journey.items.length,
    recent: store.messages.slice(-3).reverse()
  };
}

async function handleAdminApi(req, res, pathname, method) {
  /* Overview / stats */
  if (pathname === "/api/admin/overview" && method === "GET") {
    sendJson(res, 200, { ok: true, data: overviewMap() });
    return;
  }

  /* Upload an image */
  if (pathname === "/api/admin/upload" && method === "POST") {
    await handleUpload(req, res);
    return;
  }

  /* Hero */
  if (pathname === "/api/admin/hero" && method === "GET") {
    sendJson(res, 200, {
      ok: true,
      data: {
        image: store.site.heroImage,
        greeting: store.site.heroGreeting,
        tagline: store.site.heroTagline,
        ctaText: store.site.heroCtaText
      }
    });
    return;
  }
  if (pathname === "/api/admin/hero" && method === "PUT") {
    const d = JSON.parse(await readBody(req));
    if (typeof d.image === "string" && d.image.trim()) {
      const prev = store.site.heroImage;
      store.site.heroImage = d.image.trim();
      if (prev && prev !== store.site.heroImage) await removeImageAsset(prev);
    }
    if (typeof d.greeting === "string") store.site.heroGreeting = d.greeting;
    if (typeof d.tagline === "string") store.site.heroTagline = d.tagline;
    if (typeof d.ctaText === "string") store.site.heroCtaText = d.ctaText;
    saveData();
    sendJson(res, 200, { ok: true, data: store.site });
    return;
  }
  if (pathname === "/api/admin/hero/image" && method === "DELETE") {
    const current = store.site.heroImage;
    const removedLocal = deleteUploadFile(current);
    const removedRemote = await sbDeleteObject(current);
    store.site.heroImage = DEFAULT_SITE.heroImage;
    saveData();
    sendJson(res, 200, {
      ok: true,
      data: {
        image: store.site.heroImage,
        fileDeleted: !!(removedLocal || removedRemote)
      }
    });
    return;
  }

  /* Site content (all editable text) */
  if (pathname === "/api/admin/site" && method === "GET") {
    sendJson(res, 200, { ok: true, data: store.site });
    return;
  }
  if (pathname === "/api/admin/site" && method === "PUT") {
    const d = JSON.parse(await readBody(req));
    const prevImages = { heroImage: store.site.heroImage, aboutImage: store.site.aboutImage };
    const textFields = [
      "heroImage", "heroGreeting", "heroTagline", "heroCtaText",
      "aboutSubhead", "aboutImage", "aboutHighlight", "contactEmail", "contactLocation",
      "socialLinkedin", "socialInstagram", "socialGithub", "footerTagline", "projectsCtaText"
    ];
    const replaced = {};
    textFields.forEach(function (key) {
      if (typeof d[key] === "string") {
        store.site[key] = d[key];
        replaced[key] = store.site[key];
      }
    });
    /* Purani image hatana jab nayi aayi ho - dono ke liye alag se */
    if (typeof d.heroImage === "string" && prevImages.heroImage && prevImages.heroImage !== d.heroImage) {
      await removeImageAsset(prevImages.heroImage);
    }
    if (typeof d.aboutImage === "string" && prevImages.aboutImage && prevImages.aboutImage !== d.aboutImage) {
      await removeImageAsset(prevImages.aboutImage);
    }
    if (Array.isArray(d.aboutParas)) {
      store.site.aboutParas = d.aboutParas.map(function (p) { return String(p); });
    }
    if (Array.isArray(d.visionSlides)) {
      store.site.visionSlides = d.visionSlides
        .map(function (v) { return String(v); })
        .filter(function (v) { return v.trim(); });
    }
    if (Array.isArray(d.stats)) {
      const nextStatId = store.site.stats.length
        ? Math.max.apply(null, store.site.stats.map(function (s) { return Number(s.id) || 0; })) + 1
        : 1;
      store.site.stats = d.stats.map(function (s, i) {
        return {
          id: Number(s && s.id) || nextStatId + i,
          number: Math.max(0, Math.min(999999, Number(s && s.number) || 0)),
          label: String((s && s.label) || "")
        };
      });
    }
    if (d.projectsVisible != null) {
      const n = parseInt(d.projectsVisible, 10);
      if (!isNaN(n) && n >= 0) store.site.projectsVisible = Math.min(n, 50);
    }
    saveData();
    sendJson(res, 200, { ok: true, data: store.site, replaced: replaced });
    return;
  }

  /* Remove the About photo (reset to the bundled default) */
  if (pathname === "/api/admin/site/about-image" && method === "DELETE") {
    const current = store.site.aboutImage;
    deleteUploadFile(current);
    await sbDeleteObject(current);
    store.site.aboutImage = DEFAULT_SITE.aboutImage;
    saveData();
    sendJson(res, 200, { ok: true, data: { aboutImage: store.site.aboutImage } });
    return;
  }

  /* Journey (My Journey section) */
  if (pathname === "/api/admin/journey" && method === "GET") {
    sendJson(res, 200, { ok: true, data: store.journey });
    return;
  }
  if (pathname === "/api/admin/journey" && method === "PUT") {
    const d = JSON.parse(await readBody(req));
    if (typeof d.title === "string") store.journey.title = d.title;
    if (typeof d.intro === "string") store.journey.intro = d.intro;
    saveData();
    sendJson(res, 200, { ok: true, data: store.journey });
    return;
  }
  if (pathname === "/api/admin/journey/items" && method === "POST") {
    const d = JSON.parse(await readBody(req));
    const text = String(d.text || "").trim();
    if (!text) { sendJson(res, 400, { ok: false, error: "Description required" }); return; }
    const nextId = store.journey.items.length
      ? Math.max.apply(null, store.journey.items.map(function (i) { return Number(i.id) || 0; })) + 1
      : 1;
    const item = { id: nextId, year: String(d.year || "").trim(), text: text };
    store.journey.items.push(item);
    saveData();
    sendJson(res, 200, { ok: true, data: item });
    return;
  }
  const journeyOne = pathname.match(/^\/api\/admin\/journey\/items\/(\d+)$/);
  if (journeyOne && method === "PUT") {
    const id = Number(journeyOne[1]);
    const idx = store.journey.items.findIndex(function (i) { return i.id === id; });
    if (idx === -1) { sendJson(res, 404, { ok: false, error: "Timeline item not found" }); return; }
    const d = JSON.parse(await readBody(req));
    if (typeof d.year === "string") store.journey.items[idx].year = d.year.trim();
    if (typeof d.text === "string" && d.text.trim()) store.journey.items[idx].text = d.text.trim();
    saveData();
    sendJson(res, 200, { ok: true, data: store.journey.items[idx] });
    return;
  }
  if (journeyOne && method === "DELETE") {
    const id = Number(journeyOne[1]);
    store.journey.items = store.journey.items.filter(function (i) { return i.id !== id; });
    saveData();
    sendJson(res, 200, { ok: true, data: store.journey });
    return;
  }

  /* Change admin username / password */
  if (pathname === "/api/admin/credentials" && method === "PUT") {
    const d = JSON.parse(await readBody(req));
    const current = String(d.currentPassword == null ? "" : d.currentPassword);
    if (!verifyPassword(current, auth.salt, auth.hash)) {
      sendJson(res, 401, { ok: false, error: "Current password is incorrect." });
      return;
    }
    const wantUser = safeUsername(d.username);
    if (d.username != null && !wantUser) {
      sendJson(res, 400, { ok: false, error: "Username cannot be empty." });
      return;
    }
    if (d.newPassword) {
      const problem = passwordProblem(d.newPassword);
      if (problem) { sendJson(res, 400, { ok: false, error: problem }); return; }
    }
    if (d.newPassword && d.newPassword === current) {
      sendJson(res, 400, { ok: false, error: "New password must be different from the current one." });
      return;
    }
    if (wantUser) auth.username = wantUser;
    if (d.newPassword) {
      auth.salt = "";
      auth.hash = "";
      Object.assign(auth, hashPassword(d.newPassword));
    }
    saveAuth();
    sendJson(res, 200, { ok: true, data: { username: auth.username } });
    return;
  }

  /* Messages */
  if (pathname === "/api/admin/messages" && method === "GET") {
    const list = store.messages.slice().reverse();
    sendJson(res, 200, { ok: true, data: list });
    return;
  }
  const delOne = pathname.match(/^\/api\/admin\/messages\/(\d+)$/);
  if (delOne && method === "DELETE") {
    const id = Number(delOne[1]);
    store.messages = store.messages.filter(function (m) { return m.id !== id; });
    saveData();
    sendJson(res, 200, { ok: true });
    return;
  }
  if (pathname === "/api/admin/messages" && method === "DELETE") {
    store.messages = [];
    saveData();
    sendJson(res, 200, { ok: true });
    return;
  }

  /* Skills */
  if (pathname === "/api/admin/skills" && method === "GET") {
    sendJson(res, 200, { ok: true, data: store.skills });
    return;
  }
  if (pathname === "/api/admin/skills" && method === "POST") {
    const d = JSON.parse(await readBody(req));
    const name = String(d.name || "").trim();
    if (!name) { sendJson(res, 400, { ok: false, error: "Name required" }); return; }
    const nextId = store.skills.length
      ? Math.max.apply(null, store.skills.map(function (s) { return s.id; })) + 1
      : 1;
    const skill = {
      id: nextId,
      name: name,
      desc: String(d.desc || ""),
      icon: String(d.icon || ""),
      level: Number(d.level) || 0
    };
    store.skills.push(skill);
    saveData();
    supabaseUpsert("skills", [skill]);
    sendJson(res, 200, { ok: true, data: skill });
    return;
  }
  const skillOne = pathname.match(/^\/api\/admin\/skills\/(\d+)$/);
  if (skillOne && method === "PUT") {
    const id = Number(skillOne[1]);
    const idx = store.skills.findIndex(function (s) { return s.id === id; });
    if (idx === -1) { sendJson(res, 404, { ok: false, error: "Capability not found" }); return; }
    const d = JSON.parse(await readBody(req));
    const s = store.skills[idx];
    if (typeof d.name === "string" && d.name.trim()) s.name = d.name.trim();
    if (typeof d.desc === "string") s.desc = d.desc;
    if (typeof d.icon === "string") {
      const prevIcon = s.icon;
      s.icon = d.icon;
      if (prevIcon && prevIcon !== s.icon) await removeImageAsset(prevIcon);
    }
    if (d.level != null) s.level = Number(d.level) || 0;
    saveData();
    supabaseUpsert("skills", [s]);
    sendJson(res, 200, { ok: true, data: s });
    return;
  }
  const skillDel = pathname.match(/^\/api\/admin\/skills\/(\d+)$/);
  if (skillDel && method === "DELETE") {
    const id = Number(skillDel[1]);
    store.skills = store.skills.filter(function (s) { return s.id !== id; });
    saveData();
    sendJson(res, 200, { ok: true });
    return;
  }

  /* Projects */
  if (pathname === "/api/admin/projects" && method === "GET") {
    sendJson(res, 200, { ok: true, data: store.projects });
    return;
  }
  if (pathname === "/api/admin/projects" && method === "POST") {
    const d = JSON.parse(await readBody(req));
    const title = String(d.title || "").trim();
    if (!title) { sendJson(res, 400, { ok: false, error: "Title required" }); return; }
    const nextId = store.projects.length
      ? Math.max.apply(null, store.projects.map(function (p) { return p.id; })) + 1
      : 1;
    const proj = {
      id: nextId,
      title: title,
      tag: String(d.tag || ""),
      desc: String(d.desc || ""),
      url: String(d.url || ""),
      chips: Array.isArray(d.chips) ? d.chips.map(function (c) { return String(c); }) : [],
      cta: String(d.cta || "View Project"),
      image: String(d.image || "")
    };
    store.projects.push(proj);
    saveData();
    supabaseUpsert("projects", [proj]);
    sendJson(res, 200, { ok: true, data: proj });
    return;
  }
  const projOne = pathname.match(/^\/api\/admin\/projects\/(\d+)$/);
  if (projOne && method === "PUT") {
    const id = Number(projOne[1]);
    const idx = store.projects.findIndex(function (p) { return p.id === id; });
    if (idx === -1) { sendJson(res, 404, { ok: false, error: "Project not found" }); return; }
    const d = JSON.parse(await readBody(req));
    const p = store.projects[idx];
    if (typeof d.title === "string" && d.title.trim()) p.title = d.title.trim();
    if (typeof d.tag === "string") p.tag = d.tag;
    if (typeof d.desc === "string") p.desc = d.desc;
    if (typeof d.url === "string") p.url = d.url;
    if (typeof d.cta === "string") p.cta = d.cta;
    if (typeof d.image === "string") {
      const prevImg = p.image;
      p.image = d.image;
      if (prevImg && prevImg !== p.image) await removeImageAsset(prevImg);
    }
    if (Array.isArray(d.chips)) p.chips = d.chips.map(function (c) { return String(c); });
    saveData();
    supabaseUpsert("projects", [p]);
    sendJson(res, 200, { ok: true, data: p });
    return;
  }
  const projDel = pathname.match(/^\/api\/admin\/projects\/(\d+)$/);
  if (projDel && method === "DELETE") {
    const id = Number(projDel[1]);
    const target = store.projects.find(function (p) { return p.id === id; });
    if (target) deleteUploadFile(target.image);
    await sbDeleteObject(target && target.image);
    store.projects = store.projects.filter(function (p) { return p.id !== id; });
    saveData();
    sendJson(res, 200, { ok: true });
    return;
  }

  /* Blog */
  if (pathname === "/api/admin/blog" && method === "GET") {
    sendJson(res, 200, { ok: true, data: store.blog });
    return;
  }
  if (pathname === "/api/admin/blog" && method === "POST") {
    const d = JSON.parse(await readBody(req));
    const title = String(d.title || "").trim();
    if (!title) { sendJson(res, 400, { ok: false, error: "Title required" }); return; }
    const nextId = store.blog.length
      ? Math.max.apply(null, store.blog.map(function (b) { return b.id; })) + 1
      : 1;
    const post = { id: nextId, title: title, date: String(d.date || ""), body: String(d.body || "") };
    store.blog.push(post);
    saveData();
    supabaseUpsert("blog", [post]);
    sendJson(res, 200, { ok: true, data: post });
    return;
  }
  const postDel = pathname.match(/^\/api\/admin\/blog\/(\d+)$/);
  if (postDel && method === "DELETE") {
    const id = Number(postDel[1]);
    store.blog = store.blog.filter(function (b) { return b.id !== id; });
    saveData();
    sendJson(res, 200, { ok: true });
    return;
  }

  /* Content + settings */
  if (pathname === "/api/admin/content" && method === "GET") {
    sendJson(res, 200, { ok: true, data: store.content });
    return;
  }
  if (pathname === "/api/admin/settings" && method === "GET") {
    sendJson(res, 200, {
      ok: true,
      data: {
        supabase: supabaseOn,
        username: auth.username,
        recoveryEmail: RECOVERY_EMAIL,
        emailService: !!RESEND_KEY,
        fromEmail: FROM_EMAIL
      }
    });
    return;
  }

  sendJson(res, 404, { ok: false, error: "Unknown admin route" });
}

server.listen(PORT, function () {
  console.log("Portfolio running at http://localhost:" + PORT);
  console.log("Admin at http://localhost:" + PORT + "/admin");
  console.log("Supabase: " + (storeLib.SB_ON ? "connected" : "not configured (using local file)"));

  /* Verify the upload bucket exists early so image issues show up in logs */
  if (supabaseOn && SB_BUCKET) {
    sbEnsureBucket().then(function (ok) {
      SB_STORAGE_STATUS = ok ? "ready" : "unavailable";
      console.log("Supabase storage bucket '" + SB_BUCKET + "': " + (ok ? "ready" : "NOT available - uploads will fall back to local disk"));
    });
  }

  boot().catch(function (e) {
    console.error("Boot failed:", e && e.message);
    ready = true;
  });
});
