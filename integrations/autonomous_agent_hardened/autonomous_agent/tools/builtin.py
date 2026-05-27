"""Default tool registry."""
from __future__ import annotations

from .base import ToolRegistry
from .answer_analysis_tools import AnalyzeAnswerTool, AnswerAnalysisReferenceTool
from .codeops_tools import CodeOpsEvaluateActionTool, CodeOpsPreflightTool
from .file_tools import ReadFileTool, ReplaceInFileTool, SearchFilesTool, WriteFileTool
from .git_tools import GitDiffTool, GitStatusTool
from .shell_tools import RunCommandTool, VerifyTool
from .user_model_tools import AnalyzeUserContextTool, PsychAlphabetReferenceTool


def build_default_registry() -> ToolRegistry:
    registry = ToolRegistry()
    for tool in (
        ReadFileTool(),
        SearchFilesTool(),
        WriteFileTool(),
        ReplaceInFileTool(),
        RunCommandTool(),
        VerifyTool(),
        GitStatusTool(),
        GitDiffTool(),
        CodeOpsPreflightTool(),
        CodeOpsEvaluateActionTool(),
        AnalyzeUserContextTool(),
        PsychAlphabetReferenceTool(),
        AnalyzeAnswerTool(),
        AnswerAnalysisReferenceTool(),
    ):
        registry.register(tool)
    return registry
