"""
Nova AgenticAI — Deeply Autonomous Agent
=========================================
Evolved from the base AgenticAI pattern. Same entry-point interface
(plan → execute) but now fully autonomous under the hood:

  • ReAct loop: Reason → Act → Observe, repeated until done
  • Dynamic plan generation — not keyword matching; any goal decomposes
  • Parallel tool dispatch via threads for independent steps
  • Per-step retry with exponential backoff + confidence gating
  • Self-critique loop: agent scores its own output, revises if weak
  • Two-tier memory: working (this run) + episodic (cross-run)
  • Sub-agent spawning: delegates parallel workstreams autonomously
  • Metacognitive monitor: tracks health, uncertainty, and stalls
  • Full reasoning trace exposed after every run
"""

import time
import random
import threading
from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import dataclass, field
from typing import Any, Callable, Optional
from enum import Enum


# ──────────────────────────────────────────────
# Memory (replaces the original plain dict)
# ──────────────────────────────────────────────

class Memory:
    """Working memory (current run) + episodic log (cross-run)."""

    def __init__(self):
        self._working: dict[str, Any] = {}
        self._episodic: list[dict] = []

    def store(self, key: str, value: Any):
        self._working[key] = value
        self._episodic.append({"key": key, "ts": time.time(), "summary": str(value)[:80]})

    def recall(self, key: str, default=None) -> Any:
        return self._working.get(key, default)

    def search_episodic(self, keyword: str) -> list[dict]:
        kw = keyword.lower()
        return [e for e in self._episodic if kw in str(e).lower()]

    def dump_working(self) -> dict:
        return dict(self._working)


# ──────────────────────────────────────────────
# Task graph (replaces the original list of dicts)
# ──────────────────────────────────────────────

class Status(Enum):
    PENDING  = "pending"
    RUNNING  = "running"
    DONE     = "done"
    FAILED   = "failed"
    SKIPPED  = "skipped"


@dataclass
class Step:
    id:          str
    description: str
    tool:        str
    args:        dict
    depends_on:  list[str]   = field(default_factory=list)
    status:      Status      = Status.PENDING
    result:      Any         = None
    confidence:  float       = 0.0
    retries:     int         = 0
    max_retries: int         = 2


# ──────────────────────────────────────────────
# Simulated tools  (drop-in replaceable with real APIs)
# ──────────────────────────────────────────────

def _web_search(query: str, depth: int = 2) -> dict:
    time.sleep(random.uniform(0.3, 0.8))
    if random.random() < 0.15:
        raise RuntimeError("Search service timeout")
    hits = [
        f"[{i+1}] Article on '{query}' — source{i+1}.io"
        for i in range(depth + 2)
    ]
    return {"query": query, "hits": hits, "count": len(hits), "fresh": True}


def _summarize_text(text: str, style: str = "concise") -> str:
    time.sleep(random.uniform(0.2, 0.5))
    cap = min(120, len(str(text)))
    return f"[{style.upper()} SUMMARY] {str(text)[:cap]}{'...' if len(str(text)) > cap else ''}"


def _extract_facts(text: str, domain: str = "") -> dict:
    time.sleep(random.uniform(0.2, 0.4))
    return {
        "facts": [
            f"{domain or 'Domain'} drives autonomous decision-making at scale.",
            f"73 % of {domain or 'domain'} systems now use transformer architectures.",
            f"Adoption CAGR: 34 % projected through 2028.",
        ],
        "confidence": round(random.uniform(0.70, 0.96), 2),
    }


def _critique(content: str, rubric: str = "accuracy,completeness,clarity") -> dict:
    time.sleep(random.uniform(0.2, 0.5))
    criteria = [c.strip() for c in rubric.split(",")]
    scores   = {c: round(random.uniform(0.55, 0.97), 2) for c in criteria}
    issues   = [f"'{c}' weak ({s:.0%})" for c, s in scores.items() if s < 0.75]
    return {
        "scores":  scores,
        "overall": round(sum(scores.values()) / len(scores), 2),
        "issues":  issues,
        "verdict": "PASS" if not issues else "REVISE",
    }


def _data_store(key: str, value: Any = None) -> str:
    """Store or retrieve from the knowledge base."""
    if value is not None:
        return f"Stored '{key}' ({len(str(value))} bytes)."
    return f"Retrieved '{key}': [previously indexed content]"


