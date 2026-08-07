from __future__ import annotations

import importlib.util
import json
import os
import subprocess
import sys
import tempfile
import unittest
import zipfile
from pathlib import Path
from unittest import mock


sys.dont_write_bytecode = True
os.environ.setdefault("PYTHONDONTWRITEBYTECODE", "1")


REPOSITORY_ROOT = Path(__file__).resolve().parents[2]
SKILL_ROOT = REPOSITORY_ROOT / "packages" / "cli" / "skills" / "math-model-draft"
SCRIPTS = SKILL_ROOT / "scripts"
if str(SCRIPTS) not in sys.path:
    sys.path.insert(0, str(SCRIPTS))


def run_script(name: str, root: Path, *arguments: str, expected: int = 0) -> subprocess.CompletedProcess[str]:
    completed = subprocess.run(
        [sys.executable, str(SCRIPTS / name), str(root), *arguments],
        text=True,
        encoding="utf-8",
        errors="replace",
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        check=False,
    )
    if completed.returncode != expected:
        raise AssertionError(f"{name} returned {completed.returncode}, expected {expected}:\n{completed.stdout}")
    return completed


def load_script(name: str):
    spec = importlib.util.spec_from_file_location(f"math_model_draft_{name}", SCRIPTS / name)
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class WorkflowTests(unittest.TestCase):
    def test_inventory_accepts_a_root_level_problem_pdf(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            problem = root / "problem.pdf"
            problem.write_bytes(b"%PDF-1.4\n%%EOF\n")

            run_script("inspect_inputs.py", root)

            inventory = json.loads((root / "paper" / "input-inventory.json").read_text(encoding="utf-8"))
            baseline = json.loads((root / "paper" / "question-fingerprint.json").read_text(encoding="utf-8"))
            self.assertEqual([item["path"] for item in inventory["files"]], ["problem.pdf"])
            self.assertEqual([item["path"] for item in baseline["files"]], ["problem.pdf"])

    def test_bootstrap_expands_without_overwriting_authored_files(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            run_script("bootstrap_project.py", root, "--questions", "1")
            model = root / "code" / "q1" / "model.py"
            authored = "# authored and preserved\n"
            model.write_text(authored, encoding="utf-8")
            run_script("bootstrap_project.py", root, "--questions", "3")
            self.assertEqual(model.read_text(encoding="utf-8"), authored)
            count = json.loads((root / "paper" / "question-count.json").read_text(encoding="utf-8"))
            self.assertEqual(count["questions"], 3)
            questions = (root / "paper" / "sections" / "questions.tex").read_text(encoding="utf-8")
            runner = (root / "code" / "run_all.py").read_text(encoding="utf-8")
            evidence = (root / "paper" / "evidence-map.yaml").read_text(encoding="utf-8")
            for number in (1, 2, 3):
                self.assertEqual(questions.count(f"sections/q{number}"), 1)
                self.assertEqual(runner.count(f'"q{number}.main"'), 1)
                self.assertEqual(evidence.count(f"q{number}:"), 1)

    def test_bootstrap_never_shrinks_discovered_questions(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            run_script("bootstrap_project.py", root, "--questions", "3")
            run_script("bootstrap_project.py", root, "--questions", "1")
            count = json.loads((root / "paper" / "question-count.json").read_text(encoding="utf-8"))
            self.assertEqual(count["questions"], 3)
            self.assertTrue((root / "code" / "q3" / "main.py").is_file())

    def test_package_excludes_internal_ai_log_by_default(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            run_script("bootstrap_project.py", root, "--questions", "1")
            (root / "paper" / "AI工具使用详情.pdf").write_bytes(b"%PDF-1.4\n%%EOF\n")
            run_script("evidence_freeze.py", root, "--write")
            run_script("package_support.py", root)
            with zipfile.ZipFile(root / "paper" / "support-materials.zip") as archive:
                names = archive.namelist()
            self.assertIn("paper/AI工具使用详情.pdf", names)
            self.assertIn("paper/evidence-freeze.json", names)
            self.assertNotIn("paper/ai-use-log.md", names)
            self.assertFalse(any(name.startswith("question/") for name in names))

    def test_evidence_freeze_blocks_silent_recomputation_and_detects_changes(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "results" / "q1").mkdir(parents=True)
            (root / "figures" / "q1").mkdir(parents=True)
            summary = root / "results" / "q1" / "summary.json"
            summary.write_text('{"status":"verified","value":1}\n', encoding="utf-8")
            (root / "figures" / "q1" / "plot.png").write_bytes(b"plot")

            run_script("evidence_freeze.py", root, "--write")
            blocked = run_script("finalize_project.py", root, "--run-code", expected=1)
            self.assertIn("Evidence is frozen", blocked.stdout)

            summary.write_text('{"status":"verified","value":2}\n', encoding="utf-8")
            changed = run_script("evidence_freeze.py", root, expected=1)
            self.assertIn("changed evidence: results/q1/summary.json", changed.stdout)

    def test_audit_inventory_is_portable_and_excludes_generated_caches(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "problem.pdf").write_bytes(b"%PDF-1.4\n%%EOF\n")
            (root / "code" / "q1" / "__pycache__").mkdir(parents=True)
            (root / "code" / "q1" / "model.py").write_text("VALUE = 1\n", encoding="utf-8")
            (root / "code" / "q1" / "__pycache__" / "model.pyc").write_bytes(b"cache")
            (root / "results" / "q1").mkdir(parents=True)
            (root / "figures" / "q1").mkdir(parents=True)
            (root / "paper" / "sections").mkdir(parents=True)
            (root / "paper" / "main.tex").write_text("正文\n", encoding="utf-8")
            reasoning = "变量 参数 约束 采用 模型 基于 结果 表明 分析 验证 误差 合理 " * 50
            (root / "paper" / "sections" / "q1.tex").write_text(reasoning, encoding="utf-8")
            (root / "paper" / "main.pdf").write_bytes(b"%PDF-1.4\n%%EOF\n")

            run_script("audit_paper.py", root)
            report = json.loads((root / "paper" / "build" / "revision-audit.json").read_text(encoding="utf-8"))
            self.assertEqual(report["inventory"]["problem_and_attachments"], ["problem.pdf"])
            self.assertIn("code/q1/model.py", report["inventory"]["code"])
            self.assertFalse(any("__pycache__" in path or path.endswith(".pyc") for path in report["inventory"]["code"]))
            self.assertFalse(any(item["kind"] == "missing_reasoning_stage" for item in report["findings"]))

    def test_templates_prevent_disclosure_orphans_and_cover_unicode_code(self) -> None:
        disclosure = (SKILL_ROOT / "assets" / "project-template" / "paper" / "AI工具使用详情.tex").read_text(encoding="utf-8")
        self.assertLess(disclosure.index(r"\clearpage"), disclosure.index(r"\section{采纳、人工修改与核验}"))
        main = (SKILL_ROOT / "assets" / "project-template" / "paper" / "main.tex").read_text(encoding="utf-8")
        self.assertIn("JuliaMono", main)
        self.assertIn("DejaVu Sans Mono", main)

    def test_windows_build_prefers_xelatex_over_latexmk(self) -> None:
        module = load_script("build_paper.py")
        with mock.patch.object(module.os, "name", "nt"), mock.patch.object(
            module.shutil,
            "which",
            side_effect=lambda name: "C:/texlive/xelatex.exe" if name == "xelatex" else "C:/texlive/latexmk.exe",
        ):
            command, engine = module.find_engine()
        self.assertEqual(engine, "xelatex")
        self.assertEqual(command[0], "C:/texlive/xelatex.exe")

    def test_path_guard_rejects_escape_and_symlink(self) -> None:
        spec = importlib.util.spec_from_file_location("project_utils", SCRIPTS / "project_utils.py")
        assert spec and spec.loader
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "results").mkdir()
            outside = root.parent / "outside-evidence.json"
            outside.write_text("{}", encoding="utf-8")
            try:
                with self.assertRaises(ValueError):
                    module.ensure_safe_file(root, outside, {"results"})
            finally:
                outside.unlink(missing_ok=True)

    def test_cleaner_preserves_sources_results_figures_and_final_pdf(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            for path in (root / "code", root / "results", root / "figures", root / "paper" / "build"):
                path.mkdir(parents=True, exist_ok=True)
            protected = [root / "code" / "main.py", root / "results" / "result.json", root / "figures" / "plot.png", root / "paper" / "main.tex", root / "paper" / "main.pdf"]
            for path in protected:
                path.write_bytes(b"keep")
            (root / "paper" / "build" / "main.aux").write_text("cache", encoding="utf-8")
            (root / "code" / "__pycache__").mkdir()
            (root / "code" / "__pycache__" / "x.pyc").write_bytes(b"cache")
            run_script("clean_project.py", root, "--apply")
            self.assertTrue(all(path.exists() for path in protected))
            self.assertFalse((root / "paper" / "build" / "main.aux").exists())
            self.assertFalse((root / "code" / "__pycache__").exists())

    def test_complete_one_question_tex_delivery(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            run_script("bootstrap_project.py", root, "--questions", "1")
            (root / "question" / "data.csv").write_text("x,y\n1,2\n2,4\n", encoding="utf-8")
            run_script("inspect_inputs.py", root)
            model = root / "code" / "q1" / "model.py"
            model.write_text(
                "from __future__ import annotations\n\n"
                "def solve() -> dict[str, object]:\n"
                "    return {'question': 'q1', 'status': 'verified', 'slope': 2.0, 'claims': ['linear']}\n",
                encoding="utf-8",
            )
            evidence = root / "paper" / "evidence-map.yaml"
            evidence.write_text(evidence.read_text(encoding="utf-8").replace("status: TODO", "status: verified"), encoding="utf-8")
            for tex in (root / "paper").rglob("*.tex"):
                content = tex.read_text(encoding="utf-8")
                content = __import__("re").sub(r"\\TODO\{[^{}]*\}", "已核验", content)
                content = __import__("re").sub(r"TODO\[[^]]*\]", "基于线性关系的定量分析", content)
                tex.write_text(content, encoding="utf-8")
            completed = subprocess.run(
                [sys.executable, str(root / "code" / "finalize.py"), "--run-code", "--strict-layout", "--render-pages"],
                cwd=root,
                env=os.environ.copy(),
                text=True,
                encoding="utf-8",
                errors="replace",
                stdout=subprocess.PIPE,
                stderr=subprocess.STDOUT,
                check=False,
            )
            if completed.returncode:
                self.fail(f"project-local finalizer returned {completed.returncode}:\n{completed.stdout}")
            self.assertTrue((root / "paper" / "main.pdf").is_file())
            self.assertTrue((root / "paper" / "AI工具使用详情.pdf").is_file())
            report = json.loads((root / "paper" / "build" / "revision-audit.json").read_text(encoding="utf-8"))
            self.assertGreater(len(report["rendered_pages"]), 0)


if __name__ == "__main__":
    unittest.main()
