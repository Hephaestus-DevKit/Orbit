from __future__ import annotations

import json
import os
import shutil
import subprocess
import sys
import tempfile
import zipfile
from pathlib import Path
from typing import Any


sys.dont_write_bytecode = True
os.environ.setdefault("PYTHONDONTWRITEBYTECODE", "1")


REPOSITORY_ROOT = Path(__file__).resolve().parents[2]
SKILL_ROOT = REPOSITORY_ROOT / "packages" / "cli" / "skills" / "cumcm-draft"
EXPECTED_PROVIDER = "tokendance"
EXPECTED_MODEL = "deepseek-v4-flash"


def create_problem(root: Path) -> None:
    question = root / "question"
    question.mkdir(parents=True)
    statement = (
        "单变量线性关系建模题。附件 data.csv 给出时刻 t 与观测值 y。"
        "建立可解释的线性模型，估计参数，预测 t=5 时的 y，并用残差或拟合优度验证模型。"
        "要求给出完整一问论文、可运行代码、机器可读结果、图、AI工具使用声明和支撑材料。"
    )
    content_types = """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>"""
    relationships = """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>"""
    document_xml = f"""<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body><w:p><w:r><w:t>{statement}</w:t></w:r></w:p><w:sectPr/></w:body>
</w:document>"""
    with zipfile.ZipFile(question / "problem.docx", "w", zipfile.ZIP_DEFLATED) as archive:
        archive.writestr("[Content_Types].xml", content_types)
        archive.writestr("_rels/.rels", relationships)
        archive.writestr("word/document.xml", document_xml)
    (question / "data.csv").write_text("t,y\n0,1\n1,3\n2,5\n3,7\n", encoding="utf-8")


def write_verifier(root: Path) -> None:
    validator = SKILL_ROOT / "scripts" / "validate_project.py"
    code = f'''from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

ROOT = Path(sys.argv[1]).resolve()
required = [
    ROOT / "paper" / "main.pdf",
    ROOT / "paper" / "AI工具使用详情.pdf",
    ROOT / "paper" / "support-materials.zip",
    ROOT / "paper" / "build" / "revision-audit.json",
    ROOT / "results" / "q1" / "summary.json",
]
missing = [str(path.relative_to(ROOT)) for path in required if not path.is_file() or path.stat().st_size == 0]
if missing:
    raise SystemExit("missing final artifacts: " + ", ".join(missing))

def numbers(value: object) -> list[float]:
    if isinstance(value, bool):
        return []
    if isinstance(value, (int, float)):
        return [float(value)]
    if isinstance(value, dict):
        return [number for item in value.values() for number in numbers(item)]
    if isinstance(value, list):
        return [number for item in value for number in numbers(item)]
    return []

summary = json.loads((ROOT / "results" / "q1" / "summary.json").read_text(encoding="utf-8"))
if not any(abs(value - 11.0) < 1e-9 for value in numbers(summary)):
    raise SystemExit("summary.json does not contain the program-derived t=5 prediction 11")
audit = json.loads((ROOT / "paper" / "build" / "revision-audit.json").read_text(encoding="utf-8"))
if not audit.get("rendered_pages"):
    raise SystemExit("final PDF pages were not rendered for visual review")
completed = subprocess.run(
    [sys.executable, {str(validator)!r}, str(ROOT), "--strict"],
    stdout=subprocess.PIPE,
    stderr=subprocess.STDOUT,
    text=True,
    encoding="utf-8",
    errors="replace",
    check=False,
)
print(completed.stdout)
raise SystemExit(completed.returncode)
'''
    orbit_dir = root / ".orbit"
    orbit_dir.mkdir(parents=True, exist_ok=True)
    (orbit_dir / "verify_delivery.py").write_text(code, encoding="utf-8")


