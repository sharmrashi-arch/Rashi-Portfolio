#!/usr/bin/env python3
"""Blog automation: picks a topic, researches, writes, gets image, posts to Blogger as draft."""
import argparse
import json
import os
import re
import sys
import time
from pathlib import Path
from urllib.parse import urlencode

import requests
from PIL import Image

from config import (
    GROQ_API_KEY,
    GROQ_MODEL,
    SERPAPI_KEY,
    PIXABAY_API_KEY,
    GOOGLE_CLIENT_ID,
    GOOGLE_CLIENT_SECRET,
    GOOGLE_REFRESH_TOKEN,
    BLOGGER_BLOG_ID,
    SITE_URL,
    AI_DISCLOSURE,
    TIMEOUT,
    MAX_RETRIES,
)

# ────────────────────────── helpers ──────────────────────────

def slugify(text: str) -> str:
    """Make a URL-safe slug from title."""
    text = text.lower()
    text = re.sub(r"[^a-z0-9\s-]", "", text)
    text = re.sub(r"[\s-]+", "-", text).strip("-")
    return text[:80]


def word_count(html: str) -> int:
    """Count words in HTML (strip tags)."""
    text = re.sub(r"<[^>]+>", " ", html)
    text = re.sub(r"\s+", " ", text)
    return len(text.split())


def retry_post(url: str, **kwargs) -> requests.Response:
    """POST with retries for network errors."""
    last_err = None
    for _ in range(MAX_RETRIES + 1):
        try:
            return requests.post(url, timeout=TIMEOUT, **kwargs)
        except requests.RequestException as e:
            last_err = e
            time.sleep(1)
    raise last_err


def retry_get(url: str, **kwargs) -> requests.Response:
    """GET with retries for network errors."""
    last_err = None
    for _ in range(MAX_RETRIES + 1):
        try:
            return requests.get(url, timeout=TIMEOUT, **kwargs)
        except requests.RequestException as e:
            last_err = e
            time.sleep(1)
    raise last_err


# ────────────────────────── topics ──────────────────────────

TOPICS_FILE = Path(__file__).with_name("topics.json")
POSTED_FILE = Path(__file__).with_name("state") / "posted.json"


def load_topics() -> list[dict]:
    with open(TOPICS_FILE, "r", encoding="utf-8") as f:
        return json.load(f)


def save_topics(topics: list[dict]) -> None:
    with open(TOPICS_FILE, "w", encoding="utf-8") as f:
        json.dump(topics, f, indent=2, ensure_ascii=False)


def load_posted() -> list[dict]:
    if POSTED_FILE.exists():
        with open(POSTED_FILE, "r", encoding="utf-8") as f:
            return json.load(f)
    return []


def save_posted(posted: list[dict]) -> None:
    with open(POSTED_FILE, "w", encoding="utf-8") as f:
        json.dump(posted, f, indent=2, ensure_ascii=False)


def pick_topic(topics: list[dict], topic_id: int | None) -> dict | None:
    if topic_id:
        for t in topics:
            if t["id"] == topic_id:
                return t
        raise SystemExit(f"Topic ID {topic_id} not found")
    for t in topics:
        if not t.get("used", False):
            return t
    return None


# ────────────────────────── SerpAPI research ──────────────────────────

def serpapi_research(keyword: str) -> dict:
    """One call to SerpAPI. Returns dict with questions, searches, organic."""
    url = "https://serpapi.com/search.json"
    params = {"engine": "google", "q": keyword, "hl": "en", "gl": "in", "api_key": SERPAPI_KEY}
    try:
        r = retry_get(url, params=params)
        if r.status_code != 200:
            return {}
        data = r.json()
        return {
            "questions": [q.get("question", "") for q in data.get("related_questions", [])[:3]],
            "searches": [s.get("query", "") for s in data.get("related_searches", [])[:5]],
            "organic": [
                {"title": o.get("title", ""), "snippet": o.get("snippet", "")}
                for o in data.get("organic_results", [])[:5]
            ],
        }
    except Exception:
        return {}


# ────────────────────────── Groq generation ──────────────────────────

SYSTEM_PROMPT = """You are an SEO content writer for a beginner-friendly developer blog.
Write in simple, clear English. Target 700-900 words.
Output ONLY valid JSON with these keys:
title, meta_description (max 155 chars), labels (3-5 items), image_query (2-3 words), image_alt, html_body.

Rules for html_body:
- No <h1>. Use <h2> for sections, <h3> for subsections.
- Use <p> and <ul><li> only.
- Intro paragraph, 3-5 sections, short conclusion.
- Answer 2-3 "People also ask" questions naturally in sections.
- One link to the author's portfolio at the end: <a href="SITE_URL">Rashi Sharma's portfolio</a>
- No placeholders like [Your Name].
- HONESTY: Do NOT invent personal experiences, client stories, statistics, quotes, prices, dates, or version numbers.
- General educational content only.
- Facts you MAY use about the author:
  * Rashi Sharma is a web developer and digital marketing learner from Pundri, Haryana.
  * She built her own portfolio with Vercel, Render and Supabase.
  * She set up Google Search Console, Google Analytics and Bing Webmaster Tools for it.
"""


