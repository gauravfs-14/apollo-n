"""Mission Plan generation + the background pool of ready missions.

Flow of one generation (typically 20-60 s with the local codex CLI):
  seed -> topic -> SerpApi google_news (cached 24 h) -> article meta descriptions
       -> LLM writes the plan using ONLY those snippets -> assemble (locked sites, ids, fact sources)
       -> validate (app.models) -> retry once with the errors -> cached fallback plan.

The pool keeps POOL_SIZE ready missions per difficulty so /missions/options is instant.
Entries look like {"plan": MissionPlan-dict, "image": {...}|None, "kind": "live"|"fallback", "topic": str}.
"""

from __future__ import annotations

import asyncio
import copy
import json
import logging
import random
import re
import threading
import time
from pathlib import Path
from typing import Any

from app.services.feasible import make_feasible
from app.models import HURDLE_RANGE, LOCKED_SITES, ROLES, MissionPlan, validation_errors
from app.services import cache, llm, nasa, serp

log = logging.getLogger("apollo.plan")

FALLBACK_DIR = Path(__file__).resolve().parents[3] / "shared" / "fallback-plans"
POOL_SIZE = 3
DIFFICULTIES = ("normal", "easy", "hard")

# (topic key, news queries, NASA image query, one-line brief for the model)
TOPICS: list[tuple[str, list[str], str, str]] = [
    ("artemis", ["Artemis moon mission", "Artemis III lunar lander"], "Artemis moon", "NASA's Artemis return to the Moon"),
    ("intuitive-machines", ["Intuitive Machines Moon lander"], "lunar lander", "a commercial lander delivering NASA payloads (CLPS)"),
    ("blue-ghost", ["Firefly Blue Ghost Moon lander"], "lunar lander moon", "Firefly's Blue Ghost commercial lunar lander"),
    ("ispace", ["ispace Moon lander", "Astrobotic Griffin Moon lander"], "moon lander", "private landers heading for the Moon"),
    ("viper", ["VIPER rover Moon ice"], "moon rover", "NASA's VIPER ice-hunting rover"),
    ("lunar-ice", ["lunar water ice south pole", "water ice permanently shadowed craters Moon"], "moon south pole", "water ice at the lunar poles"),
    ("lro", ["Lunar Reconnaissance Orbiter"], "Lunar Reconnaissance Orbiter", "NASA's Lunar Reconnaissance Orbiter mapping the Moon"),
    ("chandrayaan", ["Chandrayaan Moon south pole", "ISRO Chandrayaan lunar"], "moon south pole", "India's Chandrayaan lunar missions"),
    ("change", ["Chang'e Moon mission", "China lunar south pole Chang'e-7"], "moon far side", "China's Chang'e lunar missions"),
    ("south-pole", ["Moon south pole exploration", "Moon base south pole"], "moon south pole", "exploring the Moon's south pole"),
]

CHECKLIST_GUIDE = {
    "quiz": 'style "quiz": 4 items. Each item: prompt (a question), answer, options (3-4 strings, answer must be one of them). '
    "Answerable with common sense or from a fact the player has just read in the briefing.",
    "order_steps": 'style "order_steps": 5 items. Each prompt is one launch-prep step; items listed in the CORRECT order; '
    'answer is the step position as a string ("1" .. "5").',
    "memory_match": 'style "memory_match": 5 items. prompt is a term (e.g. "Antenna"), answer is its plain-words match (e.g. "Talks to Earth").',
    "switch_panel": 'style "switch_panel": 4 items. prompt like "Switch the heaters ON"; answer is "on" or "off". Mix both.',
}

