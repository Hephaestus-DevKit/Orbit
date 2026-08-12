from __future__ import annotations

import argparse
import json
import re
import shutil
from pathlib import Path

from project_utils import question_numbers


SKILL_ROOT = Path(__file__).resolve().parents[1]
TEMPLATE_ROOT = SKILL_ROOT / "assets" / "project-template"


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Create or extend a non-destructive modeling project skeleton."
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
    for directory in (
        root / "question",
        root / "code" / "always",
        root / "paper" / "sections",
        root / "paper" / "build",
    ):
        directory.mkdir(parents=True, exist_ok=True)

    declared = read_declared_count(root)
    discovered = max(question_numbers(root), default=0)
    question_count = max(args.questions, declared, discovered)
    copy_template_tree(root, created, preserved)
    create_question_files(root, question_count, created, updated, preserved)
    extend_evidence_map(root, question_count, created, updated)

    print(f"[OK] Project skeleton ready: {root}")
    print(
        f"  Questions: {question_count}; created {len(created)}, "
        f"updated {len(updated)}, preserved {len(preserved)} file(s)."
    )
    if updated:
        print("  Updated orchestrators: " + ", ".join(updated))


def read_declared_count(root: Path) -> int:
    path = root / "paper" / "question-count.json"
    if not path.is_file():
        return 0
    try:
        count = int(json.loads(path.read_text(encoding="utf-8")).get("questions", 0))
    except (OSError, ValueError, json.JSONDecodeError):
        return 0
    return count if 1 <= count <= 20 else 0


def copy_template_tree(root: Path, created: list[str], preserved: list[str]) -> None:
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
        for directory in (root / "code" / name, root / "results" / name, root / "figures" / name):
            directory.mkdir(parents=True, exist_ok=True)
        files = {
            root / "code" / name / "__init__.py": "",
            root / "code" / name / "main.py": question_main(name),
            root / "paper" / "sections" / f"{name}.tex": question_tex(number),
        }
        for path, content in files.items():
            write_if_missing(root, path, content, created, preserved)

    merge_questions_tex(root, count, created, updated)
    merge_run_all(root, count, created, updated)
    write_count(root, count, created, updated)


def merge_questions_tex(root: Path, count: int, created: list[str], updated: list[str]) -> None:
    path = root / "paper" / "sections" / "questions.tex"
    if not path.exists():
        path.write_text("".join(f"\\input{{sections/q{i}}}\n" for i in range(1, count + 1)), encoding="utf-8")
        created.append(path.relative_to(root).as_posix())
        return
    content = path.read_text(encoding="utf-8")
    additions = [f"\\input{{sections/q{i}}}" for i in range(1, count + 1) if not re.search(rf"\\input\{{sections/q{i}\}}", content)]
    if additions:
        path.write_text(content.rstrip() + "\n" + "\n".join(additions) + "\n", encoding="utf-8")
        updated.append(path.relative_to(root).as_posix())


def merge_run_all(root: Path, count: int, created: list[str], updated: list[str]) -> None:
    path = root / "code" / "run_all.py"
    if not path.exists():
        path.write_text(run_all(count), encoding="utf-8")
        created.append(path.relative_to(root).as_posix())
        return
    content = path.read_text(encoding="utf-8")
    missing = [f'q{i}.main' for i in range(1, count + 1) if f'"q{i}.main"' not in content and f"'q{i}.main'" not in content]
    if not missing:
        return
    match = re.search(r"(?ms)(^\s*modules\s*=\s*\[.*?)(^\s*\])", content)
    if not match:
        print(f"[WARN] Preserved custom run_all.py; add manually: {', '.join(missing)}")
        return
    indent = re.match(r"\s*", match.group(2)).group(0)
    rows = "".join(f'{indent}    "{module}",\n' for module in missing)
    content = content[: match.start(2)] + rows + content[match.start(2) :]
    path.write_text(content, encoding="utf-8")
    updated.append(path.relative_to(root).as_posix())


