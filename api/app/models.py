"""Mission Plan contract. Mirrors web/game/types/index.ts exactly.

`MissionPlan.model_validate(data)` is the validator used on every AI-written plan.
Run `python -m app.models` (from api/) to regenerate shared/mission-plan.schema.json.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator

Role = Literal["commander", "pilot", "engineer", "scientist"]
Difficulty = Literal["easy", "normal", "hard"]
ChecklistStyle = Literal["quiz", "order_steps", "memory_match", "switch_panel"]
HurdleType = Literal["debris_field", "solar_storm", "engine_fault", "nav_correction", "comms_blackout"]
SurfaceTaskType = Literal["scan", "collect_sample", "deploy_relay", "repair", "navigate_to"]
ShipSlot = Literal["engine", "power", "payload", "legs", "comms"]

ROLES: list[str] = ["commander", "pilot", "engineer", "scientist"]
HURDLE_TYPES: list[str] = ["debris_field", "solar_storm", "engine_fault", "nav_correction", "comms_blackout"]
REQUIRED_VOICE_LINES = ("brief_1", "launch_1", "landing_1", "success_1")

# Terrain for these three is built by P4: ids/names/coords are fixed in code, the AI only writes "why".
LOCKED_SITES: list[dict] = [
    {"id": "site_a", "name": "Shackleton Rim", "lat": -89.45, "lon": -137.0},
    {"id": "site_b", "name": "Connecting Ridge", "lat": -89.4, "lon": -152.0},
    {"id": "site_c", "name": "de Gerlache Rim", "lat": -88.6, "lon": -67.0},
]
HURDLE_RANGE: dict[str, tuple[int, int]] = {"easy": (2, 2), "normal": (3, 3), "hard": (4, 5)}


class _M(BaseModel):
    model_config = ConfigDict(extra="forbid")


class Fact(_M):
    id: str
    text: str = Field(min_length=10)
    source_url: str = Field(pattern=r"^https?://")
    source_name: str = Field(min_length=2)
    verified: bool


class CandidateSite(_M):
    id: str
    name: str
    lat: float
    lon: float
    why: str = Field(min_length=5)


class ChecklistItem(_M):
    prompt: str = Field(min_length=3)
    answer: str
    options: list[str] | None = None
    fact_id: str | None = None


class CruiseHurdle(_M):
    type: HurdleType
    role: Role
    difficulty: Literal[1, 2, 3]
    story: str = Field(min_length=10)
    fact_id: str | None = None


class SurfaceTask(_M):
    id: str
    role: Role
    type: SurfaceTaskType
    title: str = Field(min_length=3)
    hint: str = Field(min_length=3)
    unlocks: str | None = None


class Goal(_M):
    text: str = Field(min_length=10)
    why: str = Field(min_length=10)


class InspiredBy(_M):
    name: str = Field(min_length=2)
    source_url: str = Field(pattern=r"^https?://")
    date: str | None = None


class Destination(_M):
    body: Literal["moon"]
    region: str
    region_name: str
    candidate_sites: list[CandidateSite]


class Constraints(_M):
    max_mass_kg: float = Field(gt=0)
    min_battery_hours: float = Field(gt=0)
    min_delta_v: float = Field(gt=0)
    required_payload: list[str]


class Ship(_M):
    slots: list[ShipSlot]
    constraints: Constraints
    rationale: str = Field(min_length=10)


class Crew(_M):
    min: int = Field(ge=1, le=4)
    max: int = Field(ge=1, le=4)
    roles: list[Role]


class Checklist(_M):
    style: ChecklistStyle
    items: list[ChecklistItem] = Field(min_length=3, max_length=8)


class Surface(_M):
    tasks: list[SurfaceTask] = Field(min_length=2, max_length=5)
    final: str


class VoiceLine(_M):
    id: str
    text: str = Field(min_length=3, max_length=400)


class MissionPlan(_M):
    id: str
    number: int = Field(ge=1)
    seed: int
    difficulty: Difficulty
    title: str
    tagline: str = Field(min_length=5)
    goal: Goal
    inspired_by: InspiredBy
    facts: list[Fact] = Field(min_length=2)
    destination: Destination
    ship: Ship
    crew: Crew
    checklist: Checklist
    cruise: list[CruiseHurdle]
    surface: Surface
    voice_lines: list[VoiceLine]

    @model_validator(mode="after")
    def _cross_checks(self) -> "MissionPlan":
        errs: list[str] = []
        fact_ids = [f.id for f in self.facts]
        if len(set(fact_ids)) != len(fact_ids):
            errs.append("fact ids must be unique")
        fset = set(fact_ids)

        if self.id != f"apollo-{self.number}":
            errs.append(f'id must be "apollo-{self.number}"')
        if not self.title.startswith(f"Apollo {self.number}: "):
            errs.append(f'title must start with "Apollo {self.number}: "')

        # candidate sites are locked
        got = [(s.id, s.name, s.lat, s.lon) for s in self.destination.candidate_sites]
        want = [(s["id"], s["name"], s["lat"], s["lon"]) for s in LOCKED_SITES]
        if got != want:
            errs.append("candidate_sites must be exactly site_a, site_b, site_c with the locked names and coordinates")

        if self.crew.min > self.crew.max:
            errs.append("crew.min must be <= crew.max")
        if sorted(self.crew.roles) != sorted(ROLES):
            errs.append("crew.roles must list all four roles")

        for i, it in enumerate(self.checklist.items):
            if it.fact_id and it.fact_id not in fset:
                errs.append(f"checklist.items[{i}].fact_id {it.fact_id!r} is not a fact id")
            if self.checklist.style == "quiz":
                if not it.options or len(it.options) < 2:
                    errs.append(f"checklist.items[{i}] needs options (quiz style)")
                elif it.answer not in it.options:
                    errs.append(f"checklist.items[{i}].answer must be one of its options")

        lo, hi = HURDLE_RANGE[self.difficulty]
        if not lo <= len(self.cruise) <= hi:
            errs.append(f"{self.difficulty} needs {lo}-{hi} cruise hurdles, got {len(self.cruise)}")
        for i, h in enumerate(self.cruise):
            if h.fact_id and h.fact_id not in fset:
                errs.append(f"cruise[{i}].fact_id {h.fact_id!r} is not a fact id")

        tids = [t.id for t in self.surface.tasks]
        if len(set(tids)) != len(tids):
            errs.append("surface task ids must be unique")
        for t in self.surface.tasks:
            if t.unlocks and t.unlocks not in tids:
                errs.append(f"surface task {t.id} unlocks unknown task {t.unlocks!r}")
            if t.unlocks == t.id:
                errs.append(f"surface task {t.id} unlocks itself")
        if self.surface.final not in tids:
            errs.append(f"surface.final {self.surface.final!r} is not a task id")

        vids = {v.id for v in self.voice_lines}
        for need in REQUIRED_VOICE_LINES:
            if need not in vids:
                errs.append(f"voice_lines is missing {need}")

        if errs:
            raise ValueError("; ".join(errs))
        return self


def validate_plan(data: dict) -> MissionPlan:
    return MissionPlan.model_validate(data)


def validation_errors(data: dict) -> list[str]:
    """Flat, LLM-readable error strings (used to ask the model for a fix)."""
    from pydantic import ValidationError

    try:
        MissionPlan.model_validate(data)
    except ValidationError as e:
        out = []
        for err in e.errors():
            loc = ".".join(str(p) for p in err["loc"])
            out.append(f"{loc}: {err['msg']}".strip(": "))
        return out
    return []


SCHEMA_PATH = Path(__file__).resolve().parents[2] / "shared" / "mission-plan.schema.json"

if __name__ == "__main__":
    SCHEMA_PATH.write_text(json.dumps(MissionPlan.model_json_schema(), indent=2) + "\n")
    print("wrote", SCHEMA_PATH)