GENERIC_HURDLES = [
    {"type": "debris_field", "role": "pilot", "difficulty": 1, "story": "Radar shows a field of small debris ahead. Steer through the gaps."},
    {"type": "engine_fault", "role": "engineer", "difficulty": 1, "story": "Fuel pressure dropped in line B. Reroute the pipes before the next burn."},
    {"type": "solar_storm", "role": "commander", "difficulty": 1, "story": "A burst of solar particles is heading our way. Get the crew behind the shielding."},
    {"type": "nav_correction", "role": "pilot", "difficulty": 1, "story": "We drifted slightly off course. Line up the rings to correct our path."},
    {"type": "comms_blackout", "role": "commander", "difficulty": 1, "story": "The radio link to Earth dropped. Re-align the antenna to reconnect."},
]
SITE_HINTS = {
    "site_a": "the rim of Shackleton crater at the pole: long sunlight, next to permanently shadowed ground",
    "site_b": "Connecting Ridge between Shackleton and de Gerlache: high ground with a good view of Earth",
    "site_c": "de Gerlache crater rim, further from the pole: gentler slopes, somewhat further from the ice",
}

# ---------------------------------------------------------------- counter + registry

_lock = threading.Lock()


def next_number() -> int:
    """Persistent mission counter (api/data/cache/state/...)."""
    with _lock:
        n = int(cache.get("state", "mission_counter") or 0) + 1
        cache.put("state", "mission_counter", n)
        return n


def register(entry: dict) -> None:
    cache.put("plans", entry["plan"]["id"], entry)


def lookup(plan_id: str) -> dict | None:
    return cache.get("plans", plan_id)


# ---------------------------------------------------------------- fallback plans


def _fallback_files() -> list[Path]:
    return sorted(FALLBACK_DIR.glob("apollo-*.json"))


def fit_difficulty(plan: dict, difficulty: str) -> dict:
    lo, hi = HURDLE_RANGE[difficulty]
    want = hi
    plan["difficulty"] = difficulty
    h = plan["cruise"][:want]
    pool = [g for g in GENERIC_HURDLES if g["type"] not in {x["type"] for x in h}] + GENERIC_HURDLES
    i = 0
    while len(h) < max(lo, want if difficulty != "hard" else 4):
        h.append(copy.deepcopy(pool[i % len(pool)]))
        i += 1
    base = {"easy": 1, "normal": 1, "hard": 2}[difficulty]
    for x in h:
        x["difficulty"] = min(3, max(x["difficulty"], base))
    plan["cruise"] = h
    return plan


def fallback_entry(difficulty: str, avoid: set[str] | None = None, rng: random.Random | None = None) -> dict:
    """A hand-checked plan renumbered as the next mission. `avoid` = inspired_by urls already shown."""
    rng = rng or random.Random()
    files = _fallback_files()
    rng.shuffle(files)
    avoid = avoid or set()
    files.sort(key=lambda f: json.loads(f.read_text())["inspired_by"]["source_url"] in avoid)
    plan = json.loads(files[0].read_text())
    old = plan["number"]
    n = next_number()
    plan["number"], plan["id"], plan["seed"] = n, f"apollo-{n}", rng.randrange(1, 2**31)
    plan["title"] = re.sub(rf"^Apollo {old}\b", f"Apollo {n}", plan["title"])
    for v in plan["voice_lines"]:
        v["text"] = re.sub(rf"\bApollo {old}\b", f"Apollo {n}", v["text"])
    fit_difficulty(plan, difficulty)
    plan["ship"]["constraints"] = make_feasible(plan["ship"]["constraints"])
    errs = validation_errors(plan)
    if errs:  # a broken hand-written fallback is a bug worth surfacing
        raise RuntimeError(f"fallback plan invalid: {errs}")
    return {"plan": plan, "image": None, "kind": "fallback", "topic": "fallback", "created": time.time()}


# ---------------------------------------------------------------- sources


def _norm(s: str) -> str:
    return re.sub(r"[^a-z0-9 ]+", " ", s.lower())


def _numbers(s: str) -> set[str]:
    return {m.replace(",", "").rstrip(".") for m in re.findall(r"\d[\d,]*\.?\d*", s)}


def fact_supported(text: str, source_text: str) -> bool:
    """A fact must be grounded: its numbers appear in the source and most of its content words do too."""
    src = _norm(source_text)
    if not _numbers(text) <= _numbers(source_text):
        return False
    words = [w for w in _norm(text).split() if len(w) > 3]
    if not words:
        return False
    return sum(w in src for w in words) / len(words) >= 0.4