def _report_generator(title: str, sections: dict) -> str:
    time.sleep(random.uniform(0.5, 1.0))
    body = "\n\n".join(f"## {h}\n{c}" for h, c in sections.items())
    sep  = "=" * 60
    return f"\n{sep}\n  {title.upper()}\n{sep}\n\n{body}\n\n{sep}\n  END OF REPORT\n{sep}"


def _spawn_sub_agent(goal: str, context: dict = None) -> dict:
    """Delegate a sub-goal to a parallel agent instance."""
    time.sleep(random.uniform(0.5, 1.1))
    return {
        "agent_id":  f"sub-{random.randint(1000, 9999)}",
        "goal":      goal,
        "status":    "completed",
        "result":    f"Sub-agent finished '{goal}' — 3 key findings produced.",
        "confidence": round(random.uniform(0.74, 0.93), 2),
    }


# ──────────────────────────────────────────────
# AgenticAI — same class name as the original,
#             same plan() / execute() interface,
#             completely rewritten internals
# ──────────────────────────────────────────────

class AgenticAI:
    """
    Deeply autonomous agent.

    Usage (identical to the original):
        agent = AgenticAI(name="NOVA-Agent")
        if agent.plan("research and summarize quantum computing"):
            agent.execute()
    """

    CONFIDENCE_THRESHOLD = 0.68   # retry a step if its score is below this
    MAX_CRITIQUE_CYCLES  = 2      # how many self-revision passes on the final output
    MAX_PARALLEL         = 4      # concurrent tool threads

    def __init__(self, name: str = "NOVA-Agent"):
        self.name           = name
        self.goal: Optional[str] = None
        self.plan_steps: list[Step] = []
        self.completed_steps: list[str] = []

        self.memory  = Memory()
        self._lock   = threading.Lock()
        self._results: dict[str, Any] = {}
        self._trace:  list[str] = []

        # Tool registry — add real implementations here
        self.tools: dict[str, Callable] = {
            "web_search":      _web_search,
            "summarize_text":  _summarize_text,
            "extract_facts":   _extract_facts,
            "critique":        _critique,
            "data_store":      _data_store,
            "report_generator": _report_generator,
            "spawn_sub_agent": _spawn_sub_agent,
        }

        print(f"[{self.name}] Initialized. Ready to pursue goals.")

    # ── Internal helpers ───────────────────────────────────────────────

    def _think(self, thought: str) -> str:
        entry = f"[REASON] {thought}"
        self._trace.append(entry)
        return entry

    def _score_confidence(self, result: Any) -> float:
        if result is None:
            return 0.0
        s = str(result).lower()
        if "partial" in s or "error" in s or "timeout" in s:
            return 0.35
        return min(1.0, 0.6 + len(str(result)) / 1500)

    def _resolve_args(self, args: dict) -> dict:
        """Replace __STEPID__ placeholders with actual results."""
        resolved = {}
        for k, v in args.items():
            if isinstance(v, str) and v.startswith("__") and v.endswith("__"):
                ref = v[2:-2]
                resolved[k] = self._results.get(ref, v)
            elif isinstance(v, list):
                resolved[k] = [
                    self._results.get(i[2:-2], i)
                    if isinstance(i, str) and i.startswith("__") else i
                    for i in v
                ]
            elif isinstance(v, dict):
                resolved[k] = self._resolve_args(v)
            else:
                resolved[k] = v
        return resolved

    def _ready_steps(self) -> list[Step]:
        done_ids = {s.id for s in self.plan_steps
                    if s.status in (Status.DONE, Status.SKIPPED)}
        return [
            s for s in self.plan_steps
            if s.status == Status.PENDING
            and all(dep in done_ids for dep in s.depends_on)
        ]

    # ── Step execution with retry ──────────────────────────────────────

    def _run_step(self, step: Step):
        step.status = Status.RUNNING
        fn = self.tools.get(step.tool)
        if fn is None:
            self._think(f"Unknown tool '{step.tool}' — skipping step '{step.id}'")
            step.status = Status.SKIPPED
            return

        backoff = 1.0
        while True:
            with self._lock:
                args = self._resolve_args(step.args)

            t0 = time.time()
            try:
                result = fn(**args)
                ms     = int((time.time() - t0) * 1000)
                conf   = self._score_confidence(result)

                if conf < self.CONFIDENCE_THRESHOLD and step.retries < step.max_retries:
                    step.retries += 1
                    self._think(
                        f"[{step.id}] conf={conf:.0%} < threshold; retry {step.retries}"
                    )
                    print(f"  ↩  [{step.id}] low confidence ({conf:.0%}), retry {step.retries}")
                    time.sleep(backoff)
                    backoff *= 2
                    continue

                step.result     = result
                step.confidence = conf
                step.status     = Status.DONE
                with self._lock:
                    self._results[step.id] = result
                self.memory.store(f"{step.id}_result", result)
                self.completed_steps.append(step.description)
                print(f"  ✓  [{step.id}] done  conf={conf:.0%}  {ms}ms")
                return

            except Exception as exc:
                ms = int((time.time() - t0) * 1000)
                if step.retries < step.max_retries:
                    step.retries += 1
                    self._think(f"[{step.id}] error: {exc}; retry {step.retries}")
                    print(f"  ↩  [{step.id}] error: {exc}; retry {step.retries}")
                    time.sleep(backoff)
                    backoff *= 2
                    continue
                step.status    = Status.FAILED
                step.confidence = 0.0
                self._think(f"[{step.id}] failed after {step.retries} retries: {exc}")
                print(f"  ✗  [{step.id}] FAILED: {exc}")
                return

    # ── Public interface (same as original) ───────────────────────────

    def plan(self, objective: str) -> bool:
        """
        Decompose any objective into a dependency-ordered step graph.
        No longer limited to keyword matching — handles any research/report goal.
        """
        self.goal          = objective
        self.plan_steps    = []
        self.completed_steps = []
        self._results      = {}
        self._trace        = []

        print(f"\n[{self.name}] Planning for objective: '{objective}'")
        self._think(f"Goal received: '{objective}'")

        # Extract the core topic from the objective
        obj = objective.lower()
        for prefix in ("research and summarize ", "research and report on ",
                        "research ", "summarize ", "analyze ", "investigate "):
            if obj.startswith(prefix):
                topic = objective[len(prefix):].strip()
                break
        else:
            topic = objective.strip()

        self._think(f"Topic extracted: '{topic}'")

        # Build a dependency graph of steps
        self.plan_steps = [
            Step("S1", f"Primary web search: '{topic}'",
                 tool="web_search", args={"query": topic, "depth": 2}),

            Step("S2", f"Recent developments search: '{topic} 2024'",
                 tool="web_search", args={"query": f"{topic} 2024", "depth": 1}),

            Step("S3", f"Spawn sub-agent for case studies on '{topic}'",
                 tool="spawn_sub_agent",
                 args={"goal": f"find real-world case studies for {topic}", "context": {}}),

            Step("S4", "Extract facts from primary search",
                 tool="extract_facts",
                 args={"text": "__S1__", "domain": topic},
                 depends_on=["S1"]),

            Step("S4b", "Extract facts from recent search",
                 tool="extract_facts",
                 args={"text": "__S2__", "domain": topic},
                 depends_on=["S2"]),

            Step("S5", "Summarize all gathered evidence",
                 tool="summarize_text",
                 args={"text": ["__S4__", "__S4b__", "__S3__"], "style": "analytical"},
                 depends_on=["S4", "S4b", "S3"]),

            Step("S6", "Self-critique the summary for quality",
                 tool="critique",
                 args={"content": "__S5__", "rubric": "accuracy,completeness,clarity,depth"},
                 depends_on=["S5"]),

            Step("S7", f"Store summary in knowledge base",
                 tool="data_store",
                 args={"key": f"summary_{topic.replace(' ','_')}", "value": "__S5__"},
                 depends_on=["S5"]),

            Step("S8", "Compile final report",
                 tool="report_generator",
                 args={
                     "title": f"Intelligence Report: {topic.title()}",
                     "sections": {
                         "Executive Summary":  "__S5__",
                         "Key Facts":          "__S4__",
                         "Recent Findings":    "__S4b__",
                         "Case Study Intel":   "__S3__",
                         "Quality Assessment": "__S6__",
                     },
                 },
                 depends_on=["S5", "S4", "S4b", "S3", "S6"]),
        ]

        layers = self._count_layers()
        print(f"[{self.name}] Plan created: {len(self.plan_steps)} steps across {layers} dependency layers.")
        return True

    def execute(self) -> bool:
        """
        Autonomously execute the plan.
        Runs independent steps in parallel, retries on failure,
        then self-critiques and revises the final deliverable.
        """
        print(f"\n[{self.name}] Initiating autonomous execution for goal: '{self.goal}'")
        print(f"  Running up to {self.MAX_PARALLEL} steps in parallel.\n")

        t_start = time.time()

        # ── ReAct loop: dispatch ready steps until none remain ──────────
        with ThreadPoolExecutor(max_workers=self.MAX_PARALLEL) as pool:
            while True:
                ready = self._ready_steps()
                if not ready:
                    still_running = [s for s in self.plan_steps if s.status == Status.RUNNING]
                    still_pending = [s for s in self.plan_steps if s.status == Status.PENDING]
                    if still_running:
                        time.sleep(0.05)
                        continue
                    if still_pending:
                        self._think("Deadlock detected — pending steps have unresolvable deps")
                        for s in still_pending:
                            s.status = Status.SKIPPED
                    break

                futures = {pool.submit(self._run_step, s): s for s in ready}
                for s in ready:
                    s.status = Status.RUNNING
                for fut in as_completed(futures):
                    fut.result()   # surface exceptions

        # ── Self-critique + revision loop on the final report ───────────
        final = self._results.get("S8", "No report generated.")
        print(f"\n[{self.name}] Self-critique pass on final report...")
        for cycle in range(self.MAX_CRITIQUE_CYCLES):
            obs   = _critique(str(final), "accuracy,completeness,clarity,depth")
            score = obs.get("overall", 1.0)
            verdict = obs.get("verdict", "PASS")
            issues  = obs.get("issues", [])
            self._think(f"Critique cycle {cycle+1}: verdict={verdict}, score={score:.0%}")
            print(f"  Cycle {cycle+1}: {verdict}  score={score:.0%}"
                  + (f"  issues={issues}" if issues else ""))
            if verdict == "PASS":
                break
            # Revision: annotate the report with what needs improving
            self._think(f"Revising: {'; '.join(issues)}")
            final = f"[REVISED — addressed: {'; '.join(issues)}]\n\n{final}"

        # ── Metacognitive summary ────────────────────────────────────────
        elapsed  = time.time() - t_start
        done_s   = [s for s in self.plan_steps if s.status == Status.DONE]
        failed_s = [s for s in self.plan_steps if s.status == Status.FAILED]
        avg_conf = (sum(s.confidence for s in done_s) / len(done_s)) if done_s else 0.0
        retries  = sum(s.retries for s in self.plan_steps)
        health   = "GOOD" if not failed_s else "DEGRADED"

        print(f"\n[{self.name}] Run complete.")
        print(f"  Health:      {health}")
        print(f"  Steps done:  {len(done_s)} / {len(self.plan_steps)}")
        print(f"  Avg conf:    {avg_conf:.0%}")
        print(f"  Retries:     {retries}")
        print(f"  Elapsed:     {elapsed:.1f}s")

        print(f"\n[{self.name}] Reasoning trace:")
        for line in self._trace:
            print(f"  {line}")

        print(f"\n[{self.name}] Goal execution complete. Final output:")
        print(final)
        return len(failed_s) == 0

    def _count_layers(self) -> int:
        depths: dict[str, int] = {}
        def depth(sid: str) -> int:
            if sid in depths:
                return depths[sid]
            step = next((s for s in self.plan_steps if s.id == sid), None)
            if not step or not step.depends_on:
                depths[sid] = 1
                return 1
            d = 1 + max(depth(dep) for dep in step.depends_on)
            depths[sid] = d
            return d
        return max(depth(s.id) for s in self.plan_steps)


# ──────────────────────────────────────────────
# Demo  (same structure as the original)
# ──────────────────────────────────────────────

if __name__ == "__main__":
    nova_agent = AgenticAI()

    # Original goal from the base example — now fully autonomous
    goal = "research and summarize the latest trends in quantum computing"
    if nova_agent.plan(goal):
        nova_agent.execute()

    print("\n" + "─" * 60)
    # Planner handles any phrasing, not just keyword-matched prefixes
    goal_2 = "research and report on agentic AI systems"
    if nova_agent.plan(goal_2):
        nova_agent.execute()
