from __future__ import annotations

import argparse
import json
import re
import shutil
from pathlib import Path

from project_utils import (
    control_directory,
    control_path,
    delivery_directory,
    question_numbers,
)


SKILL_ROOT = Path(__file__).resolve().parents[1]
TEMPLATE_ROOT = SKILL_ROOT / "assets" / "project-template"
QUESTION_BEGIN = "% ORBIT:QUESTIONS:BEGIN"
QUESTION_END = "% ORBIT:QUESTIONS:END"
LEGACY_CONTROL_FILES = {
    "contest-profile.json": "profile.json",
    "question-count.json": "project.json",
    "evidence-map.yaml": "evidence-map.yaml",
    "input-inventory.json": "input-inventory.json",
    "question-fingerprint.json": "question-fingerprint.json",
    "ai-use-log.md": "ai-use-log.md",
    "evidence-freeze.json": "evidence-freeze.json",
}


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Create or extend a compact, non-destructive modeling project."
    )
    parser.add_argument("project_root", type=Path)
    parser.add_argument("--questions", type=int, required=True)
    args = parser.parse_args()
    if not 1 <= args.questions <= 20:
        raise SystemExit("--questions must be between 1 and 20.")

    root = args.project_root.resolve()
    created: list[str] = []
    updated: list[str] = []
    preserved: list[str] = []
    removed: list[str] = []
    for directory in (
        root / "question",
        root / "code",
        root / "code" / "always",
        delivery_directory(root),
        control_directory(root),
        control_directory(root) / "build",
        control_directory(root) / "generated",
    ):
        directory.mkdir(parents=True, exist_ok=True)

    migrate_legacy_control_files(root, created, preserved)
    copy_template_tree(root, created, preserved)
    remove_empty_legacy_layout_directories(root, removed)
    declared = read_declared_count(root)
    discovered = max(question_numbers(root), default=0)
    question_count = max(args.questions, declared, discovered)
    create_question_files(root, question_count, created, updated, preserved)
    extend_evidence_map(root, question_count, created, updated)

    print(f"[OK] Compact project skeleton ready: {root}")
    print(
        f"  Questions: {question_count}; created {len(created)}, "
        f"updated {len(updated)}, preserved {len(preserved)} file(s)."
    )
    print(
        "  happy/ contains editable TeX, final PDFs, and per-question submission copies; "
        ".cumcm/ owns workflow state and build caches."
    )
    if updated:
        print("  Updated orchestrators: " + ", ".join(updated))
    if removed:
        print("  Removed empty legacy layout shells: " + ", ".join(removed))


def remove_empty_legacy_layout_directories(root: Path, removed: list[str]) -> None:
    """Drop empty legacy shells without touching authored files or build output."""
    for directory in (
        delivery_directory(root) / "sections",
        delivery_directory(root) / "build",
        root / "paper" / "sections",
        root / "paper" / "build",
    ):
        if not directory.is_dir() or directory.is_symlink():
            continue
        try:
            next(directory.iterdir())
        except StopIteration:
            directory.rmdir()
            removed.append(directory.relative_to(root).as_posix() + "/")
    legacy_paper = root / "paper"
    if legacy_paper.is_dir() and not legacy_paper.is_symlink():
        try:
            next(legacy_paper.iterdir())
        except StopIteration:
            legacy_paper.rmdir()
            removed.append("paper/")


def migrate_legacy_control_files(
    root: Path, created: list[str], preserved: list[str]
) -> None:
    """Copy legacy 0.8.3 state into .cumcm without deleting user files."""
    destination_root = control_directory(root)
    for legacy_name, current_name in LEGACY_CONTROL_FILES.items():
        source = root / "paper" / legacy_name
        target = destination_root / current_name
        if target.exists():
            preserved.append(target.relative_to(root).as_posix())
        elif source.is_file() and not source.is_symlink():
            shutil.copy2(source, target)
            created.append(target.relative_to(root).as_posix())


def read_declared_count(root: Path) -> int:
    path = control_path(
        root,
        "project.json",
        delivery_directory(root) / "question-count.json",
    )
    if not path.is_file():
        return 0
    try:
        count = int(json.loads(path.read_text(encoding="utf-8")).get("questions", 0))
    except (OSError, ValueError, json.JSONDecodeError):
        return 0
    return count if 1 <= count <= 20 else 0


def copy_template_tree(
    root: Path, created: list[str], preserved: list[str]
) -> None:
    for source in TEMPLATE_ROOT.rglob("*"):
        if not source.is_file():
            continue
        relative = source.relative_to(TEMPLATE_ROOT)
        target = root / relative
        target.parent.mkdir(parents=True, exist_ok=True)
        if target.exists():
            preserved.append(relative.as_posix())
        else:
            shutil.copy2(source, target)
            created.append(relative.as_posix())


