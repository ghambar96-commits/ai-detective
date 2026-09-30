#!/usr/bin/env python3
"""AIDetective — minimal REST client (Python 3.9+, dependency: ``requests`` only).

Environment:
    AIDETECTIVE_URL       base URL of your AIDetective instance
                          (default: http://localhost:3000)
    AIDETECTIVE_API_KEY   API key, only needed when the server requires one
                          (sent as "Authorization: Bearer <key>")

Usage:
    python examples/aidetective_client.py text "Some suspiciously fluent prose…"
    python examples/aidetective_client.py file ./document.pdf

Disclaimer: AIDetective provides a PROBABILISTIC analysis. Its output is NOT
proof of authorship or origin and can produce false positives and false
negatives. Never use it as sole evidence for accusations or decisions.
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import time
from typing import Any, Dict, List, Optional

import requests

DEFAULT_URL = "http://localhost:3000"
POLL_INTERVAL_SECS = 1.0
POLL_TIMEOUT_SECS = 300.0
INCOMPLETE = ("queued", "processing")


class AIDetectiveError(RuntimeError):
    """Raised when the API returns a structured error envelope."""


def _base_url() -> str:
    return os.environ.get("AIDETECTIVE_URL", DEFAULT_URL).rstrip("/")


def _headers() -> Dict[str, str]:
    key = os.environ.get("AIDETECTIVE_API_KEY", "").strip()
    return {"Authorization": f"Bearer {key}"} if key else {}


def _unwrap(resp: requests.Response) -> Dict[str, Any]:
    """Validate the unified envelope {ok, data | error} and return `data`."""
    try:
        payload = resp.json()
    except ValueError as exc:
        raise AIDetectiveError(f"HTTP {resp.status_code}: non-JSON response") from exc
    if payload.get("ok") is True:
        data = payload.get("data")
        return data if isinstance(data, dict) else {}
    error = payload.get("error") or {}
    raise AIDetectiveError(
        f"HTTP {resp.status_code} {error.get('code', 'UNKNOWN')}: "
        f"{error.get('message', 'unknown error')}"
    )


def analyze_text(text: str, use_llm: bool = False, timeout: float = 60.0) -> Dict[str, Any]:
    """Analyze inline text synchronously via POST /api/v1/analyze."""
    resp = requests.post(
        f"{_base_url()}/api/v1/analyze",
        json={"content": text, "options": {"useLlm": use_llm}},
        headers=_headers(),
        timeout=timeout,
    )
    return _unwrap(resp)


def analyze_file(path: str, use_llm: bool = False, poll_timeout: float = POLL_TIMEOUT_SECS) -> Dict[str, Any]:
    """Upload a file (POST /api/v1/analyze/file → 202) and poll until completed/failed."""
    with open(path, "rb") as handle:
        resp = requests.post(
            f"{_base_url()}/api/v1/analyze/file",
            files={"file": (os.path.basename(path), handle)},
            data={"options": json.dumps({"useLlm": use_llm})},
            headers=_headers(),
            timeout=max(poll_timeout, 60.0),
        )
    detail = _unwrap(resp)
    analysis_id: Optional[str] = detail.get("id")
    if not analysis_id:
        raise AIDetectiveError("Server did not return an analysis id")
    deadline = time.monotonic() + poll_timeout
    while detail.get("status") in INCOMPLETE:
        if time.monotonic() > deadline:
            raise AIDetectiveError(f"Timed out polling analysis {analysis_id}")
        time.sleep(POLL_INTERVAL_SECS)
        detail = _unwrap(requests.get(f"{_base_url()}/api/v1/analyses/{analysis_id}", headers=_headers(), timeout=30.0))
    return detail


def print_result(detail: Dict[str, Any]) -> None:
    """Print verdict, score, confidence and the strongest signals (human-readable)."""
    print(f"Analysis    : {detail.get('id', 'n/a')}")
    print(f"Modality    : {detail.get('modality', 'n/a')}   status: {detail.get('status', 'n/a')}")
    print(f"Verdict     : {detail.get('classification') or 'n/a'}")
    score = detail.get("likelihoodScore")
    if isinstance(score, (int, float)):
        print(f"Score       : {score:.3f}  (0 = human … 1 = AI; a probability estimate, NOT proof)")
    confidence = detail.get("confidence")
    if isinstance(confidence, (int, float)):
        print(f"Confidence  : {confidence:.3f}  (hard-capped below 1.0 by design)")
    signals: List[Dict[str, Any]] = [s for s in detail.get("signals") or [] if s.get("aiScore") is not None]
    signals.sort(key=lambda s: abs(float(s["aiScore"]) * 2 - 1) * float(s.get("weight") or 0.0), reverse=True)
    if signals:
        print("Top signals :")
        for s in signals[:3]:
            print(f"  • {s.get('name')} [{s.get('detectorId')}] aiScore={s.get('aiScore')} "
                  f"weight={s.get('weight')} → {s.get('direction')}")
    for warning in detail.get("warnings") or []:
        print(f"Warning     : {warning}")
    for error in detail.get("errors") or []:
        print(f"Error       : {error}", file=sys.stderr)
    print("⚠️  Reminder: this is a probabilistic estimate, not proof. "
          "False positives and false negatives are possible — always apply human review.")


def main() -> int:
    parser = argparse.ArgumentParser(description="AIDetective example client (see module docstring for the disclaimer).")
    sub = parser.add_subparsers(dest="command", required=True)
    p_text = sub.add_parser("text", help="analyze inline text (synchronous)")
    p_text.add_argument("content", help="text to analyze")
    p_file = sub.add_parser("file", help="analyze a local file (queued; polls until done)")
    p_file.add_argument("path", help="path to txt/md/pdf/docx/png/jpg/webp/wav/mp3/flac/m4a")
    args = parser.parse_args()
    try:
        detail = analyze_text(args.content) if args.command == "text" else analyze_file(args.path)
    except (AIDetectiveError, requests.RequestException, OSError) as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 1
    print_result(detail)
    return 0 if detail.get("status") == "completed" else 2


if __name__ == "__main__":
    sys.exit(main())
