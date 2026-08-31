from __future__ import annotations

import json
import re
from collections.abc import Iterable
from pathlib import Path
from typing import Any

CONTROL_DIRECTORY_NAME = ".cumcm"
DELIVERY_DIRECTORY_NAME = "happy"


DEFAULT_PROFILE: dict[str, Any] = {
    "schema_version": 1,
    "profile": "cumcm-2026",
    "rules_checked_at": "2026-09-01",
    "rules_expires_at": "2026-09-30",
    "paper": {
        "max_pdf_mb": 20,
        "max_body_pages": 30,
        "include_support_file_list": True,
        "include_source_appendix": True,
    },
    "support": {"max_archive_mb": 20, "include_ai_log": False},
    "result_artifacts": {
        "require_chinese_filenames": True,
        "require_chinese_headers": True,
        "require_chinese_sheet_names": True,
        "require_chinese_figure_filenames": True,
        "require_png_figures": True,
        "min_png_dpi": 300,
        "min_png_short_edge_px": 600,
        "min_png_long_edge_px": 1000,
        "require_utf8_sig_csv": True,
        "fixed_schema_exceptions": [],
    },
    "ai": {
        "policy": "cumcm-2026-trial",
        "used": True,
        "submission_intent": "training",
        "core_modeling_led_by_team": False,
        "manual_review_completed": False,
        "declaration_required": True,
        "declaration_before_references": True,
        "details_pdf_required": True,
    },
    "sources": [
        "https://www.mcm.edu.cn/html_cn/node/4cd596519c9eb9fbd866398f6df0caa3.html",
        "https://www.mcm.edu.cn/html_cn/node/9d8e511fe7a1447b35f53a82c908e2e0.html",
        "https://www.mcm.edu.cn/html_cn/node/fef94648f2836ab6cc81586f4c38512b.html",
    ],
}


def control_directory(root: Path) -> Path:
    """Return the private workflow-state directory for a modeling project."""
    return root / CONTROL_DIRECTORY_NAME


def delivery_directory(root: Path) -> Path:
    """返回论文源码、最终PDF和需提交结果的统一交付目录。"""
    return root / DELIVERY_DIRECTORY_NAME


def control_path(root: Path, name: str, legacy: Path | None = None) -> Path:
    """Prefer the compact layout while retaining read compatibility with 0.8.3."""
    current = control_directory(root) / name
    if current.exists() or legacy is None or not legacy.exists():
        return current
    return legacy


def build_directory(root: Path) -> Path:
    return control_directory(root) / "build"


def generated_directory(root: Path) -> Path:
    return control_directory(root) / "generated"


def load_profile(root: Path) -> dict[str, Any]:
    path = control_path(
        root,
        "profile.json",
        root / "happy" / "contest-profile.json",
    )
    if not path.is_file():
        return json.loads(json.dumps(DEFAULT_PROFILE))
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as error:
        raise ValueError(f"invalid contest profile {path}: {error}") from error
    if not isinstance(payload, dict) or payload.get("schema_version") != 1:
        raise ValueError(f"{path.name} requires schema_version 1")
    merged = json.loads(json.dumps(DEFAULT_PROFILE))
    for key, value in payload.items():
        if isinstance(value, dict) and isinstance(merged.get(key), dict):
            merged[key].update(value)
        else:
            merged[key] = value
    return merged


def numeric_limit(section: dict[str, Any], name: str) -> float | None:
    value = section.get(name)
    if value is None:
        return None
    if isinstance(value, bool) or not isinstance(value, (int, float)) or value <= 0:
        raise ValueError(f"profile field {name} must be null or a positive number")
    return float(value)


def ensure_safe_file(root: Path, path: Path, prefixes: Iterable[str]) -> Path:
    resolved_root = root.resolve()
    if path.is_symlink():
        raise ValueError(f"symbolic links are not allowed: {path}")
    resolved = path.resolve()
    try:
        relative = resolved.relative_to(resolved_root)
    except ValueError as error:
        raise ValueError(f"path escapes project root: {path}") from error
    allowed = set(prefixes)
    if not relative.parts or relative.parts[0] not in allowed:
        raise ValueError(f"path is outside allowed directories {sorted(allowed)}: {relative}")
    return resolved


def iter_regular_files(root: Path, directory: str, excluded: set[str]) -> list[Path]:
    base = root / directory
    if not base.exists():
        return []
    if base.is_symlink():
        raise ValueError(f"symbolic directory is not allowed: {base}")
    files: list[Path] = []
    for path in base.rglob("*"):
        if any(part in excluded for part in path.relative_to(root).parts):
            continue
        if path.is_symlink():
            raise ValueError(f"symbolic links are not allowed: {path}")
        if path.is_file():
            ensure_safe_file(root, path, {directory})
            files.append(path)
    return sorted(files)


def question_numbers(root: Path) -> set[int]:
    numbers: set[int] = set()
    pattern = re.compile(r"q([1-9]\d*)$")
    for base_name in ("code", "results", "figures"):
        base = root / base_name
        if not base.is_dir():
            continue
        for path in base.iterdir():
            match = pattern.fullmatch(path.name)
            if path.is_dir() and match:
                numbers.add(int(match.group(1)))
    sections = delivery_directory(root) / "sections"
    if sections.is_dir():
        for path in sections.glob("q*.tex"):
            match = re.fullmatch(r"q([1-9]\d*)\.tex", path.name)
            if match:
                numbers.add(int(match.group(1)))
    return numbers
