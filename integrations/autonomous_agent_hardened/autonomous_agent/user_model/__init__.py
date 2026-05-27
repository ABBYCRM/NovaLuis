"""User-understanding layer for agentic response planning.

This package is intentionally non-clinical. It turns user-provided preference,
communication, family-system, and self-regulation signals into bounded response
strategy metadata for the coding agent. It must not diagnose, label, or infer
protected traits beyond what the user explicitly provided.
"""
from .engine import UserUnderstandingEngine
from .models import UserUnderstandingResult, UserSignal, UserOpsProfile

__all__ = ["UserUnderstandingEngine", "UserUnderstandingResult", "UserSignal", "UserOpsProfile"]