def build_user_prompt(topic: dict, research: dict) -> str:
    parts = [
        f"Topic: {topic['topic']}",
        f"Target keyword: {topic['keyword']}",
    ]
    if research.get("questions"):
        parts.append("People also ask:\n- " + "\n- ".join(research["questions"]))
    if research.get("searches"):
        parts.append("Related searches:\n- " + "\n- ".join(research["searches"]))
    if research.get("organic"):
        parts.append("Top results (for context only, do not copy):")
        for o in research["organic"]:
            parts.append(f"  - {o['title']}: {o['snippet'][:160]}")
    return "\n\n".join(parts)


def groq_generate(prompt: str) -> dict:
    url = "https://api.groq.com/openai/v1/chat/completions"
    headers = {"Authorization": f"Bearer {GROQ_API_KEY}", "Content-Type": "application/json"}
    payload = {
        "model": GROQ_MODEL,
        "temperature": 0.7,
        "messages": [
            {"role": "system", "content": SYSTEM_PROMPT.replace("SITE_URL", SITE_URL)},
            {"role": "user", "content": prompt},
        ],
        "response_format": {"type": "json_object"},
    }
    for attempt in range(2):
        r = retry_post(url, headers=headers, json=payload)
        if r.status_code != 200:
            continue
        try:
            content = r.json()["choices"][0]["message"]["content"]
            data = json.loads(content)
            return data
        except Exception:
            continue
    raise SystemExit("Groq: failed to get valid JSON after retries")


def validate_post(data: dict, posted_titles: list[str]) -> None:
    required = ["title", "meta_description", "labels", "image_query", "image_alt", "html_body"]
    for k in required:
        if not data.get(k):
            raise SystemExit(f"Missing field in Groq output: {k}")
    if data["title"] in posted_titles:
        raise SystemExit("Duplicate title (already posted)")
    wc = word_count(data["html_body"])
    if not (600 <= wc <= 1100):
        raise SystemExit(f"Word count {wc} outside 600-1100 range")
    if len(data["meta_description"]) > 155:
        raise SystemExit("meta_description too long (>155 chars)")
    if not (3 <= len(data["labels"]) <= 5):
        raise SystemExit("labels must be 3-5 items")


# ────────────────────────── Pixabay image ──────────────────────────

def pixabay_download(image_query: str, slug: str) -> dict | None:
    """Download first good horizontal photo, resize to max 1200px, save as JPEG q80.
    Returns dict with url, width, height, credit or None."""
    url = "https://pixabay.com/api/"
    params = {
        "key": PIXABAY_API_KEY,
        "q": image_query,
        "image_type": "photo",
        "orientation": "horizontal",
        "safesearch": "true",
        "per_page": 5,
    }
    try:
        r = retry_get(url, params=params)
        if r.status_code != 200:
            return None
        hits = r.json().get("hits", [])
        for hit in hits:
            img_url = hit.get("largeImageURL") or hit.get("webformatURL")
            if not img_url:
                continue
            img_r = retry_get(img_url)
            if img_r.status_code != 200:
                continue
            img_path = Path(__file__).parents[1] / "frontend" / "images" / "blog" / f"{slug}.jpg"
            img_path.parent.mkdir(parents=True, exist_ok=True)
            with open(img_path, "wb") as f:
                f.write(img_r.content)
            # resize
            with Image.open(img_path) as im:
                if im.width > 1200:
                    ratio = 1200 / im.width
                    new_size = (1200, int(im.height * ratio))
                    im = im.resize(new_size, Image.LANCZOS)
                im.save(img_path, "JPEG", quality=80, optimize=True)
                w, h = im.size
            return {
                "url": f"{SITE_URL}/images/blog/{slug}.jpg",
                "width": w,
                "height": h,
                "credit": hit.get("user", "Pixabay"),
            }
    except Exception:
        pass
    return None


# ────────────────────────── Blogger API ──────────────────────────

def refresh_access_token() -> str:
    url = "https://oauth2.googleapis.com/token"
    data = {
        "client_id": GOOGLE_CLIENT_ID,
        "client_secret": GOOGLE_CLIENT_SECRET,
        "refresh_token": GOOGLE_REFRESH_TOKEN,
        "grant_type": "refresh_token",
    }
    r = retry_post(url, data=data)
    if r.status_code == 400:
        err = r.json().get("error", "")
        if err == "invalid_grant":
            raise SystemExit("Refresh token expired or revoked. Regenerate it.")
    if r.status_code != 200:
        raise SystemExit(f"Token refresh failed: {r.status_code} {r.text}")
    return r.json()["access_token"]


