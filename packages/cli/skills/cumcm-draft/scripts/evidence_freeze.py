from __future__ import annotations

import argparse
import hashlib
import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from project_utils import control_path, delivery_directory, iter_regular_files
from script_runtime import configure_utf8_output


EXCLUDED_PARTS = {"__pycache__", ".pytest_cache", ".mypy_cache", ".ruff_cache", "build"}
EVIDENCE_DIRECTORIES = ("results", "figures")


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def snapshot_evidence(root: Path) -> list[dict[str, Any]]:
    entries: list[dict[str, Any]] = []
    for directory in EVIDENCE_DIRECTORIES:
        for path in iter_regular_files(root, directory, EXCLUDED_PARTS):
            entries.append(
                {
                    "path": path.relative_to(root).as_posix(),
                    "size_bytes": path.stat().st_size,
                    "sha256": sha256(path),
                }
            )
    return sorted(entries, key=lambda item: str(item["path"]))


def freeze_path(root: Path) -> Path:
    return control_path(
        root,
        "evidence-freeze.json",
        delivery_directory(root) / "evidence-freeze.json",
    )


def load_freeze(root: Path) -> dict[str, Any] | None:
    path = freeze_path(root)
    if not path.is_file():
        return None
    payload = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(payload, dict) or payload.get("schema_version") != 1 or not isinstance(payload.get("files"), list):
        raise ValueError(f"invalid evidence freeze manifest: {path}")
    return payload


def evidence_differences(root: Path) -> list[str]:
    payload = load_freeze(root)
    if payload is None:
        return [".cumcm/evidence-freeze.json is missing"]
    expected = {str(item["path"]): (int(item["size_bytes"]), str(item["sha256"])) for item in payload["files"] if isinstance(item, dict)}
    actual = {str(item["path"]): (int(item["size_bytes"]), str(item["sha256"])) for item in snapshot_evidence(root)}
    differences = [f"added evidence: {path}" for path in sorted(actual.keys() - expected.keys())]
    differences.extend(f"removed evidence: {path}" for path in sorted(expected.keys() - actual.keys()))
    differences.extend(f"changed evidence: {path}" for path in sorted(expected.keys() & actual.keys()) if expected[path] != actual[path])
    return differences


def require_refresh_authorization(root: Path, refresh: bool) -> None:
    if freeze_path(root).is_file() and not refresh:
        raise SystemExit(
            "Evidence is frozen by .cumcm/evidence-freeze.json. Refusing to rerun code. "
            "Use --refresh-evidence together with --run-code only after an explicit request to recompute results."
        )


def write_freeze(root: Path) -> Path:
    target = freeze_path(root)
    target.parent.mkdir(parents=True, exist_ok=True)
    payload = {
        "schema_version": 1,
        "state": "frozen",
        "created_at": datetime.now(timezone.utc).isoformat(),
        "verifier": {
            "name": "cumcm-draft-finalizer",
            "scripts_sha256": {
                name: sha256(Path(__file__).resolve().parent / name)
                for name in (
                    "evidence_freeze.py",
                    "finalize_project.py",
                    "validate_project.py",
                )
            },
        },
        "files": snapshot_evidence(root),
    }
    temporary = target.with_name(f"{target.name}.tmp")
    temporary.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    temporary.replace(target)
    return target


def main() -> None:
    parser = argparse.ArgumentParser(description="Create or verify the immutable numerical-evidence phase boundary.")
    parser.add_argument("project_root", type=Path)
    parser.add_argument("--write", action="store_true", help="replace the freeze manifest with the current results/figures snapshot")
    args = parser.parse_args()
    root = args.project_root.resolve()
    if args.write:
        path = write_freeze(root)
        print(f"[OK] Evidence frozen: {path}")
        return
    differences = evidence_differences(root)
    if differences:
        for difference in differences:
            print(f"[ERROR] {difference}")
        raise SystemExit(1)
    print(f"[OK] Evidence freeze verified: {freeze_path(root)}")


if __name__ == "__main__":
    configure_utf8_output()
    main()
