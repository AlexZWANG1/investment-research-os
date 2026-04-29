#!/usr/bin/env python3
"""
Information Sources CLI — search curated high-quality sources directly.

Usage:
    python ~/tools/sources.py rss "AI capex" --top 10        # Search RSS feeds
    python ~/tools/sources.py hn "language model" --top 5     # Search HackerNews
    python ~/tools/sources.py arxiv "transformer efficiency"  # Search ArXiv
    python ~/tools/sources.py folo "NVIDIA" --top 10          # Search Folo aggregated content
    python ~/tools/sources.py list                            # List all configured sources
"""

import argparse
import json
import os
import sys
import re
from datetime import datetime, timezone, timedelta
from pathlib import Path

if sys.stdout.encoding != "utf-8":
    sys.stdout.reconfigure(encoding="utf-8")
if sys.stderr.encoding != "utf-8":
    sys.stderr.reconfigure(encoding="utf-8")

SOURCES_YAML = Path("D:/项目开发/RSS-Notion/sources.yaml")
FOLO_SESSION_TOKEN = os.getenv("FOLO_SESSION_TOKEN", "")


# ── RSS ────────────────────────────────────────────────────

def cmd_rss(args):
    """Fetch recent items from curated RSS feeds, optionally filter by keyword."""
    import feedparser

    feeds = _load_rss_sources()
    if not feeds:
        print(json.dumps({"error": "No RSS sources found. Check sources.yaml path."}))
        return

    query = args.query.lower() if args.query else ""
    max_age_days = args.days
    cutoff = datetime.now(timezone.utc) - timedelta(days=max_age_days)
    results = []

    for feed_info in feeds:
        try:
            feed = feedparser.parse(feed_info["url"])
            for entry in feed.entries[:10]:  # max 10 per feed
                title = entry.get("title", "")
                summary = entry.get("summary", "")[:300]
                link = entry.get("link", "")
                published = entry.get("published", "")

                if query and query not in title.lower() and query not in summary.lower():
                    continue

                results.append({
                    "source": feed_info["name"],
                    "category": feed_info.get("category", ""),
                    "title": title,
                    "summary": re.sub(r'<[^>]+>', '', summary)[:200],
                    "url": link,
                    "published": published,
                })
        except Exception as e:
            print(f"[warn] Failed to fetch {feed_info['name']}: {e}", file=sys.stderr)

    # Sort by relevance (query match in title first)
    if query:
        results.sort(key=lambda x: (query not in x["title"].lower(), x["title"]), reverse=False)

    top = results[:args.top]
    print(json.dumps({"query": query, "results": top, "total_matched": len(results), "feeds_searched": len(feeds)}, ensure_ascii=False, indent=2))


def _load_rss_sources() -> list[dict]:
    """Load RSS feeds from sources.yaml."""
    if not SOURCES_YAML.exists():
        return []
    try:
        import yaml
        with open(SOURCES_YAML, "r", encoding="utf-8") as f:
            data = yaml.safe_load(f)
        if isinstance(data, dict) and "rss" in data:
            return data["rss"]
        if isinstance(data, list):
            return data
        return []
    except ImportError:
        # Fallback: parse YAML manually for simple structure
        feeds = []
        text = SOURCES_YAML.read_text(encoding="utf-8")
        for match in re.finditer(r'name:\s*"([^"]+)".*?url:\s*"([^"]+)"(?:.*?category:\s*"([^"]+)")?', text, re.DOTALL):
            feeds.append({"name": match.group(1), "url": match.group(2), "category": match.group(3) or ""})
        return feeds


# ── HackerNews ─────────────────────────────────────────────

