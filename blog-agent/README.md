# Blog Automation Agent

Creates a blog post **draft** on Blogger using Blogger API v3. You review and publish manually.

## Setup

1. **Copy env template**
   ```bash
   cd blog-agent
   cp .env.example .env
   ```

2. **Fill `.env`** with your keys (never commit this file):
   - `GROQ_API_KEY` — Groq API key
   - `GROQ_MODEL` — e.g. `llama-3.1-70b-versatile`
   - `SERPAPI_KEY` — SerpAPI key
   - `PIXABAY_API_KEY` — Pixabay API key
   - `GOOGLE_CLIENT_ID` — OAuth client ID
   - `GOOGLE_CLIENT_SECRET` — OAuth client secret
   - `GOOGLE_REFRESH_TOKEN` — long-lived refresh token
   - `BLOGGER_BLOG_ID` — numeric blog ID from Blogger URL
   - `SITE_URL` — your portfolio URL (default works)
   - `AI_DISCLOSURE` — `true` or `false`

3. **Install deps**
   ```bash
   pip install -r requirements.txt
   ```

## Run locally

```bash
# Dry run (prints JSON + HTML, no changes)
python post_to_blogger.py --dry-run

# Create a draft (default)
python post_to_blogger.py

# Pick a specific topic by ID
python post_to_blogger.py --topic 5

# Skip SerpAPI research
python post_to_blogger.py --no-serp

# Publish directly (not recommended)
python post_to_blogger.py --publish
```

## GitHub Actions

Workflow runs Mon/Wed/Fri 10:00 IST. Creates a draft, commits changed files.

### Add these secrets in GitHub repo → Settings → Secrets → Actions:

| Secret name | Value |
|---|---|
| GROQ_API_KEY | your key |
| GROQ_MODEL | your model |
| SERPAPI_KEY | your key |
| PIXABAY_API_KEY | your key |
| GOOGLE_CLIENT_ID | your ID |
| GOOGLE_CLIENT_SECRET | your secret |
| GOOGLE_REFRESH_TOKEN | your token |
| BLOGGER_BLOG_ID | your blog ID |

### Manual trigger

Actions → Blog Automation → Run workflow → choose `dry_run` true/false.

## Files created/updated by the agent

- `blog-agent/topics.json` — marks topic `used: true`
- `blog-agent/state/posted.json` — appends record
- `frontend/images/blog/<slug>.jpg` — downloaded image

## Testing (no keys needed)

```bash
python -m py_compile config.py post_to_blogger.py
python -m pytest tests/ -v   # if tests folder added
```

## Notes

- Images saved to `frontend/images/blog/` so Vercel serves them.
- Only drafts by default — you log in to Blogger, review, hit Publish.
- Refresh token expires if unused ~6 months. Regenerate if you get `invalid_grant`.