from __future__ import annotations

import argparse
import shutil
from pathlib import Path

from project_utils import build_directory


CACHE_DIR_NAMES = {
    "__pycache__",
    ".pytest_cache",
    ".mypy_cache",
    ".ruff_cache",
    ".ipynb_checkpoints",
}
TEX_CACHE_SUFFIXES = {".aux", ".bbl", ".bcf", ".blg", ".fdb_latexmk", ".fls", ".log", ".out", ".run.xml", ".synctex.gz", ".toc", ".xdv"}
LEGACY_FILES = {
    "happy/ai-use-log.md",
    "happy/contest-profile.json",
    "happy/evidence-freeze.json",
    "happy/evidence-map.yaml",
    "happy/input-inventory.json",
    "happy/question-count.json",
    "happy/question-fingerprint.json",
    "happy/support-materials.zip",
    "results/environment.json",
}
LEGACY_RESULT_NAMES = {
    "constraint_checks.json",
    "data_audit.json",
    "metrics.csv",
    "oht_log.csv",
    "summary.json",
    "task_results.csv",
}
LEGACY_FIGURE_NAMES = {
    "cross_question_comparison.pdf",
    "cross_question_comparison.png",
    "transfer_time_distribution.pdf",
    "transfer_time_distribution.png",
}
REFERENCE_SUFFIXES = {".json", ".md", ".tex", ".yaml", ".yml"}


def is_referenced_artifact(root: Path, path: Path) -> bool:
    """保留仍被交付文档、证据或配置引用的历史产物。"""
    relative = path.relative_to(root).as_posix()
    name = path.name
    for base in (root / "happy", root / ".cumcm"):
        if not base.is_dir() or base.is_symlink():
            continue
        for document in base.rglob("*"):
            if (
                not document.is_file()
                or document.is_symlink()
                or document.suffix.lower() not in REFERENCE_SUFFIXES
            ):
                continue
            try:
                text = document.read_text(encoding="utf-8", errors="replace")
            except OSError:
                continue
            if relative in text or name in text:
                return True
    return False


def targets(root: Path) -> list[Path]:
    found: set[Path] = set()
    for relative in LEGACY_FILES:
        path = root / relative
        if path.is_file() and not path.is_symlink():
            found.add(path)
    for base, names in (
        (root / "results", LEGACY_RESULT_NAMES),
        (root / "figures", LEGACY_FIGURE_NAMES),
    ):
        if base.is_dir() and not base.is_symlink():
            for path in base.rglob("*"):
                if (
                    path.is_file()
                    and not path.is_symlink()
                    and path.name in names
                    and not is_referenced_artifact(root, path)
                ):
                    found.add(path)
    for path in root.rglob("*"):
        if path.is_symlink():
            continue
        if path.is_dir() and path.name in CACHE_DIR_NAMES:
            found.add(path)
        elif path.is_file() and path.suffix.lower() in {".pyc", ".pyo"}:
            found.add(path)
        elif path.is_file() and any(path.name.endswith(suffix) for suffix in TEX_CACHE_SUFFIXES):
            if any(
                part in {"happy", ".cumcm"}
                for part in path.relative_to(root).parts
            ):
                found.add(path)
    page_review = build_directory(root) / "page-review"
    if page_review.is_dir() and not page_review.is_symlink():
        found.add(page_review)
    happy_build = root / "happy" / "build"
    if happy_build.is_dir() and not happy_build.is_symlink():
        found.add(happy_build)
    return sorted(found, key=lambda path: (len(path.parts), str(path)), reverse=True)


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Remove deterministic caches and unreferenced legacy delivery artifacts."
    )
    parser.add_argument("project_root", type=Path)
    parser.add_argument("--apply", action="store_true", help="perform deletion; default is dry run")
    args = parser.parse_args()
    root = args.project_root.resolve()
    selected = targets(root)
    selected_set = set(selected)
    protected_legacy = [
        path
        for base, names in (
            (root / "results", LEGACY_RESULT_NAMES),
            (root / "figures", LEGACY_FIGURE_NAMES),
        )
        if base.is_dir() and not base.is_symlink()
        for path in base.rglob("*")
        if path.is_file()
        and not path.is_symlink()
        and path.name in names
        and path not in selected_set
    ]
    for path in selected:
        print(f"[{'REMOVE' if args.apply else 'DRY-RUN'}] {path.relative_to(root)}")
        if args.apply:
            if path.is_dir():
                shutil.rmtree(path)
            elif path.exists():
                path.unlink()
    for path in protected_legacy:
        print(f"[KEEP] referenced legacy artifact: {path.relative_to(root)}")
    print(f"[OK] {'Removed' if args.apply else 'Identified'} {len(selected)} cache/render target(s); final PDFs and source artifacts preserved")


if __name__ == "__main__":
    main()