async def gather_sources(topic: tuple, rng: random.Random) -> list[dict]:
    _, queries, _, _ = topic
    items: list[dict] = []
    seen: set[str] = set()
    for q in queries[:2]:
        try:
            for it in await serp.news(q):
                if it["link"] not in seen:
                    seen.add(it["link"])
                    items.append(it)
        except serp.SerpError as e:
            log.warning("serp news failed: %s", e)
    try:  # one organic query for reference pages (skipped silently if it yields nothing usable)
        for it in await serp.organic(f"{queries[0]} NASA", 5):
            if it["link"] not in seen and it.get("snippet"):
                seen.add(it["link"])
                items.append(it)
    except serp.SerpError:
        pass
    items.sort(key=lambda i: i.get("date") or "", reverse=True)
    recent = items[:10]
    rng.shuffle(recent)
    recent = await serp.enrich(recent, 8)
    usable = [i for i in recent if len(i["title"]) + len(i["snippet"]) > 60]
    usable.sort(key=lambda i: -len(i["snippet"]))
    chosen = usable[:6]
    for k, it in enumerate(chosen, 1):
        it["id"] = f"s{k}"
    return chosen


# ---------------------------------------------------------------- LLM prompt

SYSTEM = """You are the mission designer for "Apollo N", a Moon-mission game for teenagers and adults with zero space knowledge.
You turn REAL recent news into a playable Mission Plan. Rules:
- Facts: use ONLY information that appears in the provided sources. Each fact must paraphrase or quote one source and cite it by its id (s1, s2...). Never add numbers, dates, names or claims that are not in that source. If a source is thin, write a shorter fact.
- Everything the player must DO has to be solvable without space knowledge: plain words, one clear idea per item, no jargon without explanation.
- Voice lines are spoken by mission control: calm, short (under 30 words), professional, no exclamation marks.
- goal.why is the real-world reason the topic matters (for example water for future crews), never a sentence about the game itself. Never mention source ids (s1, s2) outside the "source" fields, and never say "this mission follows the news".
- No emoji. No markdown. English only.
- Output exactly ONE JSON object in the shape described. No commentary."""


