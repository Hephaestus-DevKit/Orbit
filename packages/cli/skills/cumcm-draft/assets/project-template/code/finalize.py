from __future__ import annotations

import json
import os
import runpy
import shutil
import subprocess
import sys
from pathlib import Path


PROJECT_ROOT = Path(__file__).resolve().parent.parent


def resolve_finalizer() -> Path:
    development_root = os.environ.get("CUMCM_DRAFT_SKILL_ROOT")
    if development_root:
        candidate = Path(development_root).resolve() / "scripts" / "finalize_project.py"
        if candidate.is_file() and not candidate.is_symlink():
            return candidate
    personal = Path.home() / ".orbit" / "skills" / "cumcm-draft" / "scripts" / "finalize_project.py"
    if personal.is_file():
        return personal
    orbit = shutil.which("orbit")
    if orbit:
        completed = subprocess.run(
            [orbit, "skills", "list", "--json"],
            cwd=PROJECT_ROOT,
            text=True,
            encoding="utf-8",
            errors="replace",
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            check=False,
        )
        if completed.returncode == 0:
            try:
                payload = json.loads(completed.stdout)
            except json.JSONDecodeError:
                payload = {}
            for skill in payload.get("skills", []):
                if skill.get("name") != "cumcm-draft":
                    continue
                candidate = Path(str(skill.get("path", ""))).resolve().parent / "scripts" / "finalize_project.py"
                if candidate.is_file():
                    return candidate
    raise SystemExit(
        "Active cumcm-draft finalizer is missing. Run `orbit skills list` "
        "and ensure the bundled or personal Skill is enabled."
    )


def main() -> None:
    finalizer = resolve_finalizer()
    sys.path.insert(0, str(finalizer.parent))
    sys.argv = [str(finalizer), str(PROJECT_ROOT), *sys.argv[1:]]
    runpy.run_path(str(finalizer), run_name="__main__")


if __name__ == "__main__":
    main()