def write_suite(root: Path) -> None:
    prompt = (
        "显式使用 $cumcm-draft，一键完整处理当前项目。脚手架和 input-inventory 已准备好；"
        "不要读取 Skill 脚本、测试脚本或全部模板，立即批量写入。"
        "题意是对 (t,y)=(0,1),(1,3),(2,5),(3,7) 建立线性模型并预测 t=5。"
        "不要再解压 DOCX、不要逐个阅读可选 references、不要联网、不要调用子代理，"
        "不要切换或路由到其他模型。请直接完成一问的建模、"
        "代码、实际运行、JSON 结果、图、完整中文 LaTeX 论文、2026 CUMCM AI 使用声明和详情 PDF。"
        "当前 python 没有 numpy/pandas/matplotlib；不要探测或安装依赖，本题直接使用标准库。"
        "最后直接运行 python code/finalize.py --run-code --strict-layout --render-pages 真实编译并严格校验，"
        "不要阅读 finalize.py 或其 Skill 实现；finalizer 返回 0 后立即给最终答复，"
        "不得再写临时验证脚本、查看 build 缓存或重复检查 PDF。"
        "不得停在脚手架或提纲，不得保留 TODO，不得编造程序未产生的数值。"
        "请分批完成独立读写，减少工具轮次；每轮最多四个写入/编辑工具调用，"
        "不要把全项目塞进一个超长模型输出，完成一批后继续下一批；不要修改 question/。"
    )
    suite = {
        "schemaVersion": 1,
        "name": "cumcm-draft Tokendance Flash smoke",
        "tasks": [
            {
                "id": "complete-linear-paper",
                "prompt": prompt,
                "mode": "single",
                "verification": [
                    {
                        "name": "strict complete paper verifier",
                        "command": f'python "{root / ".orbit" / "verify_delivery.py"}" .',
                        "timeoutMs": 180000,
                    }
                ],
                "forbiddenChangedFiles": [
                    "question/problem.docx",
                    "question/data.csv",
                ],
                "maxChangedFiles": 100,
            }
        ],
    }
    orbit_dir = root / ".orbit"
    orbit_dir.mkdir(parents=True, exist_ok=True)
    (orbit_dir / "smoke-suite.json").write_text(json.dumps(suite, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def run_checked(command: list[str], root: Path) -> None:
    completed = subprocess.run(command, cwd=root, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, encoding="utf-8", errors="replace", check=False)
    if completed.returncode:
        raise SystemExit(f"Fixture command failed ({' '.join(command)}):\n{completed.stdout}")


def event_identities(trace: dict[str, Any]) -> tuple[set[str], set[str]]:
    providers: set[str] = set()
    models: set[str] = set()
    session = trace.get("session")
    if isinstance(session, dict):
        if isinstance(session.get("provider"), str):
            providers.add(session["provider"])
        if isinstance(session.get("model"), str):
            models.add(session["model"])
    for event in trace.get("events", []):
        if not isinstance(event, dict):
            continue
        payload = event.get("payload")
        if not isinstance(payload, dict):
            continue
        provider = payload.get("provider")
        if isinstance(provider, str):
            providers.add(provider)
        for key in ("model", "requestedModel", "resolvedModel"):
            model = payload.get(key)
            if isinstance(model, str):
                models.add(model)
    return providers, models


def main() -> None:
    node = shutil.which("node.exe") or shutil.which("node")
    orbit_entry = Path.home() / "AppData" / "Roaming" / "npm" / "node_modules" / "@orbit-build" / "cli" / "dist" / "index.js"
    if not node or not orbit_entry.is_file():
        raise SystemExit("Could not resolve the installed Orbit CLI runtime")
    with tempfile.TemporaryDirectory(prefix="cumcm-draft-model-smoke-") as directory:
        root = Path(directory)
        create_problem(root)
        run_checked([sys.executable, str(SKILL_ROOT / "scripts" / "bootstrap_project.py"), str(root), "--questions", "1"], root)
        run_checked([sys.executable, str(SKILL_ROOT / "scripts" / "inspect_inputs.py"), str(root)], root)
        write_verifier(root)
        write_suite(root)
        (root / ".gitignore").write_text(".orbit/\n", encoding="utf-8")
        run_checked(["git", "init", "-q"], root)
        run_checked(["git", "add", "-A"], root)
        run_checked(["git", "-c", "user.name=Orbit Smoke", "-c", "user.email=smoke@orbit.local", "commit", "-q", "--no-verify", "-m", "smoke fixture"], root)

        command = [
            node,
            str(orbit_entry),
            "eval",
            ".orbit/smoke-suite.json",
            "--allow-commands",
            "--provider",
            EXPECTED_PROVIDER,
            "--model",
            EXPECTED_MODEL,
            "--json",
        ]
        try:
            completed = subprocess.run(command, cwd=root, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, encoding="utf-8", errors="replace", timeout=900, check=False)
        except subprocess.TimeoutExpired as error:
            raise SystemExit("Orbit eval exceeded the 15-minute smoke-test limit") from error
        print(completed.stdout[-12000:])

        reports = sorted((root / ".orbit" / "evaluations").glob("eval-*.json"))
        if not reports:
            raise SystemExit("Orbit eval did not write an acceptance report")
        report = json.loads(reports[-1].read_text(encoding="utf-8"))
        result = report["results"][0]
        if not isinstance(result.get("traceFile"), str):
            raise SystemExit(
                "Orbit eval failed before writing a model trace: "
                + json.dumps(result.get("checks", []), ensure_ascii=False)
            )
        trace_path = root / result["traceFile"]
        trace = json.loads(trace_path.read_text(encoding="utf-8"))
        providers, models = event_identities(trace)
        if providers != {EXPECTED_PROVIDER}:
            raise SystemExit(f"Unexpected provider identities: {sorted(providers)}")
        if models != {EXPECTED_MODEL}:
            raise SystemExit(f"Unexpected model identities: {sorted(models)}")
        if completed.returncode or not report.get("passed"):
            worktrees = sorted((root / ".orbit" / "worktrees").glob("eval-*"))
            if worktrees:
                failed_root = worktrees[-1]
                print(f"[DEBUG] Failed worktree: {failed_root}")
                for diagnostic in (
                    failed_root / "paper" / "build" / "AI工具使用详情.log",
                    failed_root / "paper" / "build" / "main.log",
                    failed_root / "paper" / "AI工具使用详情.tex",
                ):
                    if diagnostic.is_file():
                        content = diagnostic.read_text(encoding="utf-8", errors="replace")
                        print(f"[DEBUG] {diagnostic.name} tail:\n{content[-8000:]}")
            raise SystemExit("Tokendance model smoke did not pass its complete-paper acceptance gate")
        print(
            "[OK] Tokendance model smoke passed: "
            f"provider={EXPECTED_PROVIDER}, model={EXPECTED_MODEL}, "
            f"changedFiles={len(result.get('changedFiles', []))}"
        )


if __name__ == "__main__":
    main()