def _user_prompt(number: int, difficulty: str, style: str, topic: tuple, sources: list[dict], seed: int) -> str:
    lo, hi = HURDLE_RANGE[difficulty]
    hurdles = f"exactly {hi}" if lo == hi else f"{lo} to {hi}"
    src = [
        {"id": s["id"], "outlet": s["source"], "date": s["date"], "title": s["title"], "text": s["snippet"]}
        for s in sources
    ]
    diff_note = {
        "easy": "Friendly tone, generous numbers (ship max_mass_kg 1800-2500, min_battery_hours 30-45, min_delta_v 2200-2400), hurdle difficulty 1.",
        "normal": "Balanced (ship max_mass_kg 1300-1800, min_battery_hours 45-65, min_delta_v 2400-2700), hurdle difficulty 1-2.",
        "hard": "Demanding (ship max_mass_kg 1000-1400, min_battery_hours 65-100, min_delta_v 2700-3100), hurdle difficulty 2-3.",
    }[difficulty]
    shape = {
        "title_suffix": "2-5 evocative words, no colon (the game prints 'Apollo %d: <this>')" % number,
        "tagline": "one sentence under 14 words describing the mission",
        "goal": {"text": "what the crew must achieve, one sentence", "why": "why it matters, plain words, one sentence"},
        "inspired_by": {"source": "id of the single most relevant source"},
        "facts": [{"source": "s1", "text": "a self-contained fact paraphrased from that source (1-2 sentences)"}],
        "site_why": ["why site_a suits this mission", "why site_b suits this mission", "why site_c suits this mission"],
        "ship": {
            "max_mass_kg": 1500, "min_battery_hours": 50, "min_delta_v": 2400,
            "required_payload": ["one or two of: drill, sample, spectrometer, camera, relay"],
            "rationale": "why these limits, linked to the mission story, one or two sentences",
        },
        "checklist": {"style": style, "items": [{"prompt": "...", "answer": "...", "options": ["quiz only"], "fact_id": "optional f1"}]},
        "cruise": [{"type": "debris_field|solar_storm|engine_fault|nav_correction|comms_blackout", "role": "commander|pilot|engineer|scientist", "difficulty": 1, "story": "1-2 plain sentences of what is happening and what to do", "fact_id": "optional f1"}],
        "surface": {
            "tasks": [{"id": "t1", "role": "commander|pilot|engineer|scientist", "type": "scan|collect_sample|deploy_relay|repair|navigate_to", "title": "short imperative", "hint": "one clear cue", "unlocks": "t2 (omit on the last task)"}],
            "final": "id of the last task",
        },
        "voice_lines": [{"id": "brief_1|launch_1|landing_1|success_1", "text": "..."}],
    }
    return f"""Design Apollo {number} (difficulty: {difficulty}). Theme: {topic[3]}. Variety seed: {seed}.

SOURCES (real news, fetched today; cite by id):
{json.dumps(src, indent=1)}

Requirements:
- facts: 3 or 4, each from a different source where possible. Fact ids will be f1, f2, ... in the order you write them; checklist/cruise fact_id may reference them.
- site_why: three sentences, one per landing site, in this order. The sites are fixed: site_a = {SITE_HINTS['site_a']}; site_b = {SITE_HINTS['site_b']}; site_c = {SITE_HINTS['site_c']}. Tie each to this mission's goal.
- checklist: {CHECKLIST_GUIDE[style]}
- cruise: {hurdles} hurdles, all different types, roles spread across the four roles, each story ties into the mission.
- surface: 3 tasks chained with "unlocks" (t1 unlocks t2, t2 unlocks t3), different roles, final = the last task.
- voice_lines: exactly four: brief_1 (mission briefing mentioning Apollo {number} and the goal), launch_1, landing_1, success_1.
- Ship numbers: {diff_note}
- The goal must feel connected to the real news above.

Output JSON in this shape:
{json.dumps(shape, indent=1)}"""


# ---------------------------------------------------------------- assemble + validate


_SRC_REF = re.compile(r"\s*[\(\[]\s*s\d+(?:\s*[,;&]\s*s\d+)*\s*[\)\]]|\bsources?\s+s\d+\b|\bs\d\b")


def _scrub(o: Any) -> Any:
    """Remove leaked source ids like "(s2)" from every string the model wrote."""
    if isinstance(o, str):
        return re.sub(r"\s{2,}", " ", _SRC_REF.sub("", o)).strip() if not o.startswith("http") else o
    if isinstance(o, list):
        return [_scrub(x) for x in o]
    if isinstance(o, dict):
        return {k: _scrub(v) for k, v in o.items()}
    return o


