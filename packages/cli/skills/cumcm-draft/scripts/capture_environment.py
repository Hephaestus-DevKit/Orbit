from __future__ import annotations

import argparse
import importlib.metadata
import json
import platform
import sys
from pathlib import Path

from project_utils import control_directory


def main() -> None:
    parser = argparse.ArgumentParser(description="Capture the reproducibility environment.")
    parser.add_argument("project_root", type=Path)
    args = parser.parse_args()
    root = args.project_root.resolve()
    requirements = root / "code" / "requirements.txt"
    requested: list[str] = []
    if requirements.is_file():
        for raw in requirements.read_text(encoding="utf-8").splitlines():
            line = raw.strip()
            if line and not line.startswith("#"):
                requested.append(line)
    packages: dict[str, str | None] = {}
    for requirement in requested:
        name = requirement.split(";", 1)[0].strip()
        for marker in ("==", ">=", "<=", "~=", "!=", ">", "<", "["):
            name = name.split(marker, 1)[0].strip()
        try:
            packages[name] = importlib.metadata.version(name)
        except importlib.metadata.PackageNotFoundError:
            packages[name] = None
    payload = {
        "schema_version": 1,
        "python": sys.version,
        "executable": sys.executable,
        "platform": platform.platform(),
        "packages": packages,
    }
    output = control_directory(root) / "environment.json"
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"[OK] Environment captured: {output}")


if __name__ == "__main__":
    main()
