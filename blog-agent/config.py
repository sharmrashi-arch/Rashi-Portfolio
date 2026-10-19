"""Config: reads env vars, validates them, never prints secrets."""
import os
from pathlib import Path
from dotenv import load_dotenv

load_dotenv(Path(__file__).with_name(".env"))

REQUIRED = [
    "GROQ_API_KEY",
    "GROQ_MODEL",
    "SERPAPI_KEY",
    "PIXABAY_API_KEY",
    "GOOGLE_CLIENT_ID",
    "GOOGLE_CLIENT_SECRET",
    "GOOGLE_REFRESH_TOKEN",
    "BLOGGER_BLOG_ID",
]

DEFAULTS = {
    "SITE_URL": "https://rashisharma-portfolio.vercel.app",
    "AI_DISCLOSURE": "true",
}

missing = [k for k in REQUIRED if not os.getenv(k)]
if missing:
    raise SystemExit(f"Missing env vars: {', '.join(missing)}")

GROQ_API_KEY = os.getenv("GROQ_API_KEY")
GROQ_MODEL = os.getenv("GROQ_MODEL")
SERPAPI_KEY = os.getenv("SERPAPI_KEY")
PIXABAY_API_KEY = os.getenv("PIXABAY_API_KEY")
GOOGLE_CLIENT_ID = os.getenv("GOOGLE_CLIENT_ID")
GOOGLE_CLIENT_SECRET = os.getenv("GOOGLE_CLIENT_SECRET")
GOOGLE_REFRESH_TOKEN = os.getenv("GOOGLE_REFRESH_TOKEN")
BLOGGER_BLOG_ID = os.getenv("BLOGGER_BLOG_ID")
SITE_URL = os.getenv("SITE_URL", DEFAULTS["SITE_URL"]).rstrip("/")
AI_DISCLOSURE = os.getenv("AI_DISCLOSURE", DEFAULTS["AI_DISCLOSURE"]).lower() == "true"

TIMEOUT = 30
MAX_RETRIES = 2