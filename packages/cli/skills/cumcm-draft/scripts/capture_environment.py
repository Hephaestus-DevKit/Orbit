from __future__ import annotations

import argparse
import importlib.metadata
import platform
import sys
from pathlib import Path

from project_utils import control_directory


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Report the selected Python interpreter; optionally keep a private text record."
    )
    parser.add_argument("project_root", type=Path)
    parser.add_argument(
        "--write",
        action="store_true",
        help="write .cumcm/environment.txt; never create results/environment.json",
    )
    args = parser.parse_args()
    root = args.project_root.resolve()
    requirements = root / "code" / "requirements.txt"
    requested = []
    if requirements.is_file():
        requested = [
            line.strip()
            for line in requirements.read_text(encoding="utf-8").splitlines()
            if line.strip() and not line.lstrip().startswith("#")
        ]
    rows = [
        f"Python版本: {sys.version.split()[0]}",
        f"解释器路径: {sys.executable}",
        f"操作系统: {platform.platform()}",
    ]
    if requested:
        rows.append("依赖版本:")
    for requirement in requested:
        name = requirement.split(";", 1)[0].strip()
        for marker in ("==", ">=", "<=", "~=", "!=", ">", "<", "["):
            name = name.split(marker, 1)[0].strip()
        try:
            version = importlib.metadata.version(name)
        except importlib.metadata.PackageNotFoundError:
            version = "未安装"
        rows.append(f"- {name}: {version}")
    content = "\n".join(rows) + "\n"
    print(content, end="")
    if args.write:
        output = control_directory(root) / "environment.txt"
        output.parent.mkdir(parents=True, exist_ok=True)
        output.write_text(content, encoding="utf-8")
        print(f"[OK] Environment note captured privately: {output}")


if __name__ == "__main__":
    main()