def cmd_hn(args):
    """Search HackerNews via Algolia API."""
    import httpx

    query = args.query
    url = f"https://hn.algolia.com/api/v1/search?query={query}&tags=story&hitsPerPage={args.top}"
    try:
        resp = httpx.get(url, timeout=15.0)
        resp.raise_for_status()
        data = resp.json()
        results = []
        for hit in data.get("hits", []):
            results.append({
                "title": hit.get("title", ""),
                "url": hit.get("url", f"https://news.ycombinator.com/item?id={hit.get('objectID', '')}"),
                "points": hit.get("points", 0),
                "comments": hit.get("num_comments", 0),
                "date": hit.get("created_at", ""),
                "source": "HackerNews",
            })
        print(json.dumps({"query": query, "results": results}, ensure_ascii=False, indent=2))
    except Exception as e:
        print(json.dumps({"error": f"HN search failed: {e}"}))


# ── ArXiv ──────────────────────────────────────────────────

def cmd_arxiv(args):
    """Search ArXiv papers."""
    import httpx

    query = args.query.replace(" ", "+")
    url = f"https://export.arxiv.org/api/query?search_query=all:{query}&start=0&max_results={args.top}&sortBy=submittedDate&sortOrder=descending"
    try:
        resp = httpx.get(url, timeout=15.0)
        resp.raise_for_status()
        # Simple XML parsing
        entries = re.findall(r'<entry>(.*?)</entry>', resp.text, re.DOTALL)
        results = []
        for entry in entries:
            title = re.search(r'<title>(.*?)</title>', entry, re.DOTALL)
            summary = re.search(r'<summary>(.*?)</summary>', entry, re.DOTALL)
            link = re.search(r'<id>(.*?)</id>', entry)
            published = re.search(r'<published>(.*?)</published>', entry)
            results.append({
                "title": title.group(1).strip().replace("\n", " ") if title else "",
                "summary": summary.group(1).strip()[:200] if summary else "",
                "url": link.group(1) if link else "",
                "published": published.group(1) if published else "",
                "source": "ArXiv",
            })
        print(json.dumps({"query": args.query, "results": results}, ensure_ascii=False, indent=2))
    except Exception as e:
        print(json.dumps({"error": f"ArXiv search failed: {e}"}))


# ── Xiaohongshu (小红书) ───────────────────────────────────

XHS_MCP_URL = os.getenv("XHS_MCP_URL", "http://localhost:18060/mcp")
_xhs_session_id = None

def cmd_xhs(args):
    """Search Xiaohongshu (小红书) via local MCP server."""
    import httpx
    global _xhs_session_id

    query = args.query
    try:
        # Initialize MCP session if needed
        if not _xhs_session_id:
            init_resp = httpx.post(XHS_MCP_URL, json={
                "jsonrpc": "2.0", "id": 1, "method": "initialize",
                "params": {"protocolVersion": "2024-11-05", "capabilities": {}, "clientInfo": {"name": "sources-cli", "version": "1.0.0"}}
            }, timeout=15.0)
            init_resp.raise_for_status()
            _xhs_session_id = init_resp.headers.get("mcp-session-id", "")
            # Send initialized notification
            httpx.post(XHS_MCP_URL, json={"jsonrpc": "2.0", "method": "notifications/initialized"},
                       headers={"mcp-session-id": _xhs_session_id} if _xhs_session_id else {}, timeout=5.0)

        headers = {"mcp-session-id": _xhs_session_id} if _xhs_session_id else {}
        resp = httpx.post(XHS_MCP_URL, json={
            "jsonrpc": "2.0", "id": 2, "method": "tools/call",
            "params": {"name": "search_feeds", "arguments": {"keyword": query}}
        }, headers=headers, timeout=120.0)
        resp.raise_for_status()
        data = resp.json()

        results = []
        content = data.get("result", {}).get("content", [])
        for item in content:
            text = item.get("text", "")
            try:
                parsed = json.loads(text)
                feeds = parsed.get("feeds", parsed) if isinstance(parsed, dict) else parsed
                if isinstance(feeds, list):
                    feeds = feeds
                else:
                    feeds = [feeds]
                for feed in feeds[:args.top]:
                    note = feed.get("noteCard", {})
                    interact = note.get("interactInfo", {})
                    results.append({
                        "title": note.get("displayTitle", ""),
                        "author": note.get("user", {}).get("nickname", ""),
                        "likes": interact.get("likedCount", ""),
                        "comments": interact.get("commentCount", ""),
                        "collected": interact.get("collectedCount", ""),
                        "url": f"https://www.xiaohongshu.com/explore/{feed.get('id', '')}",
                        "source": "小红书",
                    })
            except (json.JSONDecodeError, TypeError):
                results.append({"text": text[:300], "source": "小红书"})

        print(json.dumps({"query": query, "results": results[:args.top]}, ensure_ascii=False, indent=2))
    except Exception as e:
        print(json.dumps({"error": f"小红书 search failed: {e}"}))


