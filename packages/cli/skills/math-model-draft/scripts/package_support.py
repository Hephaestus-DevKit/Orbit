from __future__ import annotations

import argparse
import zipfile
from pathlib import Path

from project_utils import iter_regular_files, load_profile, numeric_limit


EXCLUDED_PARTS = {"__pycache__", ".pytest_cache", ".mypy_cache", "build"}


def main() -> None:
    parser = argparse.ArgumentParser(description="Package reproducible support files safely.")
    parser.add_argument("project_root", type=Path)
    args = parser.parse_args()
    root = args.project_root.resolve()
    output = root / "paper" / "support-materials.zip"
    try:
        profile = load_profile(root)
        support_profile = profile["support"]
        assert isinstance(support_profile, dict)
        limit = numeric_limit(support_profile, "max_archive_mb")
        candidates = [path for directory in ("code", "results", "figures") for path in iter_regular_files(root, directory, EXCLUDED_PARTS)]
    except (ValueError, TypeError) as error:
        raise SystemExit(str(error)) from error

    ai_profile = profile["ai"]
    assert isinstance(ai_profile, dict)
    if bool(ai_profile.get("used")) and bool(ai_profile.get("details_pdf_required")):
        ai_pdf = root / "paper" / "AI工具使用详情.pdf"
        if not ai_pdf.is_file() or ai_pdf.is_symlink():
            raise SystemExit("Active profile requires a built paper/AI工具使用详情.pdf")
        candidates.append(ai_pdf)
    if bool(support_profile.get("include_ai_log")):
        log = root / "paper" / "ai-use-log.md"
        if log.is_file() and not log.is_symlink():
            candidates.append(log)
    freeze = root / "paper" / "evidence-freeze.json"
    if not freeze.is_file() or freeze.is_symlink():
        raise SystemExit("Missing paper/evidence-freeze.json; run the finalizer before packaging support files")
    candidates.append(freeze)

    output.parent.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(output, "w", compression=zipfile.ZIP_DEFLATED) as archive:
        for path in sorted(set(candidates)):
            archive.write(path, path.relative_to(root).as_posix())
    size_mb = output.stat().st_size / (1024 * 1024)
    if limit is not None and size_mb > limit:
        output.unlink()
        raise SystemExit(f"Support archive would be {size_mb:.2f} MB; active profile limit is {limit:g} MB.")
    print(f"[OK] Packaged {len(set(candidates))} support file(s): {output} ({size_mb:.2f} MB)")


if __name__ == "__main__":
    main()
