"""NASA Image and Video Library (images-api.nasa.gov, no key). Gives a mission card a real NASA picture."""

from __future__ import annotations

import random
import re

import httpx

from app.services import cache

DAY = 24 * 3600


async def image_for(query: str, rng: random.Random | None = None) -> dict | None:
    """Return {url, title, credit, page} for a NASA image matching `query`, or None."""
    rng = rng or random.Random()
    key = f"img:{query}"
    items = cache.get("nasa", key, DAY * 3)
    if items is None:
        items = []
        try:
            async with httpx.AsyncClient(timeout=8) as c:
                r = await c.get(
                    "https://images-api.nasa.gov/search",
                    params={"q": query, "media_type": "image", "page_size": 20},
                )
                r.raise_for_status()
                for it in r.json().get("collection", {}).get("items", []):
                    d = (it.get("data") or [{}])[0]
                    links = it.get("links") or []
                    if not links or not d.get("nasa_id"):
                        continue
                    blob = f"{d.get('title', '')} {d.get('description', '')}"
                    if not re.search(r"moon|lunar|artemis|apollo|shackleton|crater", blob, re.I):
                        continue  # the search is fuzzy; keep only on-topic pictures
                    items.append(
                        {
                            "url": links[0]["href"],
                            "title": d.get("title", ""),
                            "credit": d.get("center") or d.get("secondary_creator") or "NASA",
                            "page": f"https://images.nasa.gov/details/{d['nasa_id']}",
                        }
                    )
        except Exception:
            items = []
        if items:
            cache.put("nasa", key, items)
    return rng.choice(items[:12]) if items else None
