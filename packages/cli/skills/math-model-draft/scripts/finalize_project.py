from __future__ import annotations

import argparse
import subprocess
import sys
from pathlib import Path


SCRIPT_ROOT = Path(__file__).resolve().parent


def run(script: str, root: Path, *flags: str) -> None:
    command = [sys.executable, str(SCRIPT_ROOT / script), str(root), *flags]
    completed = subprocess.run(command, check=False)
    if completed.returncode:
        raise SystemExit(f"Finalization stopped because {script} failed with exit code {completed.returncode}.")


def main() -> None:
    parser = argparse.ArgumentParser(description="One-command execution, build, audit, package, and strict validation.")
    parser.add_argument("project_root", type=Path)
    parser.add_argument("--run-code", action="store_true", help="run code/run_all.py before building")
    parser.add_argument("--strict-layout", action="store_true", help="fail on TeX underfull boxes as well as overfull boxes")
    parser.add_argument("--render-pages", action="store_true", help="render every final PDF page for visual review")
    parser.add_argument("--clean", action="store_true", help="remove deterministic caches after validation")
    args = parser.parse_args()
    root = args.project_root.resolve()
    if args.run_code:
        entry = root / "code" / "run_all.py"
        if not entry.is_file():
            raise SystemExit(f"Missing code entry point: {entry}")
        completed = subprocess.run([sys.executable, str(entry)], cwd=root / "code", check=False)
        if completed.returncode:
            raise SystemExit("code/run_all.py failed; paper was not rebuilt from stale evidence.")
    run("capture_environment.py", root)
    run("build_paper.py", root, *(["--strict-layout"] if args.strict_layout else []))
    audit_flags = ["--fail-on-errors"]
    if args.render_pages:
        audit_flags.append("--render-pages")
    run("audit_paper.py", root, *audit_flags)
    run("package_support.py", root)
    run("validate_project.py", root, "--strict")
    if args.clean:
        run("clean_project.py", root, "--apply")
    print(f"[OK] Complete modeling-paper delivery finalized: {root / 'paper' / 'main.pdf'}")


if __name__ == "__main__":
    main()
