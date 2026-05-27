"""Optional Prometheus metrics. Safely degrades when dependency is absent."""
from __future__ import annotations

import logging
from collections.abc import Iterator
from contextlib import contextmanager
from time import perf_counter
from typing import Any

logger = logging.getLogger(__name__)

try:  # pragma: no cover - optional dependency path
    from prometheus_client import Counter, Histogram, start_http_server

    _ENABLED = True
except ImportError:  # pragma: no cover - default in minimal installs
    _ENABLED = False


class _NoOp:
    def labels(self, *args: Any, **kwargs: Any) -> "_NoOp":
        return self

    def inc(self, *args: Any, **kwargs: Any) -> None:
        return None

    def observe(self, *args: Any, **kwargs: Any) -> None:
        return None


if _ENABLED:  # pragma: no cover
    ITERATIONS = Counter("agent_iterations_total", "Total agent iterations")
    ANALYSES = Counter("agent_analyses_total", "Total analyses", ["result"])
    PATCHES = Counter("agent_patches_total", "Total patches", ["outcome"])
    TESTS = Counter("agent_tests_total", "Total test runs", ["passed"])
    REVIEWS = Counter("agent_reviews_total", "Total reviews", ["verdict"])
    LLM_CALLS = Counter("agent_llm_calls_total", "LLM API calls", ["backend", "outcome"])
    LLM_LATENCY = Histogram("agent_llm_latency_seconds", "LLM call latency", ["backend"])
    ITERATION_DURATION = Histogram("agent_iteration_seconds", "Iteration duration")
else:
    ITERATIONS = ANALYSES = PATCHES = TESTS = REVIEWS = LLM_CALLS = _NoOp()
    LLM_LATENCY = ITERATION_DURATION = _NoOp()


def start_server(port: int) -> None:
    if not _ENABLED:
        logger.warning("prometheus_client not installed; metrics server disabled")
        return
    start_http_server(port)  # type: ignore[possibly-undefined]
    logger.info("metrics server started", extra={"port": port})


@contextmanager
def time_block(histogram: Any, **labels: str) -> Iterator[None]:
    start = perf_counter()
    try:
        yield
    finally:
        metric = histogram.labels(**labels) if labels else histogram
        metric.observe(perf_counter() - start)
