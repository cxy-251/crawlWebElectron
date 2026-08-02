from __future__ import annotations

import hashlib
import json
import re
from typing import Any

from safari_rpa.contracts.runtime import JsonObject


def matcher_fingerprint(search: JsonObject, criteria: JsonObject) -> str:
    payload = {
        "directions": search.get("directions", {}),
        "keyword_rules": search.get("keyword_rules", {}),
        "criteria": criteria,
        "version": 1,
    }
    encoded = json.dumps(payload, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(encoded.encode("utf-8")).hexdigest()[:16]


def resolve_keyword_rule(search: JsonObject, keyword: str) -> JsonObject:
    keyword_rules = search.get("keyword_rules", {})
    configured = keyword_rules.get(keyword) if isinstance(keyword_rules, dict) else None
    if not isinstance(configured, dict):
        return {}
    direction_name = str(configured.get("direction") or "")
    directions = search.get("directions", {})
    direction = directions.get(direction_name) if isinstance(directions, dict) else None
    merged = dict(direction) if isinstance(direction, dict) else {}
    for key, value in configured.items():
        if key in {"title_any", "jd_core_any", "jd_support_any", "deny_any"}:
            inherited = merged.get(key, [])
            inherited_values = inherited if isinstance(inherited, list) else []
            values = value if isinstance(value, list) else []
            merged[key] = list(dict.fromkeys([*inherited_values, *values]))
        else:
            merged[key] = value
    merged["direction"] = direction_name
    merged["keyword"] = keyword
    return merged


def match_search_card(job: JsonObject, criteria: JsonObject, rule: JsonObject) -> JsonObject:
    reasons = _common_reasons(job, criteria, include_hr=False)
    title = str(job.get("title") or "")
    title_allow = _terms(criteria.get("title_allow"))
    direction_titles = _terms(rule.get("title_any"))
    direction_matched = any(term.casefold() in title.casefold() for term in direction_titles)
    if title_allow or direction_titles:
        normalized = title.casefold()
        if not any(term.casefold() in normalized for term in [*title_allow, *direction_titles]):
            reasons.append(f"title_not_software:{title or 'unknown'}")
    if bool(rule.get("require_direction_title")) and direction_titles and not direction_matched:
        reasons.append(f"direction_title_not_matched:{rule.get('keyword') or 'unknown'}")
    return {
        "matched": not reasons,
        "stage": "search_card",
        "reasons": reasons,
        "keyword": str(rule.get("keyword") or ""),
        "direction": str(rule.get("direction") or ""),
    }


def match_job_detail(
    job: JsonObject,
    criteria: JsonObject,
    rule: JsonObject,
) -> JsonObject:
    reasons = _common_reasons(job, criteria, include_hr=True)
    title = str(job.get("title") or "")
    jd = str(job.get("jd") or "")
    title_allow = _terms(criteria.get("title_allow"))
    direction_titles = _terms(rule.get("title_any"))
    normalized_title = title.casefold()
    if title_allow or direction_titles:
        if not any(term.casefold() in normalized_title for term in [*title_allow, *direction_titles]):
            reasons.append(f"title_not_software:{title or 'unknown'}")

    score = 0
    title_hits: list[str] = []
    core_hits: list[str] = []
    support_hits: list[str] = []
    denied_hits: list[str] = []
    if rule:
        searchable = f"{title}\n{jd}".casefold()
        title_hits = _hits(title, rule.get("title_any"))
        core_hits = _hits(jd, rule.get("jd_core_any"))
        support_hits = _hits(jd, rule.get("jd_support_any"))
        denied_hits = [
            term
            for term in _terms(rule.get("deny_any"))
            if term.casefold() in searchable
        ]
        if denied_hits:
            reasons.append(f"direction_denied:{denied_hits[0]}")
        if not core_hits:
            reasons.append(f"jd_core_not_matched:{rule.get('keyword') or 'unknown'}")
        score = (2 if title_hits else 0) + (3 if core_hits else 0) + min(2, len(support_hits))
        minimum = max(1, int(rule.get("min_score", 4)))
        if core_hits and score < minimum:
            reasons.append(f"jd_relevance_below_score:{score}/{minimum}")

    return {
        "matched": not reasons,
        "stage": "job_detail",
        "reasons": reasons,
        "keyword": str(rule.get("keyword") or ""),
        "direction": str(rule.get("direction") or ""),
        "score": score,
        "title_hits": title_hits,
        "jd_core_hits": core_hits,
        "jd_support_hits": support_hits,
        "denied_hits": denied_hits,
    }


def rejection_retry_days(reasons: list[str]) -> int:
    if any(reason.startswith("hr_") for reason in reasons):
        return 7
    static_prefixes = (
        "title_",
        "experience_",
        "education_",
        "company_",
        "salary_",
        "direction_",
        "jd_",
    )
    if reasons and all(reason.startswith(static_prefixes) for reason in reasons):
        return 30
    return 1


def _common_reasons(job: JsonObject, criteria: JsonObject, *, include_hr: bool) -> list[str]:
    reasons: list[str] = []
    unknown_allowed = bool(criteria.get("allow_unknown", True))
    title = str(job.get("title") or "")
    experience = str(job.get("experience") or "")
    education = str(job.get("education") or "")
    scale = str(job.get("scale") or "")
    salary = str(job.get("salary") or "")

    if _flag(job.get("gold_hunter")):
        reasons.append("hr_title_denied:猎头")
    if _flag(job.get("proxy_job")):
        reasons.append("hr_title_denied:代招")

    denied = next(
        (
            token
            for token in _terms(criteria.get("title_deny"))
            if token.casefold() in title.casefold()
        ),
        "",
    )
    if denied:
        reasons.append(f"title_denied:{denied}")

    allowed_experience = _terms(criteria.get("experience_allow"))
    if allowed_experience and experience and experience not in allowed_experience:
        reasons.append(f"experience_not_allowed:{experience}")
    if allowed_experience and not experience and not unknown_allowed:
        reasons.append("experience_unknown")
    if education and education in _terms(criteria.get("education_deny")):
        reasons.append(f"education_denied:{education}")

    scale_max = _scale_max(scale)
    company_size_min = max(0, int(criteria.get("company_size_min", 0)))
    if scale_max is not None:
        if scale_max < company_size_min:
            reasons.append(f"company_too_small:{scale}")
    elif company_size_min and not unknown_allowed:
        reasons.append("company_size_unknown")

    salary_match = re.search(r"(\d+)-(\d+)K", salary, re.IGNORECASE)
    salary_min = max(0, int(criteria.get("salary_min_k", 0)))
    salary_max = max(0, int(criteria.get("salary_max_k", 0)))
    if salary_match:
        low, high = int(salary_match.group(1)), int(salary_match.group(2))
        if salary_min and high < salary_min:
            reasons.append(f"salary_below_range:{salary}")
        if salary_max and low > salary_max:
            reasons.append(f"salary_above_range:{salary}")
    elif (salary_min or salary_max) and not unknown_allowed:
        reasons.append("salary_unknown")

    if not include_hr:
        return reasons

    hr_active_time = str(job.get("hr_active_time") or "")
    hr_active_allow = _terms(criteria.get("hr_active_allow"))
    if hr_active_allow:
        if not hr_active_time and not bool(criteria.get("allow_unknown_hr_activity", True)):
            reasons.append("hr_active_time_unknown")
        elif hr_active_time and not any(token in hr_active_time for token in hr_active_allow):
            reasons.append(f"hr_not_active_recently:{hr_active_time}")

    hr_title = str(job.get("hr_title") or "")
    denied_hr_title = next(
        (token for token in _terms(criteria.get("hr_title_deny")) if token in hr_title),
        "",
    )
    if denied_hr_title:
        reasons.append(f"hr_title_denied:{denied_hr_title}")
    return reasons


def _scale_max(value: str) -> int | None:
    normalized = value.replace(",", "")
    if match := re.search(r"(\d+)\s*万以上人", normalized):
        return int(match.group(1)) * 10000
    if match := re.search(r"(\d+)\s*人以上", normalized):
        return int(match.group(1))
    if match := re.search(r"(\d+)\s*-\s*(\d+)\s*人", normalized):
        return int(match.group(2))
    if match := re.search(r"少于\s*(\d+)\s*人", normalized):
        return int(match.group(1))
    return None


def _hits(text: str, values: Any) -> list[str]:
    normalized = text.casefold()
    return [term for term in _terms(values) if term.casefold() in normalized]


def _terms(values: Any) -> list[str]:
    if not isinstance(values, list):
        return []
    return [str(value).strip() for value in values if str(value).strip()]


def _flag(value: Any) -> bool:
    if isinstance(value, bool):
        return value
    if isinstance(value, (int, float)):
        return value != 0
    return str(value or "").strip().casefold() in {"1", "true", "yes"}