def assemble(raw: dict, number: int, difficulty: str, seed: int, sources: list[dict]) -> tuple[dict | None, list[str]]:
    """LLM output -> full MissionPlan dict. Returns (plan, errors-for-the-LLM)."""
    errs: list[str] = []
    by_id = {s["id"]: s for s in sources}

    def src(ref: Any) -> dict | None:
        return by_id.get(str(ref))

    facts, keep = [], {}
    for i, f in enumerate(raw.get("facts") or [], 1):
        s = src(f.get("source")) if isinstance(f, dict) else None
        if not s:
            errs.append(f"facts[{i - 1}].source must be one of {sorted(by_id)}")
            continue
        text = str(f.get("text", "")).strip()
        if not fact_supported(text, f"{s['title']} {s['snippet']}"):
            errs.append(f"facts[{i - 1}] is not supported by source {s['id']}: only restate what that source says, no new numbers")
            continue
        fid = f"f{i}"
        keep[fid] = True
        facts.append({"id": fid, "text": text, "source_url": s["link"], "source_name": s["source"] or "News", "verified": True})
    if len(facts) < 2:
        errs.append("need at least 2 facts supported by the sources")

    ins = src((raw.get("inspired_by") or {}).get("source"))
    if not ins and facts:
        ins = next((s for s in sources if s["link"] == facts[0]["source_url"]), None)
    if not ins:
        errs.append("inspired_by.source must be a source id")
    if errs and (len(facts) < 2 or not ins):
        return None, errs

    def fid_ok(x: Any) -> str | None:
        return x if isinstance(x, str) and x in keep else None

    sw = raw.get("site_why") or []
    sites = [{**s, "why": str(sw[i]).strip() if i < len(sw) and str(sw[i]).strip() else SITE_HINTS[s["id"]].split(": ", 1)[-1]}
             for i, s in enumerate(LOCKED_SITES)]

    ck = raw.get("checklist") or {}
    items = []
    for it in ck.get("items") or []:
        if not isinstance(it, dict):
            continue
        d = {"prompt": str(it.get("prompt", "")).strip(), "answer": str(it.get("answer", "")).strip()}
        if it.get("options"):
            d["options"] = [str(o) for o in it["options"]]
        if fid_ok(it.get("fact_id")):
            d["fact_id"] = it["fact_id"]
        items.append(d)

    lo, hi = HURDLE_RANGE[difficulty]
    cruise = []
    for h in (raw.get("cruise") or [])[:hi]:
        if not isinstance(h, dict):
            continue
        d = {"type": h.get("type"), "role": h.get("role"), "difficulty": h.get("difficulty") if h.get("difficulty") in (1, 2, 3) else 1,
             "story": str(h.get("story", "")).strip()}
        if fid_ok(h.get("fact_id")):
            d["fact_id"] = h["fact_id"]
        cruise.append(d)

    sf = raw.get("surface") or {}
    tasks = []
    for t in sf.get("tasks") or []:
        if isinstance(t, dict):
            d = {k: t.get(k) for k in ("id", "role", "type", "title", "hint")}
            if t.get("unlocks"):
                d["unlocks"] = t["unlocks"]
            tasks.append(d)

    shp = raw.get("ship") or {}

    def num(k: str, lo_: float, hi_: float, default: float) -> float:
        try:
            return float(min(hi_, max(lo_, float(shp.get(k, default)))))
        except (TypeError, ValueError):
            return default

    pay = [str(p) for p in (shp.get("required_payload") or [])][:3] or ["science_instruments"]
    suffix = re.sub(r"^Apollo \d+:?\s*", "", str(raw.get("title_suffix", "")).strip()).strip(" :") or "Return to the Moon"
    voice = [{"id": str(v.get("id")), "text": str(v.get("text", "")).strip()} for v in raw.get("voice_lines") or [] if isinstance(v, dict)]
    have = {v["id"] for v in voice}
    default_voice = {
        "brief_1": f"Apollo {number}, this is Houston. {str((raw.get('goal') or {}).get('text', 'Your target is the lunar south pole.')).rstrip('.')}. Good luck.",
        "launch_1": f"All stations report go. Apollo {number}, you are clear for launch.",
        "landing_1": f"Apollo {number}, choose your landing site carefully. The terrain at the pole is rough.",
        "success_1": f"Apollo {number}, Houston. Mission complete. Well done, crew.",
    }
    voice += [{"id": k, "text": t} for k, t in default_voice.items() if k not in have]

    plan = {
        "id": f"apollo-{number}",
        "number": number,
        "seed": seed,
        "difficulty": difficulty,
        "title": f"Apollo {number}: {suffix}",
        "tagline": str(raw.get("tagline", "")).strip(),
        "goal": {"text": str((raw.get("goal") or {}).get("text", "")).strip(), "why": str((raw.get("goal") or {}).get("why", "")).strip()},
        "inspired_by": {k: v for k, v in {"name": (f"{ins['source']}: {ins['title']}" if ins["source"] else ins["title"])[:140], "source_url": ins["link"], "date": ins["date"] or None}.items() if v},
        "facts": facts,
        "destination": {"body": "moon", "region": "south_pole", "region_name": "Lunar South Pole", "candidate_sites": sites},
        "ship": {
            "slots": ["engine", "power", "payload", "legs", "comms"],
            "constraints": {
                "max_mass_kg": num("max_mass_kg", 900, 3000, 1500),
                "min_battery_hours": num("min_battery_hours", 24, 120, 50),
                "min_delta_v": num("min_delta_v", 1800, 3300, 2400),
                "required_payload": pay,
            },
            "rationale": str(shp.get("rationale", "")).strip(),
        },
        "crew": {"min": 1, "max": 4, "roles": list(ROLES)},
        "checklist": {"style": ck.get("style"), "items": items},
        "cruise": cruise,
        "surface": {"tasks": tasks, "final": sf.get("final")},
        "voice_lines": voice,
    }
    # pad missing hurdles instead of failing the whole plan on a count slip
    if len(plan["cruise"]) < lo:
        used = {h["type"] for h in plan["cruise"]}
        for g in GENERIC_HURDLES:
            if len(plan["cruise"]) >= lo:
                break
            if g["type"] not in used:
                plan["cruise"].append(copy.deepcopy(g))
    plan = _scrub(plan)
    plan["ship"]["constraints"] = make_feasible(plan["ship"]["constraints"])
    return plan, validation_errors(plan)