def create_question_files(
    root: Path,
    count: int,
    created: list[str],
    updated: list[str],
    preserved: list[str],
) -> None:
    for number in range(1, count + 1):
        name = f"q{number}"
        question_code = root / "code" / name
        for directory in (
            question_code,
            root / "results" / name,
            root / "figures" / name,
        ):
            directory.mkdir(parents=True, exist_ok=True)
        write_if_missing(
            root,
            root / "code" / name / "main.py",
            question_main(),
            created,
            preserved,
        )
        substantive_modules = [
            path
            for path in question_code.glob("*.py")
            if path.name not in {"__init__.py", "main.py"}
        ]
        if not substantive_modules:
            for filename, content in question_modules(name).items():
                write_if_missing(
                    root,
                    question_code / filename,
                    content,
                    created,
                    preserved,
                )

    legacy_sections = delivery_directory(root) / "sections"
    if legacy_sections.is_dir():
        create_legacy_question_sections(
            root, count, created, updated, preserved
        )
    else:
        merge_questions_into_main(root, count, updated)
    merge_run_all(root, count, created, updated)
    write_project_manifest(root, count, created, updated)


def create_legacy_question_sections(
    root: Path,
    count: int,
    created: list[str],
    updated: list[str],
    preserved: list[str],
) -> None:
    for number in range(1, count + 1):
        write_if_missing(
            root,
            delivery_directory(root) / "sections" / f"q{number}.tex",
            question_tex(number),
            created,
            preserved,
        )
    path = delivery_directory(root) / "sections" / "questions.tex"
    if not path.exists():
        path.write_text(
            "".join(f"\\input{{sections/q{i}}}\n" for i in range(1, count + 1)),
            encoding="utf-8",
        )
        created.append(path.relative_to(root).as_posix())
        return
    content = path.read_text(encoding="utf-8")
    additions = [
        f"\\input{{sections/q{i}}}"
        for i in range(1, count + 1)
        if not re.search(rf"\\input\{{sections/q{i}\}}", content)
    ]
    if additions:
        path.write_text(
            content.rstrip() + "\n" + "\n".join(additions) + "\n",
            encoding="utf-8",
        )
        updated.append(path.relative_to(root).as_posix())


def merge_questions_into_main(root: Path, count: int, updated: list[str]) -> None:
    path = delivery_directory(root) / "main.tex"
    if not path.is_file():
        raise SystemExit(f"Missing compact happy template: {path}")
    content = path.read_text(encoding="utf-8")
    if QUESTION_BEGIN not in content or QUESTION_END not in content:
        print(
            "[WARN] Preserved custom happy/main.tex without Orbit question markers; "
            "add missing question sections manually."
        )
        return
    additions = [
        question_tex(number).rstrip()
        for number in range(1, count + 1)
        if not re.search(rf"\\section\{{问题{number}(?:[：:]|\}})", content)
    ]
    if not additions:
        return
    insertion = "\n\n".join(additions) + "\n"
    content = content.replace(QUESTION_END, insertion + QUESTION_END, 1)
    path.write_text(content, encoding="utf-8")
    updated.append(path.relative_to(root).as_posix())


def merge_run_all(
    root: Path, count: int, created: list[str], updated: list[str]
) -> None:
    path = root / "code" / "run_all.py"
    if not path.exists():
        path.write_text(run_all(count), encoding="utf-8")
        created.append(path.relative_to(root).as_posix())
        return
    content = path.read_text(encoding="utf-8")
    missing = [
        f"q{i}.main"
        for i in range(1, count + 1)
        if f'"q{i}.main"' not in content and f"'q{i}.main'" not in content
    ]
    if not missing:
        return
    match = re.search(r"(?ms)(^\s*modules\s*=\s*\[.*?)(^\s*\])", content)
    if not match:
        print(
            f"[WARN] Preserved custom run_all.py; add manually: {', '.join(missing)}"
        )
        return
    indent = re.match(r"\s*", match.group(2)).group(0)
    rows = "".join(f'{indent}    "{module}",\n' for module in missing)
    content = content[: match.start(2)] + rows + content[match.start(2) :]
    path.write_text(content, encoding="utf-8")
    updated.append(path.relative_to(root).as_posix())


def write_project_manifest(
    root: Path, count: int, created: list[str], updated: list[str]
) -> None:
    path = control_directory(root) / "project.json"
    existing: dict[str, object] = {}
    if path.is_file():
        try:
            payload = json.loads(path.read_text(encoding="utf-8"))
            if isinstance(payload, dict):
                existing = payload
        except (OSError, json.JSONDecodeError):
            pass
    existing["schema_version"] = 1
    existing["layout"] = (
        "legacy-v1"
        if (delivery_directory(root) / "sections").is_dir()
        else "compact-v2"
    )
    existing["questions"] = count
    existing["support_paths"] = [
        item
        for i in range(1, count + 1)
        for item in (f"code/q{i}", f"results/q{i}", f"figures/q{i}")
    ]
    rendered = json.dumps(existing, ensure_ascii=False, indent=2) + "\n"
    if path.exists() and path.read_text(encoding="utf-8") == rendered:
        return
    was_present = path.exists()
    path.write_text(rendered, encoding="utf-8")
    (updated if was_present else created).append(path.relative_to(root).as_posix())