# ── Folo ───────────────────────────────────────────────────

def cmd_folo(args):
    """Search Folo aggregated content (Twitter, blogs, podcasts)."""
    import httpx

    if not FOLO_SESSION_TOKEN:
        print(json.dumps({"error": "FOLO_SESSION_TOKEN not set. Export it or add to .env"}))
        return

    query = args.query
    try:
        headers = {"Cookie": f"__Secure-better-auth.session_token={FOLO_SESSION_TOKEN};"}
        resp = httpx.get(
            "https://app.folo.is/api/entries",
            params={"search": query, "limit": args.top},
            headers=headers,
            timeout=15.0,
        )
        resp.raise_for_status()
        data = resp.json()
        results = []
        for item in data.get("data", []):
            results.append({
                "title": item.get("title", ""),
                "summary": (item.get("description", "") or "")[:200],
                "url": item.get("url", ""),
                "published": item.get("publishedAt", ""),
                "source": "Folo",
                "feed": item.get("feed", {}).get("title", ""),
            })
        print(json.dumps({"query": query, "results": results}, ensure_ascii=False, indent=2))
    except Exception as e:
        print(json.dumps({"error": f"Folo search failed: {e}"}))


# ── List ───────────────────────────────────────────────────

def cmd_list(args):
    """List all configured sources."""
    feeds = _load_rss_sources()
    by_category = {}
    for f in feeds:
        cat = f.get("category", "uncategorized")
        by_category.setdefault(cat, []).append(f["name"])

    sources = {
        "rss_feeds": {"count": len(feeds), "by_category": by_category},
        "hackernews": {"status": "available", "api": "hn.algolia.com"},
        "arxiv": {"status": "available", "api": "export.arxiv.org"},
        "folo": {"status": "available" if FOLO_SESSION_TOKEN else "needs FOLO_SESSION_TOKEN"},
        "xiaohongshu_mcp": {"status": "check localhost:18060"},
    }
    print(json.dumps(sources, ensure_ascii=False, indent=2))


# ── CLI ────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(description="Information Sources CLI")
    sub = parser.add_subparsers(dest="command", required=True)

    p_rss = sub.add_parser("rss", help="Search curated RSS feeds")
    p_rss.add_argument("query", nargs="?", default="", help="Keyword filter (empty = all recent)")
    p_rss.add_argument("--top", type=int, default=15, help="Max results")
    p_rss.add_argument("--days", type=int, default=7, help="Max age in days")

    p_hn = sub.add_parser("hn", help="Search HackerNews")
    p_hn.add_argument("query", help="Search query")
    p_hn.add_argument("--top", type=int, default=10)

    p_arxiv = sub.add_parser("arxiv", help="Search ArXiv papers")
    p_arxiv.add_argument("query", help="Search query")
    p_arxiv.add_argument("--top", type=int, default=5)

    p_folo = sub.add_parser("folo", help="Search Folo (Twitter/blogs)")
    p_folo.add_argument("query", help="Search query")
    p_folo.add_argument("--top", type=int, default=10)

    p_xhs = sub.add_parser("xhs", help="Search 小红书 (Xiaohongshu)")
    p_xhs.add_argument("query", help="Search query")
    p_xhs.add_argument("--top", type=int, default=10)

    sub.add_parser("list", help="List all configured sources")

    args = parser.parse_args()
    {"rss": cmd_rss, "hn": cmd_hn, "arxiv": cmd_arxiv, "folo": cmd_folo, "xhs": cmd_xhs, "list": cmd_list}[args.command](args)


if __name__ == "__main__":
    main()
