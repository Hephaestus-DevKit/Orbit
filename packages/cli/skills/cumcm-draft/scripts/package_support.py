from __future__ import annotations

import argparse
import shutil
import zipfile
from pathlib import Path

from project_utils import (
    control_path,
    delivery_directory,
    iter_regular_files,
    load_profile,
    numeric_limit,
    question_numbers,
)
from script_runtime import configure_utf8_output


EXCLUDED_PARTS = {
    "__pycache__",
    ".pytest_cache",
    ".mypy_cache",
    ".ruff_cache",
    ".ipynb_checkpoints",
    "build",
}
DELIVERY_SUFFIXES = {".csv", ".tsv", ".xls", ".xlsx", ".doc", ".docx"}


def copy_question_deliverables(root: Path) -> int:
    """把需提交的表格复制到 happy/qN；内部审计 JSON 留在 results/qN。"""
    copied = 0
    happy = delivery_directory(root)
    for number in sorted(question_numbers(root)):
        source = root / "results" / f"q{number}"
        if source.is_symlink():
            raise SystemExit(f"Symbolic result directory is unsafe: {source}")
        selected = (
            [
                path
                for path in source.iterdir()
                if path.is_file()
                and not path.is_symlink()
                and path.suffix.lower() in DELIVERY_SUFFIXES
            ]
            if source.is_dir()
            else []
        )
        target = happy / f"q{number}"
        if target.is_symlink():
            raise SystemExit(f"Symbolic delivery directory is unsafe: {target}")
        if not selected:
            if target.is_dir() and not any(target.iterdir()):
                target.rmdir()
            continue
        if target.exists() and not target.is_dir():
            raise SystemExit(f"Delivery target is not a directory: {target}")
        target.mkdir(parents=True, exist_ok=True)
        for old in target.iterdir():
            if old.is_symlink():
                raise SystemExit(f"Symbolic delivery file is unsafe: {old}")
            if old.is_file():
                old.unlink()
        for path in selected:
            shutil.copy2(path, target / path.name, follow_symlinks=False)
            copied += 1
    return copied


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Package only reproducible submission support files."
    )
    parser.add_argument("project_root", type=Path)
    args = parser.parse_args()
    root = args.project_root.resolve()
    output = delivery_directory(root) / "支撑材料.zip"
    try:
        profile = load_profile(root)
        support_profile = profile["support"]
        assert isinstance(support_profile, dict)
        limit = numeric_limit(support_profile, "max_archive_mb")
        candidates = [
            (path, path.relative_to(root).as_posix())
            for directory in ("code", "results", "figures")
            for path in iter_regular_files(root, directory, EXCLUDED_PARTS)
        ]
    except (ValueError, TypeError) as error:
        raise SystemExit(str(error)) from error

    ai_profile = profile["ai"]
    assert isinstance(ai_profile, dict)
    if bool(ai_profile.get("used")) and bool(ai_profile.get("details_pdf_required")):
        ai_pdf = delivery_directory(root) / "AI工具使用详情.pdf"
        if not ai_pdf.is_file() or ai_pdf.is_symlink():
            raise SystemExit("Active profile requires a built happy/AI工具使用详情.pdf")
        candidates.append((ai_pdf, "AI工具使用详情.pdf"))

    if bool(support_profile.get("include_ai_log")):
        log = control_path(
            root,
            "ai-use-log.md",
            delivery_directory(root) / "ai-use-log.md",
        )
        if log.is_file() and not log.is_symlink():
            candidates.append((log, "AI工具使用记录.md"))

    archive_names = [name for _, name in candidates]
    if len(archive_names) != len(set(archive_names)):
        raise SystemExit("Support archive contains duplicate destination names.")

    output.parent.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(output, "w", compression=zipfile.ZIP_DEFLATED) as archive:
        for path, archive_name in sorted(candidates, key=lambda item: item[1]):
            archive.write(path, archive_name)
    size_mb = output.stat().st_size / (1024 * 1024)
    if limit is not None and size_mb > limit:
        output.unlink()
        raise SystemExit(
            f"Support archive would be {size_mb:.2f} MB; "
            f"active profile limit is {limit:g} MB."
        )
    copied = copy_question_deliverables(root)
    print(
        f"[OK] Packaged {len(candidates)} support file(s): "
        f"{output} ({size_mb:.2f} MB); copied {copied} deliverable file(s) to happy/qN"
    )


if __name__ == "__main__":
    configure_utf8_output()
    main()
