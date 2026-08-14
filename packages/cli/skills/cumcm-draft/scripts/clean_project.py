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


def targets(root: Path) -> list[Path]:
    found: set[Path] = set()
    for path in root.rglob("*"):
        if path.is_symlink():
            continue
        if path.is_dir() and path.name in CACHE_DIR_NAMES:
            found.add(path)
        elif path.is_file() and any(path.name.endswith(suffix) for suffix in TEX_CACHE_SUFFIXES):
            if any(
                part in {"paper", ".cumcm"}
                for part in path.relative_to(root).parts
            ):
                found.add(path)
    page_review = build_directory(root) / "page-review"
    if page_review.is_dir() and not page_review.is_symlink():
        found.add(page_review)
    return sorted(found, key=lambda path: (len(path.parts), str(path)), reverse=True)


def main() -> None:
    parser = argparse.ArgumentParser(description="Remove only deterministic caches and temporary PDF page renders.")
    parser.add_argument("project_root", type=Path)
    parser.add_argument("--apply", action="store_true", help="perform deletion; default is dry run")
    args = parser.parse_args()
    root = args.project_root.resolve()
    selected = targets(root)
    for path in selected:
        print(f"[{'REMOVE' if args.apply else 'DRY-RUN'}] {path.relative_to(root)}")
        if args.apply:
            if path.is_dir():
                shutil.rmtree(path)
            elif path.exists():
                path.unlink()
    print(f"[OK] {'Removed' if args.apply else 'Identified'} {len(selected)} cache/render target(s); final PDFs and source artifacts preserved")


if __name__ == "__main__":
    main()
