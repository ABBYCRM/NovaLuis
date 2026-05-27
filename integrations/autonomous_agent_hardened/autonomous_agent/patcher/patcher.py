"""Safe patch application."""
from __future__ import annotations

from pathlib import Path

from ..config import Config
from ..core.types import PatchApplyResult, PatchOperation
from ..exceptions import PatchError, SecurityViolation
from ..security.path_policy import PathPolicy


class Patcher:
    def __init__(self, workspace: Path, config: Config):
        self.workspace = Path(workspace).resolve()
        self.config = config
        self.policy = PathPolicy(self.workspace, config.security.forbidden_paths)

    def apply(self, patches: list[PatchOperation], dry_run: bool = False) -> PatchApplyResult:
        result = PatchApplyResult()
        for patch in patches:
            try:
                target = self.policy.resolve(patch.path)
                self._validate_patch_size(patch)
                self._apply_one(target, patch, dry_run=dry_run)
                result.applied.append(str(target.relative_to(self.workspace)))
            except (PatchError, SecurityViolation, OSError, UnicodeDecodeError) as exc:
                result.errors.append(f"{patch.path}: {exc}")
        return result

    def _validate_patch_size(self, patch: PatchOperation) -> None:
        payload = "\n".join(filter(None, [patch.content, patch.expected_old, patch.replacement]))
        if len(payload.encode("utf-8")) > self.config.security.max_patch_size_bytes:
            raise PatchError("patch size exceeds configured limit")

    def _apply_one(self, target: Path, patch: PatchOperation, dry_run: bool) -> None:
        if patch.action == "delete":
            if not self.config.security.allow_delete:
                raise PatchError("delete operation disabled")
            if not dry_run and target.exists():
                target.unlink()
            return
        if patch.action == "write":
            if patch.content is None:
                raise PatchError("write patch missing content")
            if not dry_run:
                target.parent.mkdir(parents=True, exist_ok=True)
                target.write_text(patch.content, encoding="utf-8")
            return
        if patch.action == "replace":
            if patch.expected_old is None or patch.replacement is None:
                raise PatchError("replace patch requires expected_old and replacement")
            current = target.read_text(encoding="utf-8")
            if patch.expected_old not in current:
                raise PatchError("expected_old text not found")
            if not dry_run:
                target.write_text(current.replace(patch.expected_old, patch.replacement, 1), encoding="utf-8")
            return
        raise PatchError(f"unsupported patch action: {patch.action}")
