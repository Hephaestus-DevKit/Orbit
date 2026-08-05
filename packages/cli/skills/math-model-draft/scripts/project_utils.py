from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Any, Iterable


DEFAULT_PROFILE: dict[str, Any] = {
    "schema_version": 1,
    "profile": "generic",
    "paper": {
        "max_pdf_mb": None,
        "max_body_pages": None,
        "include_support_file_list": False,
        "include_source_appendix": False,
    },
    "support": {"max_archive_mb": None, "include_ai_log": False},
    "ai": {
        "policy": "supplied-rules",
        "used": True,
        "declaration_before_references": True,
        "details_pdf_required": False,
    },
}


def load_profile(root: Path) -> dict[str, Any]:
    path = root / "paper" / "contest-profile.json"
    if not path.is_file():
        return json.loads(json.dumps(DEFAULT_PROFILE))
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as error:
        raise ValueError(f"invalid contest profile {path}: {error}") from error
    if not isinstance(payload, dict) or payload.get("schema_version") != 1:
        raise ValueError("contest-profile.json requires schema_version 1")
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
    sections = root / "paper" / "sections"
    if sections.is_dir():
        for path in sections.glob("q*.tex"):
            match = re.fullmatch(r"q([1-9]\d*)\.tex", path.name)
            if match:
                numbers.add(int(match.group(1)))
    return numbers
