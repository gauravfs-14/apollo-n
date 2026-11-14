"""SerpApi (Google News + Google organic) with a 24 h cache so credits last the whole hackathon.

Returned items are plain dicts: {title, snippet, link, source, date, thumbnail}.
`snippet` is empty for Google News results; `enrich()` fills it from the article's own
meta description (fetched once, cached 24 h).
"""

from __future__ import annotations

import asyncio
import html
import logging
import os
import re

import httpx

from app.services import cache

logging.getLogger("httpx").setLevel(logging.WARNING)  # httpx logs full URLs, which contain the API key
DAY = 24 * 3600
UA = "Mozilla/5.0 (compatible; ApolloN/1.0; +https://github.com/gauravfs-14/apollo-n)"


class SerpError(RuntimeError):
    pass


async def _search(params: dict) -> dict:
    key = os.getenv("SERPAPI_KEY")
    if not key:
        raise SerpError("SERPAPI_KEY is not set")
    async with httpx.AsyncClient(timeout=15) as c:
        r = await c.get("https://serpapi.com/search.json", params={**params, "api_key": key})
        if r.status_code != 200:
            # never echo the URL (it contains the key)
            raise SerpError(f"SerpApi returned {r.status_code}")
        return r.json()


def _clean(s: str | None) -> str:
    return re.sub(r"\s+", " ", html.unescape(s or "")).strip()


def _iso(item: dict) -> str:
    return (item.get("iso_date") or "")[:10]


async def news(query: str, limit: int = 12) -> list[dict]:
    key = f"news:{query}"
    hit = cache.get("serp", key, DAY)
    if hit is not None:
        return hit[:limit]
    data = await _search({"engine": "google_news", "q": query, "gl": "us", "hl": "en"})
    out: list[dict] = []
    for it in data.get("news_results", []):
        # Stories are sometimes grouped: {"stories": [...]}; flatten.
        for n in [it, *it.get("stories", [])]:
            link = n.get("link")
            if not (n.get("title") and link):
                continue
            out.append(
                {
                    "title": _clean(n["title"]),
                    "snippet": _clean(n.get("snippet")),
                    "link": link,
                    "source": _clean((n.get("source") or {}).get("name")).replace(" (.gov)", ""),
                    "date": _iso(n),
                    "thumbnail": n.get("thumbnail"),
                }
            )
    cache.put("serp", key, out)
    return out[:limit]


async def organic(query: str, limit: int = 8) -> list[dict]:
    key = f"organic:{query}"
    hit = cache.get("serp", key, DAY)
    if hit is not None:
        return hit[:limit]
    data = await _search({"engine": "google", "q": query, "num": 10, "gl": "us", "hl": "en"})
    out = []
    for it in data.get("organic_results", []):
        link = it.get("link", "")
        if not link or "google.com/" in link:  # redirect wrappers are not real source URLs
            continue
        out.append(
            {
                "title": _clean(it.get("title")),
                "snippet": _clean(it.get("snippet")),
                "link": link,
                "source": _clean(it.get("source") or it.get("displayed_link", "").split("›")[0].replace("https://", "")),
                "date": _clean(it.get("date")),
                "thumbnail": it.get("thumbnail"),
            }
        )
    cache.put("serp", key, out)
    return out[:limit]


_META = re.compile(
    r'<meta[^>]+(?:property|name)=["\'](?:og:description|description|twitter:description)["\'][^>]*content=["\']([^"\']{40,})["\']',
    re.I,
)
_META_REV = re.compile(
    r'<meta[^>]+content=["\']([^"\']{40,})["\'][^>]*(?:property|name)=["\'](?:og:description|description|twitter:description)["\']',
    re.I,
)


async def _description(client: httpx.AsyncClient, link: str) -> str:
    hit = cache.get("page_desc", link, DAY * 7)
    if hit is not None:
        return hit
    desc = ""
    try:
        async with client.stream("GET", link, headers={"User-Agent": UA}) as r:
            if r.status_code == 200 and "html" in r.headers.get("content-type", ""):
                buf = b""
                async for chunk in r.aiter_bytes():
                    buf += chunk
                    if len(buf) > 250_000 or b"</head>" in buf:
                        break
                text = buf.decode("utf-8", "ignore")
                m = _META.search(text) or _META_REV.search(text)
                if m:
                    desc = _clean(m.group(1))
    except Exception:
        desc = ""
    cache.put("page_desc", link, desc)
    return desc


async def enrich(items: list[dict], max_items: int = 6) -> list[dict]:
    """Fill empty snippets from the article's meta description. Best effort, bounded time."""
    todo = [i for i in items[:max_items] if not i.get("snippet") and i["link"].startswith("http")]
    if not todo:
        return items
    async with httpx.AsyncClient(timeout=5, follow_redirects=True, limits=httpx.Limits(max_connections=6)) as c:
        res = await asyncio.gather(*(_description(c, i["link"]) for i in todo), return_exceptions=True)
    for i, d in zip(todo, res):
        if isinstance(d, str) and d:
            i["snippet"] = d
    return items