async def generate(difficulty: str, seed: int | None = None, topic_key: str | None = None, number: int | None = None, background: bool = False) -> dict:
    """Generate one live mission entry. Raises on failure (callers fall back)."""
    seed = seed if seed is not None else random.randrange(1, 2**31)
    rng = random.Random(seed)
    topic = next((t for t in TOPICS if t[0] == topic_key), None) or rng.choice(TOPICS)
    style = rng.choice(list(CHECKLIST_GUIDE))
    sources = await gather_sources(topic, rng)
    if len(sources) < 2:
        raise RuntimeError("not enough live sources")
    number = number or next_number()
    image = await nasa.image_for(topic[2], rng)

    prompt = _user_prompt(number, difficulty, style, topic, sources, seed)
    errors: list[str] = []
    raw: dict = {}
    for attempt in (1, 2):
        if attempt == 2:
            prompt += ("\n\nYour previous JSON was rejected:\n- " + "\n- ".join(errors[:12]) +
                       "\nPrevious JSON:\n" + json.dumps(raw)[:6000] + "\nReturn the corrected, complete JSON object.")
        raw = await llm.complete_json(SYSTEM, prompt, timeout=150, background=background)
        plan, errors = assemble(raw, number, difficulty, seed, sources)
        if plan and not errors:
            MissionPlan.model_validate(plan)
            entry = {"plan": plan, "image": image, "kind": "live", "topic": topic[0], "created": time.time()}
            register(entry)
            return entry
        log.warning("plan attempt %d rejected: %s", attempt, errors[:4])
    raise RuntimeError(f"plan failed validation twice: {errors[:4]}")


async def generate_or_fallback(difficulty: str, seed: int | None = None, avoid: set[str] | None = None) -> dict:
    try:
        return await generate(difficulty, seed)
    except Exception as e:  # noqa: BLE001 - any failure must degrade to a playable plan
        log.warning("generation failed (%s), using fallback", e)
        entry = fallback_entry(difficulty, avoid)
        register(entry)
        return entry


# ---------------------------------------------------------------- pool


