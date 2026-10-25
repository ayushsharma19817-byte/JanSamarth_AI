
from pathlib import Path
import json
import re
from typing import Any

from fastapi import FastAPI
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

ROOT = Path(__file__).resolve().parent.parent
DATA_PATH = ROOT / "data" / "schemes.json"
WEB_PATH = ROOT / "web"

app = FastAPI(
    title="JanSamarth AI",
    description="Open-source prototype for discovering public schemes. Results are informational, not official eligibility decisions.",
    version="0.1.0",
)

app.mount("/static", StaticFiles(directory=WEB_PATH), name="static")


def load_schemes() -> list[dict[str, Any]]:
    with DATA_PATH.open("r", encoding="utf-8") as f:
        return json.load(f)


SCHEMES = load_schemes()


class CitizenProfile(BaseModel):
    age: int = Field(ge=0, le=120)
    state: str = Field(min_length=2, max_length=80)
    annual_income: float = Field(ge=0)
    category: str = Field(min_length=1, max_length=80)
    occupation: str = Field(min_length=1, max_length=100)
    query: str = Field(default="", max_length=500)


def normalized(value: str) -> str:
    return re.sub(r"\s+", " ", value.strip().lower())


def evaluate_scheme(scheme: dict[str, Any], profile: CitizenProfile) -> dict[str, Any]:
    """Apply transparent demo rules. Unknown requirements are never treated as confirmed eligibility."""
    rules = scheme.get("eligibility", {})
    reasons = []
    checks = []

    def check(label: str, passed: bool | None, detail: str):
        checks.append({"label": label, "passed": passed, "detail": detail})
        if passed is False:
            reasons.append(detail)

    age_min = rules.get("age_min")
    age_max = rules.get("age_max")
    if age_min is not None:
        check("Age", profile.age >= age_min, f"Minimum age is {age_min}.")
    if age_max is not None:
        check("Age", profile.age <= age_max, f"Maximum age is {age_max}.")
    income_max = rules.get("annual_income_max")
    if income_max is not None:
        check("Annual income", profile.annual_income <= income_max,
              f"Annual household income limit is ₹{income_max:,.0f}.")
    states = rules.get("states")
    if states:
        state_match = normalized(profile.state) in {normalized(s) for s in states}
        check("State", state_match, "This sample record is limited to: " + ", ".join(states) + ".")
    categories = rules.get("categories")
    if categories and "any" not in [normalized(c) for c in categories]:
        category_match = normalized(profile.category) in {normalized(c) for c in categories}
        check("Category", category_match, "Category requirement: " + ", ".join(categories) + ".")
    occupations = rules.get("occupations")
    if occupations and "any" not in [normalized(o) for o in occupations]:
        occupation_match = normalized(profile.occupation) in {normalized(o) for o in occupations}
        check("Occupation", occupation_match, "Occupation requirement: " + ", ".join(occupations) + ".")

    # A demo profile can match the configured fields, but scheme-specific documents and
    # other official conditions may still apply. Never label this as guaranteed eligibility.
    matched = not reasons
    status = "Potential match — verify official conditions" if matched else "May not match the sample rules"
    return {
        "id": scheme["id"],
        "name": scheme["name"],
        "department": scheme.get("department", "Not specified"),
        "summary": scheme["summary"],
        "status": status,
        "matched_sample_rules": matched,
        "checks": checks,
        "documents": scheme.get("documents", []),
        "application_url": scheme.get("application_url", ""),
        "official_source": scheme.get("official_source", ""),
        "last_verified": scheme.get("last_verified", "Not verified"),
        "disclaimer": scheme.get("disclaimer", "Confirm all requirements with the official department."),
    }


def relevance_score(scheme: dict[str, Any], query: str) -> int:
    """Simple transparent baseline search. Can later be replaced with embeddings/RAG."""
    if not query.strip():
        return 0
    haystack = normalized(" ".join([
        scheme.get("name", ""),
        scheme.get("summary", ""),
        scheme.get("department", ""),
        " ".join(scheme.get("keywords", [])),
        " ".join(scheme.get("documents", [])),
    ]))
    terms = [t for t in re.findall(r"[a-zA-Z0-9₹]+", normalized(query)) if len(t) > 2]
    return sum(1 for term in terms if term in haystack)


@app.get("/")
def home():
    return FileResponse(WEB_PATH / "index.html")


@app.get("/api/health")
def health():
    return {"status": "ok", "project": "JanSamarth AI", "scheme_records": len(SCHEMES)}


@app.get("/api/schemes")
def list_schemes():
    return [
        {
            "id": s["id"], "name": s["name"], "summary": s["summary"],
            "department": s.get("department", ""),
            "official_source": s.get("official_source", ""),
            "application_url": s.get("application_url", ""),
            "last_verified": s.get("last_verified", "Not verified"),
        }
        for s in SCHEMES
    ]


@app.post("/api/check-eligibility")
def check_eligibility(profile: CitizenProfile):
    results = [evaluate_scheme(s, profile) for s in SCHEMES]
    query = normalized(profile.query)
    if query:
        for item, scheme in zip(results, SCHEMES):
            item["relevance_score"] = relevance_score(scheme, query)
        results.sort(key=lambda item: (item["relevance_score"], item["matched_sample_rules"]), reverse=True)
    else:
        results.sort(key=lambda item: item["matched_sample_rules"], reverse=True)
    return {
        "count": len(results),
        "potential_matches": sum(1 for item in results if item["matched_sample_rules"]),
        "results": results,
        "notice": "Prototype only. These sample rules do not establish legal eligibility. Confirm details on the official scheme website or with the relevant department.",
    }
