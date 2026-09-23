const http = require("http");
const fs = require("fs");
const path = require("path");

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

const PORT = process.env.PORT || 3000;
const RESEND_KEY = process.env.RESEND_KEY;
const FROM_EMAIL = process.env.FROM_EMAIL || "onboarding@resend.dev";
const TO_EMAIL = process.env.TO_EMAIL || "sharmaaaarashi@gmail.com";

if (!RESEND_KEY) {
  console.error("RESEND_KEY not found. Check the .env file in the backend folder.");
}
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
  ".json": "application/json; charset=utf-8"
};

function serveStatic(req, res) {
  let urlPath = decodeURIComponent(req.url.split("?")[0]);
  if (urlPath === "/") urlPath = "/index.html";

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
    res.writeHead(200, { "Content-Type": MIME[ext] || "application/octet-stream" });
    res.end(data);
  });
}

function readBody(req) {
  return new Promise(function (resolve, reject) {
    let body = "";
    req.on("data", function (chunk) {
      body += chunk;
      if (body.length > 1e6) {
        req.destroy();
        reject(new Error("Too large"));
      }
    });
    req.on("end", function () {
      resolve(body);
    });
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

async function handleSend(req, res) {
  try {
    const data = JSON.parse(await readBody(req));
    const name = String(data.name || "").trim();
    const email = String(data.email || "").trim();
    const message = String(data.message || "").trim();

    if (!name || !email || !message) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: false, error: "Please fill in all the fields." }));
      return;
    }
    if (!/^\S+@\S+\.\S+$/.test(email)) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: false, error: "Please enter a valid email address." }));
      return;
    }

    const html =
      "<h2>New message from Rashi's Portfolio</h2>" +
      "<p><strong>Name:</strong> " + escapeHtml(name) + "</p>" +
      "<p><strong>Email:</strong> " + escapeHtml(email) + "</p>" +
      "<h3>Message</h3>" +
      "<p>" + escapeHtml(message).replace(/\n/g, "<br/>") + "</p>";

    const apiRes = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Authorization": "Bearer " + RESEND_KEY,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        from: FROM_EMAIL,
        to: [TO_EMAIL],
        subject: "Portfolio message from " + name,
        reply_to: email,
        html: html
      })
    });

    const apiData = await apiRes.json().catch(function () {
      return {};
    });

    if (apiRes.ok) {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true }));
    } else {
      res.writeHead(502, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: false, error: apiData.message || "Email service error. Please try again." }));
    }
  } catch (e) {
    res.writeHead(500, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: false, error: "Server error. Please try again." }));
  }
}

const server = http.createServer(function (req, res) {
  if (req.method === "POST" && req.url === "/api/send") {
    handleSend(req, res);
  } else {
    serveStatic(req, res);
  }
});

server.listen(PORT, function () {
  console.log("Portfolio running at http://localhost:" + PORT);
});