class Pool:
    """POOL_SIZE ready live missions per difficulty, persisted on disk, refilled in the background."""

    def __init__(self) -> None:
        self.ready: dict[str, list[dict]] = {d: list(cache.get("pool", d) or []) for d in DIFFICULTIES}
        for lst in self.ready.values():  # plans saved before a catalog change must stay winnable
            for e in lst:
                e["plan"]["ship"]["constraints"] = make_feasible(e["plan"]["ship"]["constraints"])
                locked = {x["id"]: x for x in LOCKED_SITES}
                for site in e["plan"]["destination"]["candidate_sites"]:
                    site.update({k: locked[site["id"]][k] for k in ("name", "lat", "lon")} if site["id"] in locked else {})
        self._task: asyncio.Task | None = None
        self.fallbacks: dict[str, list[dict]] = {d: [] for d in DIFFICULTIES}  # stable until chosen/refreshed
        self.busy: dict[str, int] = {d: 0 for d in DIFFICULTIES}
        self.last_error: str | None = None
        self.gen_seconds: list[float] = []

    def _save(self, d: str) -> None:
        cache.put("pool", d, self.ready[d])

    def count(self) -> int:
        return sum(len(v) for v in self.ready.values())

    def cards(self, difficulty: str, n: int = 3) -> list[dict]:
        out = list(self.ready[difficulty][:n])
        fbs = self.fallbacks[difficulty]
        avoid = {e["plan"]["inspired_by"]["source_url"] for e in out}
        i = 0
        while len(out) < n:
            if i >= len(fbs):
                e = fallback_entry(difficulty, avoid | {f["plan"]["inspired_by"]["source_url"] for f in fbs})
                register(e)
                fbs.append(e)
            out.append(fbs[i])
            avoid.add(fbs[i]["plan"]["inspired_by"]["source_url"])
            i += 1
        return out

    def consume(self, plan_id: str) -> bool:
        for d in DIFFICULTIES:
            for lst in (self.ready[d], self.fallbacks[d]):
                for e in lst:
                    if e["plan"]["id"] == plan_id:
                        lst.remove(e)
                        if lst is self.ready[d]:
                            self._save(d)
                            self.kick()
                        return True
        return False

    def drop_shown(self, difficulty: str, n: int = 3) -> None:
        """'Show me other missions': retire the cards currently shown."""
        del self.ready[difficulty][:n]
        self.fallbacks[difficulty].clear()
        self._save(difficulty)
        self.kick()

    def pop_one(self, difficulty: str) -> dict | None:
        if self.ready[difficulty]:
            e = self.ready[difficulty].pop(0)
            self._save(difficulty)
            self.kick()
            return e
        self.kick()
        return None

    def kick(self) -> None:
        if self._task is None or self._task.done():
            self._task = asyncio.create_task(self._fill())

    def status(self) -> dict:
        return {
            "ready": {d: len(v) for d, v in self.ready.items()},
            "generating": dict(self.busy),
            "last_error": self.last_error,
            "avg_gen_seconds": round(sum(self.gen_seconds) / len(self.gen_seconds), 1) if self.gen_seconds else None,
        }

    async def _one(self, d: str) -> None:
        t0 = time.time()
        self.busy[d] += 1
        try:
            have = {e["topic"] for e in self.ready[d]}
            topics = [t[0] for t in TOPICS if t[0] not in have] or [t[0] for t in TOPICS]
            llm.gate.bg_limit = 2 if self.count() < POOL_SIZE else 1  # cold start: use both slots
            e = await generate(d, topic_key=random.choice(topics), background=True)
            urls = {x["plan"]["inspired_by"]["source_url"] for x in self.ready[d]}
            if e["plan"]["inspired_by"]["source_url"] not in urls:
                self.ready[d].append(e)
                self._save(d)
            self.gen_seconds.append(time.time() - t0)
            self.last_error = None
        except Exception as ex:  # noqa: BLE001
            self.last_error = str(ex)[:200]
            log.warning("pool generation failed: %s", ex)
            await asyncio.sleep(20)  # back off so a dead network/LLM does not spin
        finally:
            self.busy[d] -= 1

    async def _fill(self) -> None:
        failures = 0
        while True:
            need = [d for d in DIFFICULTIES if len(self.ready[d]) + self.busy[d] < POOL_SIZE]
            if not need:
                return
            workers = 2 if self.count() < POOL_SIZE else 1
            batch = []
            for d in need:
                short = POOL_SIZE - len(self.ready[d]) - self.busy[d]
                batch += [d] * short
            before = self.count()
            await asyncio.gather(*(self._one(d) for d in batch[:workers]))
            failures = failures + 1 if self.count() == before else 0
            if failures >= 3:  # give up until the next kick
                return


pool = Pool()
