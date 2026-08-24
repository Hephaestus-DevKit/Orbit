from __future__ import annotations

# ruff: noqa: E402

import argparse
import os
import subprocess
import sys
from pathlib import Path

sys.dont_write_bytecode = True

from evidence_freeze import require_refresh_authorization, write_freeze
from project_utils import question_numbers
from script_runtime import configure_utf8_output
from validate_project import code_architecture_errors


SCRIPT_ROOT = Path(__file__).resolve().parent


def run(script: str, root: Path, *flags: str) -> None:
    command = [sys.executable, "-B", str(SCRIPT_ROOT / script), str(root), *flags]
    environment = os.environ.copy()
    environment["PYTHONDONTWRITEBYTECODE"] = "1"
    completed = subprocess.run(command, check=False, env=environment)
    if completed.returncode:
        raise SystemExit(f"Finalization stopped because {script} failed with exit code {completed.returncode}.")


def main() -> None:
    parser = argparse.ArgumentParser(description="One-command execution, build, audit, package, and strict validation.")
    parser.add_argument("project_root", type=Path)
    parser.add_argument("--run-code", action="store_true", help="run code/run_all.py before building")
    parser.add_argument("--refresh-evidence", action="store_true", help="explicitly authorize replacing an existing numerical-evidence freeze; requires --run-code")
    parser.add_argument("--strict-layout", action="store_true", help="fail on TeX underfull boxes as well as overfull boxes")
    parser.add_argument("--render-pages", action="store_true", help="render every final PDF page for visual review")
    parser.set_defaults(clean=True)
    parser.add_argument(
        "--clean",
        dest="clean",
        action="store_true",
        help="remove deterministic caches before freezing and packaging (default)",
    )
    parser.add_argument(
        "--no-clean",
        dest="clean",
        action="store_false",
        help="keep deterministic caches for local debugging",
    )
    args = parser.parse_args()
    root = args.project_root.resolve()
    if args.refresh_evidence and not args.run_code:
        raise SystemExit("--refresh-evidence requires --run-code")
    if args.run_code:
        require_refresh_authorization(root, args.refresh_evidence)
        entry = root / "code" / "run_all.py"
        if not entry.is_file():
            raise SystemExit(f"Missing code entry point: {entry}")
        environment = os.environ.copy()
        environment["PYTHONDONTWRITEBYTECODE"] = "1"
        completed = subprocess.run(
            [sys.executable, "-B", str(entry)],
            cwd=root / "code",
            check=False,
            env=environment,
        )
        if completed.returncode:
            raise SystemExit("code/run_all.py failed; happy output was not rebuilt from stale evidence.")
    discovered_questions = question_numbers(root)
    architecture_errors = code_architecture_errors(
        root, max(discovered_questions, default=0)
    )
    if architecture_errors:
        for error in architecture_errors:
            print(f"[ERROR] {error}")
        raise SystemExit(
            "Finalization stopped before compilation because modeling code is incomplete."
        )
    run("capture_environment.py", root, "--write")
    run("build_paper.py", root, *(["--strict-layout"] if args.strict_layout else []))
    audit_flags = ["--fail-on-errors"]
    if args.render_pages:
        audit_flags.append("--render-pages")
    run("audit_paper.py", root, *audit_flags)
    if args.clean:
        run("clean_project.py", root, "--apply")
    freeze = write_freeze(root)
    print(f"[OK] Numerical evidence phase frozen: {freeze}")
    run("package_support.py", root)
    run("validate_project.py", root, "--strict")
    print(f"[OK] Complete modeling-paper delivery finalized: {root / 'happy' / 'main.pdf'}")
    print(
        "[ORBIT_TERMINAL_SUCCESS] Final PDF and support archive are current. "
        "Stop tool use and return the final delivery report."
    )


if __name__ == "__main__":
    configure_utf8_output()
    main()