def blogger_create_post(access_token: str, title: str, content: str, labels: list[str], publish: bool) -> dict:
    url = f"https://www.googleapis.com/blogger/v3/blogs/{BLOGGER_BLOG_ID}/posts"
    params = {"isDraft": "false" if publish else "true"}
    headers = {"Authorization": f"Bearer {access_token}", "Content-Type": "application/json"}
    body = {"kind": "blogger#post", "title": title, "content": content, "labels": labels}
    r = retry_post(url, params=params, headers=headers, json=body)
    if r.status_code == 401:
        raise SystemExit("401 Unauthorized: check OAuth scopes and token")
    if r.status_code == 403:
        raise SystemExit("403 Forbidden: check Blogger API enabled and permissions")
    if r.status_code == 404:
        raise SystemExit("404 Not Found: check BLOGGER_BLOG_ID")
    if r.status_code >= 400:
        raise SystemExit(f"Blogger API error: {r.status_code} {r.text}")
    return r.json()


# ────────────────────────── build final HTML ──────────────────────────

def build_final_html(data: dict, image_info: dict | None) -> str:
    parts = []
    if image_info:
        parts.append(
            f'<figure><img src="{image_info["url"]}" alt="{data["image_alt"]}" '
            f'width="{image_info["width"]}" height="{image_info["height"]}" loading="lazy" />'
            f'<figcaption>Image: {image_info["credit"]} on Pixabay</figcaption></figure>'
        )
    parts.append(data["html_body"])
    # author box
    parts.append(
        f'<div style="margin-top:2rem;padding:1rem;border-top:1px solid #ddd;font-size:0.9rem;">'
        f'<strong>Rashi Sharma</strong> — Web developer & digital marketing learner from Pundri, Haryana. '
        f'<a href="{SITE_URL}">Visit portfolio</a>.'
        f'</div>'
    )
    if AI_DISCLOSURE:
        parts.append(
            '<p style="font-size:0.85rem;color:#666;margin-top:0.5rem;">'
            'This post was drafted with AI assistance and reviewed by Rashi Sharma.</p>'
        )
    return "\n\n".join(parts)


# ────────────────────────── main flow ──────────────────────────

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--dry-run", action="store_true", help="Research & write, print result, no changes")
    parser.add_argument("--topic", type=int, help="Specific topic ID to use")
    parser.add_argument("--no-serp", action="store_true", help="Skip SerpAPI research")
    parser.add_argument("--publish", action="store_true", help="Publish immediately (default: draft)")
    args = parser.parse_args()

    topics = load_topics()
    posted = load_posted()
    posted_titles = [p["title"] for p in posted]

    topic = pick_topic(topics, args.topic)
    if not topic:
        print("No unused topics left.")
        return 0

    print(f"Picked topic: {topic['id']} — {topic['topic']}")

    # 1. Research
    research = {} if args.no_serp else serpapi_research(topic["keyword"])
    if research:
        print(f"SerpAPI: {len(research.get('questions',[]))} questions, {len(research.get('organic',[]))} organic")

    # 2. Generate
    prompt = build_user_prompt(topic, research)
    data = groq_generate(prompt)
    validate_post(data, posted_titles)
    print(f"Title: {data['title']}")
    print(f"Words: {word_count(data['html_body'])}")

    # 3. Image
    slug = slugify(data["title"])
    image_info = None if args.dry_run else pixabay_download(data["image_query"], slug)
    if image_info:
        print(f"Image saved: {image_info['url']} ({image_info['width']}x{image_info['height']})")
    else:
        print("No image (or dry run)")

    # 4. Final HTML
    final_html = build_final_html(data, image_info)

    if args.dry_run:
        print("\n=== FINAL JSON ===")
        print(json.dumps({**data, "html_body": final_html}, indent=2, ensure_ascii=False))
        return 0

    # 5. Blogger
    access_token = refresh_access_token()
    result = blogger_create_post(access_token, data["title"], final_html, data["labels"], args.publish)
    post_id = result.get("id")
    print(f"Blogger post created: {post_id} (draft={not args.publish})")

    # 6. Update state
    topic["used"] = True
    save_topics(topics)
    posted.append({
        "topic_id": topic["id"],
        "title": data["title"],
        "date": time.strftime("%Y-%m-%d"),
        "blogger_post_id": post_id,
        "image_file": f"{slug}.jpg" if image_info else None,
    })
    save_posted(posted)
    print("State updated.")
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except SystemExit as e:
        if e.code:
            print(f"ERROR: {e}", file=sys.stderr)
        sys.exit(e.code if isinstance(e.code, int) else 1)
    except Exception as e:
        print(f"UNEXPECTED ERROR: {e}", file=sys.stderr)
        sys.exit(1)