from __future__ import annotations

import argparse
import zipfile
from pathlib import Path

from project_utils import (
    control_path,
    iter_regular_files,
    load_profile,
    numeric_limit,
)


EXCLUDED_PARTS = {
    "__pycache__",
    ".pytest_cache",
    ".mypy_cache",
    ".ruff_cache",
    ".ipynb_checkpoints",
    "build",
}


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Package only reproducible submission support files."
    )
    parser.add_argument("project_root", type=Path)
    args = parser.parse_args()
    root = args.project_root.resolve()
    output = root / "paper" / "支撑材料.zip"
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
        ai_pdf = root / "paper" / "AI工具使用详情.pdf"
        if not ai_pdf.is_file() or ai_pdf.is_symlink():
            raise SystemExit("Active profile requires a built paper/AI工具使用详情.pdf")
        candidates.append((ai_pdf, "AI工具使用详情.pdf"))

    environment = control_path(root, "environment.json")
    if environment.is_file() and not environment.is_symlink():
        candidates.append((environment, "复现环境.json"))

    if bool(support_profile.get("include_ai_log")):
        log = control_path(
            root,
            "ai-use-log.md",
            root / "paper" / "ai-use-log.md",
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
    print(
        f"[OK] Packaged {len(candidates)} support file(s): "
        f"{output} ({size_mb:.2f} MB)"
    )


if __name__ == "__main__":
    main()
