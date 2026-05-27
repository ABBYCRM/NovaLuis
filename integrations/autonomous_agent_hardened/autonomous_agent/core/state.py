"""State machine for agent runs."""
from __future__ import annotations

from enum import Enum


class AgentState(str, Enum):
    INPUT = "INPUT"
    CONTEXT_LOAD = "CONTEXT_LOAD"
    TASK_PARSE = "TASK_PARSE"
    PRIORITY_CHECK = "PRIORITY_CHECK"
    PLAN = "PLAN"
    EXECUTE = "EXECUTE"
    VERIFY = "VERIFY"
    CORRECT = "CORRECT"
    OUTPUT = "OUTPUT"
    LOG_UPDATE = "LOG_UPDATE"
    BLOCKED = "BLOCKED"
    DONE = "DONE"


_ALLOWED: dict[AgentState, set[AgentState]] = {
    AgentState.INPUT: {AgentState.CONTEXT_LOAD},
    AgentState.CONTEXT_LOAD: {AgentState.TASK_PARSE},
    AgentState.TASK_PARSE: {AgentState.PRIORITY_CHECK},
    AgentState.PRIORITY_CHECK: {AgentState.PLAN},
    AgentState.PLAN: {AgentState.EXECUTE},
    AgentState.EXECUTE: {AgentState.VERIFY, AgentState.BLOCKED},
    AgentState.VERIFY: {AgentState.CORRECT, AgentState.OUTPUT, AgentState.BLOCKED},
    AgentState.CORRECT: {AgentState.EXECUTE, AgentState.BLOCKED},
    AgentState.OUTPUT: {AgentState.LOG_UPDATE},
    AgentState.LOG_UPDATE: {AgentState.DONE},
    AgentState.BLOCKED: {AgentState.OUTPUT},
    AgentState.DONE: set(),
}


class StateMachine:
    def __init__(self) -> None:
        self.state = AgentState.INPUT
        self.history = [self.state]

    def transition(self, target: AgentState) -> None:
        allowed = _ALLOWED[self.state]
        if target not in allowed:
            raise ValueError(f"illegal state transition {self.state} -> {target}")
        self.state = target
        self.history.append(target)