def write_count(root: Path, count: int, created: list[str], updated: list[str]) -> None:
    path = root / "paper" / "question-count.json"
    existing: dict[str, object] = {}
    if path.is_file():
        try:
            payload = json.loads(path.read_text(encoding="utf-8"))
            if isinstance(payload, dict):
                existing = payload
        except (OSError, json.JSONDecodeError):
            pass
    existing["questions"] = count
    existing["support_paths"] = [item for i in range(1, count + 1) for item in (f"code/q{i}", f"results/q{i}", f"figures/q{i}")]
    rendered = json.dumps(existing, ensure_ascii=False, indent=2) + "\n"
    if path.exists() and path.read_text(encoding="utf-8") == rendered:
        return
    was_present = path.exists()
    path.write_text(rendered, encoding="utf-8")
    (updated if was_present else created).append(path.relative_to(root).as_posix())


def extend_evidence_map(root: Path, count: int, created: list[str], updated: list[str]) -> None:
    path = root / "paper" / "evidence-map.yaml"
    content = path.read_text(encoding="utf-8") if path.exists() else "# Claims must resolve to program-generated evidence.\n"
    additions: list[str] = []
    for i in range(1, count + 1):
        if not re.search(rf"(?m)^q{i}:\s*$", content):
            additions.extend(
                [
                    f"q{i}:",
                    "  claims:",
                    f"    - id: q{i}-main-result",
                    f"      generated_by: code/q{i}/main.py",
                    f"      source: results/q{i}/summary.json",
                    f"      paper_section: paper/sections/q{i}.tex",
                    "      upstream: TODO",
                    "      validation: TODO",
                    "      status: TODO",
                ]
            )
    if not additions:
        return
    rendered = content.rstrip() + "\n" + "\n".join(additions) + "\n"
    existed = path.exists()
    path.write_text(rendered, encoding="utf-8")
    (updated if existed else created).append(path.relative_to(root).as_posix())


def write_if_missing(root: Path, path: Path, content: str, created: list[str], preserved: list[str]) -> None:
    relative = path.relative_to(root).as_posix()
    if path.exists():
        preserved.append(relative)
        return
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(content, encoding="utf-8")
    created.append(relative)


def question_main(name: str) -> str:
    return f'''from __future__ import annotations

import json

from always.config import question_output_dirs


def main() -> None:
    results_dir, figure_dir = question_output_dirs("{name}")
    results_dir.mkdir(parents=True, exist_ok=True)
    figure_dir.mkdir(parents=True, exist_ok=True)

    # 脚手架只保留入口；读题后请创建按实际职责命名的领域模块。
    summary = {{
        "question": "{name}",
        "status": "TODO",
        "validation": {{"selection_data": "TODO", "test_data": "TODO", "checks": []}},
        "claims": [],
    }}
    (results_dir / "summary.json").write_text(
        json.dumps(summary, ensure_ascii=False, indent=2) + "\\n",
        encoding="utf-8",
    )
    print("[OK] {name} scaffold completed")


if __name__ == "__main__":
    main()
'''


def question_tex(number: int) -> str:
    return rf'''\section{{问题{number}：TODO[写明本题目标]}}

\subsection{{目标、输入与问题接口}}
\TODO{{明确本题交付、输入、单位及其与前后小题的数据关系；成稿时把本标题改成领域化标题。}}

\subsection{{方法比较与选择依据}}
\TODO{{比较候选方法，说明所选方法为何匹配数据、约束和决策目标。}}\AIUseMark

\subsection{{模型构建与参数来源}}
\TODO{{定义变量、目标函数、约束和参数来源，保持符号、单位与代码一致。}}

\subsection{{求解流程与实现口径}}
\TODO{{说明算法步骤、数据切分、边界处理及结果文件的生成路径。}}

\subsection{{结果解释与有效性检验}}
\TODO{{从 results/q{number}/ 引用实际数值和 figures/q{number}/ 的当前图，解释结果并报告误差、敏感性、稳健性或基线比较。}}

\subsection{{本问结论与后续接口}}
\TODO{{用两三句话直接回答本题，并说明输出如何进入下一问；成稿时按实际内容改名。}}
'''


def run_all(count: int) -> str:
    rows = "".join(f'        "q{i}.main",\n' for i in range(1, count + 1))
    return f'''from __future__ import annotations

import importlib
import sys
from pathlib import Path

CODE_ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(CODE_ROOT))
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
