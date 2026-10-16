<div align="center">

# Rashi Sharma — Portfolio

**Web Developer & Digital Marketing Specialist · Pundri, Kaithal, Haryana, India**

[![Live Site](https://img.shields.io/badge/Live%20Site-rashisharma--portfolio.vercel.app-28a745?style=for-the-badge)](https://rashisharma-portfolio.vercel.app)
[![Entity Page](https://img.shields.io/badge/Who%20is%20Rashi%20Sharma%3F-0d6efd?style=for-the-badge)](https://rashisharma-portfolio.vercel.app/rashi-sharma)
[![Blog](https://img.shields.io/badge/Blog-ff69b4?style=for-the-badge)](https://rashisharma-portfolio.vercel.app/blog)

</div>

---

## About

This is the source code of **Rashi Sharma's personal portfolio** — a personal-brand site
built to answer one question clearly for search engines and AI assistants:

> *"Who is Rashi Sharma?"*

It is a **zero-dependency** project on both ends — plain HTML/CSS/JS on the frontend and a
pure Node.js `http` server on the backend. No frameworks, no build step, no `node_modules`.

### Highlights

| Area | What it does |
| --- | --- |
| **Frontend** | Static HTML/CSS/JS — deploys to Vercel with a clean-URL config |
| **Backend** | Node.js `http` server — contact form, admin panel, media storage, dynamic sitemap |
| **Admin panel** | Edit every part of the site from the browser (bio, projects, skills, blog, images) |
| **Image uploads** | Uploads go to a permanent Supabase Storage bucket, served via CDN |
| **SEO / AEO** | JSON-LD schema, entity page, `sitemap.xml`, image sitemap, `robots.txt` with AI-bot rules |
| **GEO** | `llms.txt` written for AI crawlers + IndexNow instant indexing |
| **Analytics** | Google Analytics 4 (privacy-friendly, no cookies) |

---

## Tech Stack

**Frontend**
- HTML5 (semantic, accessible markup)
- CSS3 (custom properties, responsive, dark theme)
- Vanilla JavaScript (ES6+, no framework)
- Vercel for hosting with `cleanUrls`

**Backend**
- Node.js `>= 18` — built on the native `http` module
- **No npm dependencies** (`backend/package.json` has zero `dependencies`)
- REST-style JSON API

**Integrations**
- Supabase (Storage for images + Postgres for content sync)
- Resend (transactional email for the contact form & password reset)
- Google Analytics 4
- IndexNow (Bing/Yandex instant indexing)
- Vercel (frontend) · Render (backend API)

---

## Project Structure

```
Rashi-Portfolio/
├── frontend/                  # Static site (Vercel root directory)
│   ├── index.html             # Home page
│   ├── rashi-sharma.html      # "Who is Rashi Sharma?" entity page
│   ├── blog.html              # Blog
│   ├── robots.txt             # Includes AI-crawler rules
│   ├── sitemap.xml            # Sitemap + Google image sitemap
│   ├── llms.txt               # Plain-text summary for AI crawlers
│   ├── vercel.json            # cleanUrls + redirects
│   ├── admin/index.html       # Admin login redirect page
│   ├── css/style.css
│   ├── js/main.js             # Fetches content from the API
│   ├── images/                # Photos, project shots, OG cover, icons
│   └── videos/
│
├── backend/                   # Node API (Render)
│   ├── server.js              # Whole server: routes, storage, sitemap
│   ├── admin-dashboard.html   # Admin panel UI
│   ├── auth.json              # Admin credentials (git-ignored)
│   ├── data.json              # Site content store
│   └── package.json           # start: node server.js
│
├── start.bat                  # Windows one-click start
├── startup-server.vbs         # Run the server hidden on Windows boot
└── README.md
```

---

## Getting Started

### Prerequisites
- [Node.js](https://nodejs.org) 18 or newer
- No other dependencies to install

### Run locally

```bash
# 1. Start the API server (serves both the site and the API on :3000)
cd backend
node server.js

# or on Windows, double-click:
start.bat
```

Then open:

| URL | What |
| --- | --- |
| http://localhost:3000/ | The website |
| http://localhost:3000/rashi-sharma | Entity page |
| http://localhost:3000/blog | Blog |
| http://localhost:3000/admin | Admin login |
| http://localhost:3000/api/health | Health check (shows whether storage is ready) |
| http://localhost:3000/api/site | All site content as JSON |

### Frontend-only preview

The `frontend/` folder is fully static, so you can also just open
`frontend/index.html` or serve it with any static file server.

---

## Environment Variables

Create a `backend/.env` file (**never committed** — it is already in `.gitignore`).

| Variable | Required | Purpose |
| --- | --- | --- |
| `PORT` | No | Server port. Default `3000` |
| `ADMIN_SESSION_SECRET` | **Production** | Secret used to sign admin session cookies |
| `SUPABASE_URL` | Recommended | Supabase project URL — enables image uploads |
| `SUPABASE_SECRET_KEY` | Recommended | Supabase service-role key. Alias: `SUPABASE_SERVICE_ROLE_KEY` |
| `SUPABASE_PUBLISHABLE_KEY` | No | Supabase anon key, if the frontend ever needs direct access |
| `SUPABASE_BUCKET` | No | Storage bucket name. Default `portfolio-images` |
| `RESEND_KEY` | Recommended | Resend API key for the contact form. Alias: `RESENDKEY` |
| `FROM_EMAIL` | No | Sender address for emails. Default `onboarding@resend.dev` |
| `TO_EMAIL` | No | Where contact-form submissions are delivered |
| `RECOVERY_EMAIL` | No | Where password-reset emails are delivered |
| `ALLOWED_ORIGINS` | No | Comma-separated CORS allowlist for the frontend |
| `SITE_ORIGIN` | No | Canonical origin used to build sitemap/robots URLs |

> **Check which integrations are live:** `GET /api/health` returns
> `storageBucket` and `emailService` flags, e.g.
> `{"storageBucket":"ready","emailService":true}`.

---

## API

| Method | Endpoint | Auth | Description |
| --- | --- | --- | --- |
| `GET` | `/api/site` | No | All site content (used by the frontend to render) |
| `GET` | `/api/health` | No | Health + which services are configured |
| `POST` | `/api/send` | No | Contact form — sends via Resend, saves to `data.json` |
| `POST` | `/api/admin/login` | No | Returns an HttpOnly session cookie |
| `POST` | `/api/admin/logout` | Cookie | Clears the session |
| `POST` | `/api/admin/reset` | No | Emails a password-reset link |
| `GET` | `/api/admin/content` | Cookie | Read editable content |
| `POST` | `/api/admin/content` | Cookie | Save content |
| `POST` | `/api/admin/upload` | Cookie | Upload image/video → Supabase Storage |
| `GET` | `/sitemap.xml` | No | Dynamic sitemap, includes image entries |
| `GET` | `/robots.txt` | No | Crawler rules |
| `GET` | `/llms.txt` | No | AI-crawler summary |

---

## Admin Panel

Go to `/admin` and sign in.

From there you can edit:

- **About** — name, headline, bio, email, social links, photo
- **Projects** — add, edit, reorder, feature projects with screenshots
- **Capabilities** — skills and tools with icons
- **Content** — blog posts and page copy
- **Credentials** — NIELIT certification and other credentials
- **Images** — logo, hero photo, OG cover, favicon

Uploads are stored in Supabase Storage, so they are permanent and served over CDN.
Replacing an image automatically deletes the old file so storage never grows stale.

---

## SEO / AEO / GEO

This project is deliberately built for **Answer Engines** (ChatGPT, Perplexity,
Google AI Overviews, Claude, Bing Copilot) as well as classic search:

- **JSON-LD** on every page — `Person`, `ProfilePage`, `WebSite`, `Blog`, `BreadcrumbList`, `FAQPage`, `ImageObject`
- **Entity page** at `/rashi-sharma` — a dedicated, citable profile page
- **Image SEO** — descriptive image filenames, keyword-rich alt text, and a Google image sitemap (`<image:image>` with title + caption)
- **`llms.txt`** — a concise, plain-text brief written specifically for LLM crawlers
- **`robots.txt`** — explicitly allows major AI crawlers
- **IndexNow** — pings Bing/Yandex the moment a page changes
- **Graceful degradation** — real content in `<noscript>` so crawlers without JS still see the text

---

## Deployment

**Frontend → Vercel**
- Root directory: `frontend`
- Framework preset: *Other*
- `cleanUrls` are enabled via `vercel.json`

**Backend → Render**
- Build command: `npm install`
- Start command: `node server.js`
- Add the environment variables listed above in the Render dashboard

---

## Security Notes

- Admin credentials live in `backend/auth.json`, which is **git-ignored**
- Passwords are hashed; sessions are signed with `ADMIN_SESSION_SECRET`
- Session cookies are `HttpOnly` + `SameSite=Strict`
- Reset tokens expire after 15 minutes, resend requests are rate-limited
- Never commit `.env` or `auth.json`

---

## Contact

- **Email:** [rashi.sharma@email.com](mailto:rashi.sharma@email.com)
- **Location:** Pundri, Kaithal, Haryana, India
- **Website:** <https://rashisharma-portfolio.vercel.app>

---

## License

© Rashi Sharma. All rights reserved.

*This project is private and intended for personal use.*
