#!/usr/bin/env python3
"""NOVA agentic research demo.

This module provides a small, honest research runtime with:
- deterministic planning;
- evidence collection from Tavily or DuckDuckGo HTML;
- optional OpenAI-compatible synthesis;
- SQLite run persistence;
- explicit success/failure reporting.

It intentionally exposes operational events rather than hidden chain-of-thought.
"""

from __future__ import annotations

import argparse
import datetime as dt
import json
import os
import sqlite3
import sys
import urllib.error
import urllib.parse
import urllib.request
import uuid
from dataclasses import asdict, dataclass, field
from html.parser import HTMLParser
from pathlib import Path
from typing import Any


@dataclass(slots=True)
class Evidence:
    title: str
    url: str
    snippet: str = ""
    provider: str = "unknown"


@dataclass(slots=True)
class RunReport:
    run_id: str
    goal: str
    success: bool
    started_at: str
    ended_at: str
    evidence: list[dict[str, Any]] = field(default_factory=list)
    events: list[dict[str, Any]] = field(default_factory=list)
    final_output: str = ""
    error: str | None = None

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


class _DuckDuckGoParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.results: list[Evidence] = []
        self._active = False
        self._href = ""
        self._text: list[str] = []

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        attributes = dict(attrs)
        classes = set((attributes.get("class") or "").split())
        if tag == "a" and "result__a" in classes:
            self._active = True
            self._href = attributes.get("href") or ""
            self._text = []

    def handle_data(self, data: str) -> None:
        if self._active:
            self._text.append(data)

    def handle_endtag(self, tag: str) -> None:
        if tag != "a" or not self._active:
            return
        title = " ".join(self._text).strip()
        url = self._unwrap(self._href)
        if title and url:
            self.results.append(Evidence(title=title, url=url, provider="duckduckgo"))
        self._active = False
        self._href = ""
        self._text = []

    @staticmethod
    def _unwrap(url: str) -> str:
        if url.startswith("//"):
            url = "https:" + url
        parsed = urllib.parse.urlparse(url)
        values = urllib.parse.parse_qs(parsed.query).get("uddg")
        return urllib.parse.unquote(values[0]) if values else url


def _utcnow() -> str:
    return dt.datetime.now(dt.timezone.utc).isoformat()


def _request_json(url: str, payload: dict[str, Any], headers: dict[str, str] | None = None) -> Any:
    body = json.dumps(payload).encode("utf-8")
    request_headers = {"Content-Type": "application/json", "Accept": "application/json"}
    if headers:
        request_headers.update(headers)
    request = urllib.request.Request(url, data=body, headers=request_headers, method="POST")
    with urllib.request.urlopen(request, timeout=45) as response:
        return json.loads(response.read().decode("utf-8"))


def _search_tavily(query: str, limit: int) -> list[Evidence]:
    api_key = os.getenv("TAVILY_API_KEY")
    if not api_key:
        return []
    response = _request_json(
        "https://api.tavily.com/search",
        {
            "api_key": api_key,
            "query": query,
            "search_depth": "advanced",
            "max_results": limit,
            "include_answer": False,
            "include_raw_content": False,
        },
    )
    return [
        Evidence(
            title=str(item.get("title") or item.get("url") or "Untitled source"),
            url=str(item.get("url") or ""),
            snippet=str(item.get("content") or ""),
            provider="tavily",
        )
        for item in response.get("results", [])
        if item.get("url")
    ]


def _search_duckduckgo(query: str, limit: int) -> list[Evidence]:
    url = "https://html.duckduckgo.com/html/?" + urllib.parse.urlencode({"q": query})
    request = urllib.request.Request(
        url,
        headers={"User-Agent": "Mozilla/5.0 (compatible; NOVA-Agentic-Demo/1.0)"},
        method="GET",
    )
    with urllib.request.urlopen(request, timeout=30) as response:
        body = response.read().decode("utf-8", errors="replace")
    parser = _DuckDuckGoParser()
    parser.feed(body)
    parser.close()
    return parser.results[:limit]


