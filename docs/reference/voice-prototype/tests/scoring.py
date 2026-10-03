"""Scoring helpers for the Jarvis voice checks."""

from __future__ import annotations

import json
import re
import unicodedata
from pathlib import Path
from typing import Any

CASES = json.loads((Path(__file__).with_name("cases.json")).read_text(encoding="utf-8"))
MUTATING = {"create_task", "steer_task", "pause_task", "resume_task", "cancel_task"}

DANISH_HINTS = {"og", "er", "det", "på", "med", "jeg", "har", "opgaven", "den", "til", "at", "en", "af", "ikke", "nu", "kører"}
ENGLISH_HINTS = {"the", "is", "and", "has", "task", "with", "your", "currently", "running", "have"}


NUMBERS = {"et": "1", "en": "1", "to": "2", "tre": "3"}


def normalize(text: str) -> list[str]:
    text = unicodedata.normalize("NFC", text.lower())
    text = re.sub(r"\bhundrede og (et|en|to|tre)\b", lambda m: "10" + NUMBERS[m.group(1)], text)
    text = text.replace("-", " ")
    text = re.sub(r"[^\w\sæøå]", " ", text)
    return text.split()


def wer(reference: str, hypothesis: str) -> float:
    ref, hyp = normalize(reference), normalize(hypothesis)
    if not ref:
        return 0.0 if not hyp else 1.0
    previous = list(range(len(hyp) + 1))
    for i, ref_word in enumerate(ref, 1):
        current = [i] + [0] * len(hyp)
        for j, hyp_word in enumerate(hyp, 1):
            current[j] = min(previous[j] + 1, current[j - 1] + 1,
                             previous[j - 1] + (ref_word != hyp_word))
        previous = current
    return previous[-1] / len(ref)


def _matches(expect: dict[str, Any], call: dict[str, Any]) -> bool:
    if call.get("name") != expect["tool"]:
        return False
    args = call.get("arguments") or {}
    for key in ("project", "agent"):
        if key in expect and str(args.get(key, "")).lower() != expect[key].lower():
            return False
    if "task_id" in expect and str(args.get("task_id", "")).upper() != expect["task_id"]:
        return False
    if "text_any" in expect:
        text = str(args.get("text", "")).lower()
        if not any(word in text for word in expect["text_any"]):
            return False
    return True


def score_intent(case: dict[str, Any], calls: list[dict[str, Any]]) -> tuple[bool, str]:
    """A case passes when any expected alternative matches a call; `tool: null` means no action."""
    for expect in case["expect"]:
        if expect["tool"] is None:
            mutating = [call["name"] for call in calls if call.get("name") in MUTATING]
            if not mutating:
                return True, "no action, as expected"
            return False, f"unexpected action {mutating}"
        if any(_matches(expect, call) for call in calls):
            return True, f"{expect['tool']} matched"
    shown = [f"{call.get('name')}({json.dumps(call.get('arguments'), ensure_ascii=False)})" for call in calls]
    return False, "got " + (", ".join(shown) or "no tool call")


def is_danish(text: str) -> bool:
    words = set(normalize(text))
    return len(words & DANISH_HINTS) >= 2 and len(words & ENGLISH_HINTS) <= 1


def score_status(case: dict[str, Any], answer: str) -> tuple[bool, str]:
    lowered = answer.lower()
    facts = [fact for fact in case["facts_any"] if fact in lowered]
    danish = is_danish(answer)
    if danish and facts:
        return True, f"Danish; mentions {facts}"
    return False, f"danish={danish}; facts found={facts}"
