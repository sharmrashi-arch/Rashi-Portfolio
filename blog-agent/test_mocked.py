"""Mocked tests for blog-agent (no real keys needed)."""
import os
import sys
from pathlib import Path

# Set dummy env BEFORE importing config/post_to_blogger so no .env is needed
for _k, _v in {
    "GROQ_API_KEY": "test-key",
    "GROQ_MODEL": "test-model",
    "SERPAPI_KEY": "test-key",
    "PIXABAY_API_KEY": "test-key",
    "GOOGLE_CLIENT_ID": "test-id",
    "GOOGLE_CLIENT_SECRET": "test-secret",
    "GOOGLE_REFRESH_TOKEN": "test-refresh",
    "BLOGGER_BLOG_ID": "test-blog-id",
}.items():
    os.environ.setdefault(_k, _v)

sys.path.insert(0, str(Path(__file__).resolve().parent))

from post_to_blogger import normalize_labels, validate_post, word_count, slugify  # noqa: E402


def test_labels_empty():
    assert normalize_labels([]) == ["web development", "seo", "beginners"]


def test_labels_single():
    assert normalize_labels(["AI"]) == ["ai", "web development", "seo", "beginners"]


def test_labels_two():
    assert normalize_labels(["AI", "Web"]) == ["ai", "web", "web development", "seo", "beginners"]


def test_labels_four():
    assert normalize_labels(["AI", "Web", "SEO", "Marketing"]) == ["ai", "web", "seo", "marketing"]


def test_labels_eight_with_duplicates():
    result = normalize_labels(["AI", "ai", "WEB", "web", "SEO", "seo", "Python", "python"])
    assert result == ["ai", "web", "seo", "python"]
    assert len(result) == 4


def test_labels_topic_keyword():
    result = normalize_labels(["ai"], topic_keyword="React")
    assert "react" in result
    assert len(result) <= 5


def test_word_count_short():
    assert word_count("<p>Hello world</p>") == 2


def test_word_count_300():
    html = "<p>" + "word " * 300 + "</p>"
    assert word_count(html) == 300


def test_word_count_494():
    html = "<p>" + "word " * 494 + "</p>"
    assert word_count(html) == 494


def test_word_count_700():
    html = "<p>" + "word " * 700 + "</p>"
    assert word_count(html) == 700


def test_word_count_1500():
    html = "<p>" + "word " * 1500 + "</p>"
    assert word_count(html) == 1500


def test_slugify():
    assert slugify("Hello World!") == "hello-world"


def test_validate_post_missing_title():
    data = {
        "meta_description": "d",
        "labels": ["a", "b", "c"],
        "image_query": "q",
        "image_alt": "a",
        "html_body": "<p>x</p>",
    }
    try:
        validate_post(data, [])
        assert False, "should have raised"
    except SystemExit as e:
        assert "title" in str(e)


def test_validate_post_duplicate():
    data = {
        "title": "Old",
        "meta_description": "d",
        "labels": ["a", "b", "c"],
        "image_query": "q",
        "image_alt": "a",
        "html_body": "<p>x</p>",
    }
    try:
        validate_post(data, ["Old"])
        assert False
    except SystemExit as e:
        assert "Duplicate" in str(e)


def test_retry_logic_simulation():
    """Simulate: first attempt 300 words (fail), second 800 words (pass)."""
    attempts = []

    def fake_generate():
        attempts.append(1)
        if len(attempts) == 1:
            return {
                "title": "T1",
                "meta_description": "d",
                "labels": ["a", "b"],
                "image_query": "q",
                "image_alt": "a",
                "html_body": "<p>" + "word " * 300 + "</p>",
            }
        return {
            "title": "T2",
            "meta_description": "d",
            "labels": ["a", "b", "c"],
            "image_query": "q",
            "image_alt": "a",
            "html_body": "<p>" + "word " * 800 + "</p>",
        }

    posted_titles = []
    MIN_W, MAX_W = 550, 1200

    data = None
    for attempt in range(1, 4):
        d = fake_generate()
        d["labels"] = normalize_labels(d.get("labels", []), "react")
        validate_post(d, posted_titles)
        wc = word_count(d["html_body"])
        if MIN_W <= wc <= MAX_W:
            data = d
            break
        if attempt < 3:
            continue
        raise SystemExit(f"Word count {wc} outside range")

    assert data is not None
    assert data["title"] == "T2"
    assert len(attempts) == 2


if __name__ == "__main__":
    test_labels_empty()
    test_labels_single()
    test_labels_two()
    test_labels_four()
    test_labels_eight_with_duplicates()
    test_labels_topic_keyword()
    test_word_count_short()
    test_word_count_300()
    test_word_count_494()
    test_word_count_700()
    test_word_count_1500()
    test_slugify()
    test_validate_post_missing_title()
    test_validate_post_duplicate()
    test_retry_logic_simulation()
    print("All mocked tests passed.")