def _synthesize(goal: str, evidence: list[Evidence]) -> str:
    api_key = os.getenv("NOVA_LLM_API_KEY") or os.getenv("OPENAI_API_KEY")
    if not api_key:
        lines = [f"# Research digest: {goal}", "", "No LLM was configured; this is an evidence digest.", ""]
        for index, item in enumerate(evidence, start=1):
            lines.extend([f"## {index}. {item.title}", item.snippet or "No snippet returned.", item.url, ""])
        return "\n".join(lines).strip()

    base_url = (os.getenv("NOVA_LLM_BASE_URL") or os.getenv("OPENAI_BASE_URL") or "https://api.openai.com/v1").rstrip("/")
    model = os.getenv("NOVA_LLM_MODEL") or os.getenv("OPENAI_MODEL") or "gpt-4.1-mini"
    packet = "\n\n".join(
        f"SOURCE {index}\nTitle: {item.title}\nURL: {item.url}\nSnippet: {item.snippet}"
        for index, item in enumerate(evidence, start=1)
    )
    response = _request_json(
        f"{base_url}/chat/completions",
        {
            "model": model,
            "temperature": 0.1,
            "messages": [
                {
                    "role": "system",
                    "content": "Write a concise research report grounded only in the supplied sources. Cite sources by number and clearly state uncertainty.",
                },
                {"role": "user", "content": f"Goal: {goal}\n\n{packet}"},
            ],
        },
        headers={"Authorization": f"Bearer {api_key}"},
    )
    choices = response.get("choices") or []
    content = choices[0].get("message", {}).get("content") if choices else None
    if not isinstance(content, str) or not content.strip():
        raise RuntimeError("LLM returned no usable content")
    return content.strip()


class AgenticAI:
    def __init__(self, name: str = "NOVA-Agent", memory_path: str | Path = ".nova_memory.sqlite3") -> None:
        self.name = name
        self.goal: str | None = None
        self.events: list[dict[str, Any]] = []
        self.last_report: RunReport | None = None
        self._conn = sqlite3.connect(str(memory_path))
        self._conn.execute(
            "CREATE TABLE IF NOT EXISTS runs (run_id TEXT PRIMARY KEY, goal TEXT NOT NULL, success INTEGER NOT NULL, report_json TEXT NOT NULL, created_at TEXT NOT NULL)"
        )
        self._conn.commit()

    def _emit(self, event: str, detail: str) -> None:
        self.events.append({"timestamp": _utcnow(), "event": event, "detail": detail})

    def plan(self, goal: str) -> bool:
        cleaned = " ".join(goal.split())
        if len(cleaned) < 8:
            self._emit("plan_rejected", "Goal is too short to execute safely")
            return False
        self.goal = cleaned
        self._emit("plan_created", "Research, collect evidence, synthesize, persist")
        return True

    def execute(self, max_results: int = 6) -> bool:
        if not self.goal:
            raise RuntimeError("Call plan(goal) before execute()")
        run_id = str(uuid.uuid4())
        started_at = _utcnow()
        success = False
        output = ""
        error: str | None = None
        evidence: list[Evidence] = []
        try:
            self._emit("research_started", self.goal)
            evidence = _search_tavily(self.goal, max_results)
            if not evidence:
                evidence = _search_duckduckgo(self.goal, max_results)
            if not evidence:
                raise RuntimeError("No evidence sources were returned")
            self._emit("evidence_collected", f"Collected {len(evidence)} sources")
            output = _synthesize(self.goal, evidence)
            self._emit("synthesis_completed", "Produced evidence-grounded output")
            success = True
        except (urllib.error.URLError, TimeoutError, ValueError, RuntimeError) as exc:
            error = f"{type(exc).__name__}: {exc}"
            self._emit("run_failed", error)
        ended_at = _utcnow()
        report = RunReport(
            run_id=run_id,
            goal=self.goal,
            success=success,
            started_at=started_at,
            ended_at=ended_at,
            evidence=[asdict(item) for item in evidence],
            events=list(self.events),
            final_output=output,
            error=error,
        )
        self.last_report = report
        self._conn.execute(
            "INSERT OR REPLACE INTO runs(run_id, goal, success, report_json, created_at) VALUES (?, ?, ?, ?, ?)",
            (run_id, self.goal, int(success), json.dumps(report.to_dict()), ended_at),
        )
        self._conn.commit()
        return success

    def close(self) -> None:
        self._conn.close()


def main() -> int:
    parser = argparse.ArgumentParser(description="Run the NOVA agentic research demo")
    parser.add_argument("--goal", required=True)
    parser.add_argument("--output", default="nova_report.md")
    parser.add_argument("--summary-json", default="nova_run.json")
    parser.add_argument("--max-results", type=int, default=6)
    args = parser.parse_args()

    agent = AgenticAI()
    if not agent.plan(args.goal):
        print("Goal rejected: provide a more specific research goal", file=sys.stderr)
        return 2
    success = agent.execute(max_results=max(1, min(args.max_results, 10)))
    assert agent.last_report is not None
    Path(args.output).write_text(agent.last_report.final_output or agent.last_report.error or "Run failed", encoding="utf-8")
    Path(args.summary_json).write_text(json.dumps(agent.last_report.to_dict(), indent=2), encoding="utf-8")
    agent.close()
    print(json.dumps({"success": success, "report": args.output, "summary": args.summary_json}, indent=2))
    return 0 if success else 1


if __name__ == "__main__":
    raise SystemExit(main())