def extend_evidence_map(
    root: Path, count: int, created: list[str], updated: list[str]
) -> None:
    path = control_path(
        root,
        "evidence-map.yaml",
        delivery_directory(root) / "evidence-map.yaml",
    )
    content = (
        path.read_text(encoding="utf-8")
        if path.exists()
        else "# Claims must resolve to program-generated evidence.\n"
    )
    additions: list[str] = []
    for i in range(1, count + 1):
        if not re.search(rf"(?m)^q{i}:\s*$", content):
            additions.extend(
                [
                    f"q{i}:",
                    "  claims:",
                    f"    - id: q{i}-main-result",
                    f"      generated_by: code/q{i}/main.py",
                    f"      source: results/q{i}/TODO-替换为实际中文结果文件",
                    "      paper_section: happy/main.tex",
                    "      upstream: TODO",
                    "      validation: TODO",
                    "      status: TODO",
                ]
            )
    if not additions:
        return
    rendered = content.rstrip() + "\n" + "\n".join(additions) + "\n"
    existed = path.exists()
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(rendered, encoding="utf-8")
    (updated if existed else created).append(path.relative_to(root).as_posix())


def write_if_missing(
    root: Path,
    path: Path,
    content: str,
    created: list[str],
    preserved: list[str],
) -> None:
    relative = path.relative_to(root).as_posix()
    if path.exists():
        preserved.append(relative)
        return
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(content, encoding="utf-8")
    created.append(relative)


def question_main() -> str:
    return '''from __future__ import annotations

import os
import sys

os.environ["PYTHONDONTWRITEBYTECODE"] = "1"
sys.dont_write_bytecode = True

if __package__:
    from .data_preparation import prepare_inputs
    from .evaluation import evaluate_and_report
    from .solver import solve
else:
    from data_preparation import prepare_inputs
    from evaluation import evaluate_and_report
    from solver import solve


def main() -> None:
    inputs = prepare_inputs()
    solution = solve(inputs)
    evaluate_and_report(inputs, solution)


if __name__ == "__main__":
    main()
'''


def question_modules(name: str) -> dict[str, str]:
    """提供可运行职责骨架；读题后必须改成领域化模块与真实实现。"""
    return {
        "data_preparation.py": f'''from __future__ import annotations


def prepare_inputs():
    # TODO[{name}] 读取题目附件、校验字段、单位和缺失值；完成后删除本标记。
    raise NotImplementedError("请实现问题{name}的数据准备")
''',
        "solver.py": f'''from __future__ import annotations


def solve(inputs):
    # TODO[{name}] 按本题实际方法实现模型、算法和边界条件；完成后删除本标记。
    raise NotImplementedError("请实现问题{name}的求解器")
''',
        "evaluation.py": f'''from __future__ import annotations


def evaluate_and_report(inputs, solution) -> None:
    # TODO[{name}] 完成验证，并输出中文命名的CSV/XLSX及300 dpi PNG图。
    raise NotImplementedError("请实现问题{name}的评价与报告")
''',
    }


def question_tex(number: int) -> str:
    return rf'''\section{{问题{number}：TODO[写明本题目标]}}

\subsection{{目标、输入与问题接口}}
\TODO{{明确本题交付、输入、单位及其与前后小题的数据关系；成稿时把本标题改成领域化标题。}}

\subsection{{方法比较与选择依据}}
\TODO{{比较候选方法，说明所选方法为何匹配数据、约束和决策目标。}}

\subsection{{模型构建与参数来源}}
\TODO{{定义变量、目标函数、约束和参数来源，保持符号、单位与代码一致。}}

\subsection{{求解流程与实现口径}}
\TODO{{说明算法步骤、数据切分、边界处理及结果文件的生成路径。}}

\subsection{{结果解释与有效性检验}}
\TODO{{从 results/q{number}/ 引用实际中文结果文件和 figures/q{number}/ 的描述性中文图件，解释结果并报告误差、敏感性、稳健性或基线比较。}}

\subsection{{本问结论与后续接口}}
\TODO{{用两三句话直接回答本题，并说明输出如何进入下一问；成稿时按实际内容改名。}}
'''


def run_all(count: int) -> str:
    rows = "".join(f'        "q{i}.main",\n' for i in range(1, count + 1))
    return f'''from __future__ import annotations

import importlib
import os
import sys
from pathlib import Path

CODE_ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(CODE_ROOT))
os.environ["PYTHONDONTWRITEBYTECODE"] = "1"
sys.dont_write_bytecode = True


def main() -> None:
    modules = [
{rows}    ]
    for module in modules:
        print(f"[RUN] {{module.split('.', maxsplit=1)[0]}}")
        importlib.import_module(module).main()
    print(f"[OK] All questions completed: {{CODE_ROOT.parent}}")


if __name__ == "__main__":
    main()
'''


if __name__ == "__main__":
    main()
