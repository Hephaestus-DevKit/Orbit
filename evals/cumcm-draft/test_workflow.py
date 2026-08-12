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
SKILL_ROOT = REPOSITORY_ROOT / "packages" / "cli" / "skills" / "cumcm-draft"
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
            self.assertTrue((root / "code" / "always").is_dir())
            self.assertFalse((root / "results" / "always").exists())
            self.assertFalse((root / "results" / "shared").exists())
            model = root / "code" / "q1" / "forecasting.py"
            authored = "# authored and preserved\n"
            model.write_text(authored, encoding="utf-8")
            run_script("bootstrap_project.py", root, "--questions", "3")
            self.assertEqual(model.read_text(encoding="utf-8"), authored)
            count = json.loads((root / "paper" / "question-count.json").read_text(encoding="utf-8"))
            self.assertEqual(count["questions"], 3)
            questions = (root / "paper" / "sections" / "questions.tex").read_text(encoding="utf-8")
            runner = (root / "code" / "run_all.py").read_text(encoding="utf-8")
            evidence = (root / "paper" / "evidence-map.yaml").read_text(encoding="utf-8")
            scaffold_main = (root / "code" / "q1" / "main.py").read_text(encoding="utf-8")
            for number in (1, 2, 3):
                self.assertEqual(questions.count(f"sections/q{number}"), 1)
                self.assertEqual(runner.count(f'"q{number}.main"'), 1)
                self.assertEqual(evidence.count(f"q{number}:"), 1)
            self.assertIn("generated_by: code/q1/main.py", evidence)
            self.assertIn("upstream: TODO", evidence)
            self.assertIn("validation: TODO", evidence)
            self.assertIn('"selection_data": "TODO"', scaffold_main)
            self.assertFalse((root / "code" / "q1" / "model.py").exists())
            self.assertFalse((root / "code" / "q1" / "output.py").exists())
            outline = (root / "paper" / "sections" / "q1.tex").read_text(encoding="utf-8")
            self.assertEqual(outline.count(r"\subsection{"), 6)
            self.assertIn(r"\subsection{方法比较与选择依据}", outline)
            self.assertIn(r"\subsection{求解流程与实现口径}", outline)
            self.assertIn(r"\subsection{本问结论与后续接口}", outline)
            self.assertNotIn(r"\subsection{方法选择与模型建立}", outline)
            self.assertNotIn(r"\subsection{结果与解释}", outline)

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
            profile_path = root / "paper" / "contest-profile.json"
            profile = json.loads(profile_path.read_text(encoding="utf-8"))
            profile["ai"]["details_pdf_required"] = True
            profile_path.write_text(json.dumps(profile, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
            (root / "paper" / "AI工具使用详情.pdf").write_bytes(b"%PDF-1.4\n%%EOF\n")
            run_script("evidence_freeze.py", root, "--write")
            run_script("package_support.py", root)
            with zipfile.ZipFile(root / "paper" / "support-materials.zip") as archive:
                names = archive.namelist()
            self.assertIn("paper/AI工具使用详情.pdf", names)
            self.assertIn("paper/evidence-freeze.json", names)
            self.assertNotIn("paper/ai-use-log.md", names)
            self.assertFalse(any(name.startswith("question/") for name in names))
            validator = load_script("validate_project.py")
            self.assertEqual(
                set(names),
                validator.expected_support_names(root, profile["ai"], profile["support"]),
            )

    def test_default_profile_encodes_current_cumcm_contract(self) -> None:
        project_utils = load_script("project_utils.py")
        profile = project_utils.DEFAULT_PROFILE
        self.assertEqual(profile["profile"], "cumcm-2026")
        self.assertEqual(profile["paper"]["max_pdf_mb"], 20)
        self.assertEqual(profile["paper"]["max_body_pages"], 30)
        self.assertTrue(profile["paper"]["include_support_file_list"])
        self.assertTrue(profile["paper"]["include_source_appendix"])
        self.assertTrue(profile["ai"]["inline_markers_required"])
        self.assertTrue(profile["ai"]["reference_entry_required"])
        self.assertTrue(profile["ai"]["details_pdf_required"])

    def test_cumcm_margin_parser_rejects_subminimum_margins(self) -> None:
        validator = load_script("validate_project.py")
        self.assertIsNone(validator.cumcm_margin_error(r"\usepackage[a4paper,margin=2.5cm]{geometry}"))
        self.assertIsNotNone(validator.cumcm_margin_error(r"\usepackage[a4paper,margin=2.49cm]{geometry}"))

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
            (root / "code" / "q1" / "forecasting.py").write_text("VALUE = 1\n", encoding="utf-8")
            (root / "code" / "q1" / "__pycache__" / "forecasting.pyc").write_bytes(b"cache")
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
            self.assertIn("code/q1/forecasting.py", report["inventory"]["code"])
            self.assertFalse(any("__pycache__" in path or path.endswith(".pyc") for path in report["inventory"]["code"]))
            self.assertFalse(any(item["kind"] == "missing_reasoning_stage" for item in report["findings"]))

    def test_audit_flags_coarse_or_generic_question_outlines(self) -> None:
        audit = load_script("audit_paper.py")
        generic = "\n".join(
            [
                r"\section{问题1}",
                r"\subsection{题意、变量与约束}",
                r"\subsection{方法选择与模型建立}",
                r"\subsection{结果与解释}",
                r"\subsection{验证、小结与衔接}",
                "变量 模型 结果 验证 " * 100,
            ]
        )
        kinds = {item["kind"] for item in audit.question_outline_findings("q1.tex", generic)}
        self.assertIn("generic_question_outline", kinds)

        coarse = r"\section{问题1}\subsection{模型与结果}" + "变量 模型 结果 验证 " * 200
        kinds = {item["kind"] for item in audit.question_outline_findings("q1.tex", coarse)}
        self.assertIn("coarse_question_outline", kinds)

    def test_templates_prevent_disclosure_orphans_and_cover_unicode_code(self) -> None:
        disclosure = (SKILL_ROOT / "assets" / "project-template" / "paper" / "AI工具使用详情.tex").read_text(encoding="utf-8")
        self.assertLess(disclosure.index(r"\section{关键交互记录}"), disclosure.index(r"\section{采纳、人工修改与核验}"))
        main = (SKILL_ROOT / "assets" / "project-template" / "paper" / "main.tex").read_text(encoding="utf-8")
        self.assertIn("JuliaMono", main)
        self.assertIn("DejaVu Sans Mono", main)
        self.assertIn(r"\usepackage{listings}", main)
        self.assertIn(r"\newcommand{\AIUseMark}", main)

    def test_generated_appendix_groups_exact_support_inventory_and_runnable_sources(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            run_script("bootstrap_project.py", root, "--questions", "1")
            (root / "code" / "q1" / "sales_analysis.py").write_text("VALUE = 1\n", encoding="utf-8")
            (root / "code" / "finalize.py").write_text("raise SystemExit\n", encoding="utf-8")

            module = load_script("build_paper.py")
            module.generate_appendices(root, module.load_profile(root))

            support = (root / "paper" / "sections" / "support-files.tex").read_text(encoding="utf-8")
            source = (root / "paper" / "sections" / "source-code.tex").read_text(encoding="utf-8")
            self.assertIn("支撑材料文件列表", support)
            self.assertIn(r"\begin{longtable}", support)
            self.assertIn("code/q1", support)
            self.assertIn("sales_analysis.py", support)
            self.assertIn(r"\path{paper}", support)
            self.assertIn("evidence-freeze.json", support)
            self.assertIn("完整可运行程序代码", source)
            self.assertIn(r"\lstinputlisting", source)
            self.assertIn("code/q1/sales_analysis.py", source)
            self.assertNotIn("code/finalize.py", source)
            self.assertNotIn("code/q1/__init__.py", source)
            self.assertNotIn(r"\VerbatimInput", source)

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

    def test_code_architecture_audit_flags_only_review_hostile_layouts(self) -> None:
        validator = load_script("validate_project.py")
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            generic = root / "code" / "q1"
            generic.mkdir(parents=True)
            for name in ("main.py", "model.py", "output.py"):
                (generic / name).write_text("VALUE = 1\n", encoding="utf-8")
            warnings = validator.code_architecture_warnings(root, 1)
            self.assertTrue(any("generic main.py" in item for item in warnings))

            for path in generic.glob("*.py"):
                path.unlink()
            (generic / "main.py").write_text("# 只负责串联流程。\n", encoding="utf-8")
            (generic / "forecasting.py").write_text("# 防止时间泄漏。\n", encoding="utf-8")
            (generic / "evaluation.py").write_text("# 统一评估口径。\n", encoding="utf-8")
            self.assertEqual(validator.code_architecture_warnings(root, 1), [])

    def test_delivery_hygiene_audit_flags_nested_archives_and_scratch_helpers(self) -> None:
        validator = load_script("validate_project.py")
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "code" / "q1").mkdir(parents=True)
            (root / "results" / "q1").mkdir(parents=True)
            (root / "figures" / "q1").mkdir(parents=True)
            (root / "code" / "q1" / "module.zip").write_bytes(b"archive")
            (root / "code" / "verify_results.py").write_text("pass\n", encoding="utf-8")
            (root / "code.zip").write_bytes(b"duplicate")
            (root / "tmp").mkdir()
            (root / "tmp" / "contact.png").write_bytes(b"render")

            warnings = validator.delivery_hygiene_warnings(root)
            self.assertTrue(any("nested project archive" in item for item in warnings))
            self.assertTrue(any("authoring-only helper" in item for item in warnings))
            self.assertTrue(any("duplicate directory archive" in item for item in warnings))
            self.assertTrue(any("non-empty tmp/" in item for item in warnings))

            (root / "code" / "q1" / "module.zip").unlink()
            (root / "code" / "verify_results.py").unlink()
            (root / "code.zip").unlink()
            (root / "tmp" / "contact.png").unlink()
            self.assertEqual(validator.delivery_hygiene_warnings(root), [])

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
            profile_path = root / "paper" / "contest-profile.json"
            profile = json.loads(profile_path.read_text(encoding="utf-8"))
            profile["ai"]["details_pdf_required"] = True
            profile_path.write_text(json.dumps(profile, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
            (root / "question" / "data.csv").write_text("x,y\n1,2\n2,4\n", encoding="utf-8")
            run_script("inspect_inputs.py", root)
            main = root / "code" / "q1" / "main.py"
            main.write_text(
                "from __future__ import annotations\n\n"
                "import json\n"
                "from always.config import question_output_dirs\n\n"
                "def main() -> None:\n"
                "    results_dir, figure_dir = question_output_dirs('q1')\n"
                "    results_dir.mkdir(parents=True, exist_ok=True)\n"
                "    figure_dir.mkdir(parents=True, exist_ok=True)\n"
                "    # 本测试使用已核验的线性关系。\n"
                "    summary = {'question': 'q1', 'status': 'verified', 'slope': 2.0, 'claims': ['linear']}\n"
                "    (results_dir / 'summary.json').write_text(json.dumps(summary) + '\\n', encoding='utf-8')\n\n"
                "if __name__ == '__main__':\n"
                "    main()\n",
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
                env={**os.environ, "CUMCM_DRAFT_SKILL_ROOT": str(SKILL_ROOT)},
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
