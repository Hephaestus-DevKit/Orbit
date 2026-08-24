from __future__ import annotations

import importlib.util
import json
import os
import subprocess
import struct
import sys
import tempfile
import unittest
import zipfile
import zlib
from pathlib import Path
from unittest import mock


sys.dont_write_bytecode = True
os.environ.setdefault("PYTHONDONTWRITEBYTECODE", "1")

QUICK_MODE = "--quick" in sys.argv
if QUICK_MODE:
    sys.argv.remove("--quick")


REPOSITORY_ROOT = Path(__file__).resolve().parents[2]
SKILL_ROOT = REPOSITORY_ROOT / "packages" / "cli" / "skills" / "cumcm-draft"
SCRIPTS = SKILL_ROOT / "scripts"
if str(SCRIPTS) not in sys.path:
    sys.path.insert(0, str(SCRIPTS))


def run_script(
    name: str,
    root: Path,
    *arguments: str,
    expected: int = 0,
    output_encoding: str | None = None,
) -> subprocess.CompletedProcess[str]:
    environment = os.environ.copy()
    if output_encoding is not None:
        environment["PYTHONIOENCODING"] = output_encoding
    completed = subprocess.run(
        [sys.executable, str(SCRIPTS / name), str(root), *arguments],
        env=environment,
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


def write_test_png(path: Path, dpi: int = 300) -> None:
    def chunk(kind: bytes, data: bytes) -> bytes:
        payload = kind + data
        return struct.pack(">I", len(data)) + payload + struct.pack(">I", zlib.crc32(payload) & 0xFFFFFFFF)

    pixels_per_meter = round(dpi / 0.0254)
    path.write_bytes(
        b"\x89PNG\r\n\x1a\n"
        + chunk(b"IHDR", struct.pack(">IIBBBBB", 1, 1, 8, 2, 0, 0, 0))
        + chunk(b"pHYs", struct.pack(">IIB", pixels_per_meter, pixels_per_meter, 1))
        + chunk(b"IDAT", zlib.compress(b"\x00\x00\x00\x00"))
        + chunk(b"IEND", b"")
    )


class WorkflowTests(unittest.TestCase):
    def test_inventory_accepts_a_root_level_problem_pdf(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            problem = root / "problem.pdf"
            problem.write_bytes(b"%PDF-1.4\n%%EOF\n")

            run_script("inspect_inputs.py", root)

            inventory = json.loads((root / ".cumcm" / "input-inventory.json").read_text(encoding="utf-8"))
            baseline = json.loads((root / ".cumcm" / "question-fingerprint.json").read_text(encoding="utf-8"))
            self.assertEqual([item["path"] for item in inventory["files"]], ["problem.pdf"])
            self.assertEqual([item["path"] for item in baseline["files"]], ["problem.pdf"])

    def test_bootstrap_expands_without_overwriting_authored_files(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "paper" / "sections").mkdir(parents=True)
            (root / "paper" / "build").mkdir(parents=True)
            run_script("bootstrap_project.py", root, "--questions", "1")
            self.assertTrue((root / "code" / "always").is_dir())
            self.assertFalse((root / "results" / "always").exists())
            self.assertFalse((root / "results" / "shared").exists())
            model = root / "code" / "q1" / "forecasting.py"
            authored = "# authored and preserved\n"
            model.write_text(authored, encoding="utf-8")
            run_script("bootstrap_project.py", root, "--questions", "3")
            self.assertEqual(model.read_text(encoding="utf-8"), authored)
            count = json.loads((root / ".cumcm" / "project.json").read_text(encoding="utf-8"))
            self.assertEqual(count["questions"], 3)
            questions = (root / "happy" / "main.tex").read_text(encoding="utf-8")
            runner = (root / "code" / "run_all.py").read_text(encoding="utf-8")
            evidence = (root / ".cumcm" / "evidence-map.yaml").read_text(encoding="utf-8")
            scaffold_main = (root / "code" / "q1" / "main.py").read_text(encoding="utf-8")
            for number in (1, 2, 3):
                self.assertEqual(questions.count(f"\\section{{问题{number}："), 1)
                self.assertEqual(runner.count(f'"q{number}.main"'), 1)
                self.assertEqual(evidence.count(f"q{number}:"), 1)
            self.assertIn("generated_by: code/q1/main.py", evidence)
            self.assertIn("upstream: TODO", evidence)
            self.assertIn("validation: TODO", evidence)
            self.assertNotIn("NotImplementedError", scaffold_main)
            self.assertIn("from .solver import solve", scaffold_main)
            for module_name in ("data_preparation.py", "solver.py", "evaluation.py"):
                module_text = (root / "code" / "q1" / module_name).read_text(encoding="utf-8")
                self.assertIn("NotImplementedError", module_text)
            self.assertNotIn("summary.json", scaffold_main)
            self.assertFalse((root / "code" / "q1" / "model.py").exists())
            self.assertFalse((root / "code" / "q1" / "output.py").exists())
            self.assertEqual(questions.count(r"\subsection{方法比较与选择依据}"), 3)
            self.assertIn(r"\subsection{求解流程与实现口径}", questions)
            self.assertIn(r"\subsection{本问结论与后续接口}", questions)
            self.assertFalse((root / "paper" / "sections").exists())
            self.assertFalse((root / "paper" / "build").exists())
            self.assertFalse((root / "paper").exists())
            self.assertFalse((root / "code" / "finalize.py").exists())
            self.assertFalse((root / ".cumcm" / "finalize.py").exists())
            self.assertEqual(
                sorted(path.name for path in (root / "happy").iterdir()),
                ["AI工具使用详情.tex", "main.tex"],
            )

    def test_bootstrap_never_shrinks_discovered_questions(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            run_script("bootstrap_project.py", root, "--questions", "3")
            run_script("bootstrap_project.py", root, "--questions", "1")
            count = json.loads((root / ".cumcm" / "project.json").read_text(encoding="utf-8"))
            self.assertEqual(count["questions"], 3)
            self.assertTrue((root / "code" / "q3" / "main.py").is_file())

    def test_package_excludes_internal_ai_log_by_default(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            run_script("bootstrap_project.py", root, "--questions", "1")
            profile_path = root / ".cumcm" / "profile.json"
            profile = json.loads(profile_path.read_text(encoding="utf-8"))
            profile["ai"]["details_pdf_required"] = True
            profile_path.write_text(json.dumps(profile, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
            (root / "happy" / "AI工具使用详情.pdf").write_bytes(b"%PDF-1.4\n%%EOF\n")
            run_script("evidence_freeze.py", root, "--write")
            run_script("package_support.py", root, output_encoding="cp1252:strict")
            with zipfile.ZipFile(root / "happy" / "支撑材料.zip") as archive:
                names = archive.namelist()
            self.assertIn("AI工具使用详情.pdf", names)
            self.assertNotIn(".cumcm/evidence-freeze.json", names)
            self.assertNotIn("AI工具使用记录.md", names)
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
        self.assertEqual(profile["rules_checked_at"], "2026-08-15")
        self.assertEqual(profile["paper"]["max_pdf_mb"], 20)
        self.assertEqual(profile["paper"]["max_body_pages"], 30)
        self.assertTrue(profile["paper"]["include_support_file_list"])
        self.assertTrue(profile["paper"]["include_source_appendix"])
        self.assertTrue(profile["result_artifacts"]["require_chinese_filenames"])
        self.assertTrue(profile["result_artifacts"]["require_chinese_headers"])
        self.assertTrue(profile["result_artifacts"]["require_chinese_sheet_names"])
        self.assertTrue(profile["result_artifacts"]["require_chinese_figure_filenames"])
        self.assertTrue(profile["result_artifacts"]["require_utf8_sig_csv"])
        self.assertEqual(profile["result_artifacts"]["fixed_schema_exceptions"], [])
        self.assertIn("mcm.edu.cn/html_cn/node/fef946", profile["sources"][2])
        self.assertNotIn("inline_markers_required", profile["ai"])
        self.assertNotIn("reference_entry_required", profile["ai"])
        self.assertTrue(profile["ai"]["details_pdf_required"])

    def test_cumcm_margin_parser_rejects_subminimum_margins(self) -> None:
        validator = load_script("validate_project.py")
        self.assertIsNone(validator.cumcm_margin_error(r"\usepackage[a4paper,margin=2.5cm]{geometry}"))
        self.assertIsNotNone(validator.cumcm_margin_error(r"\usepackage[a4paper,margin=2.49cm]{geometry}"))

    def test_result_artifact_contract_requires_chinese_csv_names_headers_and_bom(self) -> None:
        validator = load_script("validate_project.py")
        project_utils = load_script("project_utils.py")
        profile = project_utils.DEFAULT_PROFILE["result_artifacts"]
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            result_dir = root / "results" / "q1"
            result_dir.mkdir(parents=True)
            bad = result_dir / "forecast.csv"
            bad.write_text("id,value\n1,2\n", encoding="utf-8")

            errors = validator.result_artifact_contract_errors(root, profile)
            self.assertTrue(any("descriptive Chinese name" in item for item in errors))
            self.assertTrue(any("UTF-8-SIG" in item for item in errors))
            self.assertTrue(any("headers must state their Chinese meaning" in item for item in errors))

            bad.unlink()
            good = result_dir / "逐日需求预测.csv"
            good.write_text("日期,预测需求量（件）\n2026-08-12,2\n", encoding="utf-8-sig")
            self.assertEqual(
                validator.result_artifact_contract_errors(root, profile), []
            )

    def test_result_artifact_contract_cannot_be_disabled_without_provenance(self) -> None:
        validator = load_script("validate_project.py")
        project_utils = load_script("project_utils.py")
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            result_dir = root / "results" / "q1"
            result_dir.mkdir(parents=True)
            (result_dir / "forecast.csv").write_text(
                "日期,预测值\n2026-08-12,2\n", encoding="utf-8-sig"
            )
            profile = dict(project_utils.DEFAULT_PROFILE["result_artifacts"])
            profile["require_chinese_filenames"] = False
            errors = validator.result_artifact_contract_errors(root, profile)
            self.assertTrue(any("must be true" in item for item in errors))
            self.assertTrue(any("descriptive Chinese name" in item for item in errors))

    def test_figure_artifacts_require_descriptive_chinese_names(self) -> None:
        validator = load_script("validate_project.py")
        project_utils = load_script("project_utils.py")
        profile = project_utils.DEFAULT_PROFILE["result_artifacts"]
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            figure_dir = root / "figures" / "q1"
            figure_dir.mkdir(parents=True)
            generic = figure_dir / "summary.png"
            generic.write_bytes(b"figure")
            errors = validator.figure_artifact_contract_errors(root, profile)
            self.assertTrue(any("descriptive Chinese" in item for item in errors))

            generic.unlink()
            write_test_png(figure_dir / "线性拟合残差分析.png")
            self.assertEqual(
                validator.figure_artifact_contract_errors(root, profile), []
            )

    def test_result_artifact_contract_checks_xlsx_names_sheets_and_headers(self) -> None:
        validator = load_script("validate_project.py")
        project_utils = load_script("project_utils.py")
        profile = project_utils.DEFAULT_PROFILE["result_artifacts"]

        def write_workbook(path: Path, sheet_name: str, headers: list[str]) -> None:
            cells = "".join(
                f'<c r="{chr(65 + index)}1" t="inlineStr"><is><t>{header}</t></is></c>'
                for index, header in enumerate(headers)
            )
            with zipfile.ZipFile(path, "w") as workbook:
                workbook.writestr(
                    "xl/workbook.xml",
                    '<?xml version="1.0" encoding="UTF-8"?>'
                    '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" '
                    'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">'
                    f'<sheets><sheet name="{sheet_name}" sheetId="1" r:id="rId1"/></sheets>'
                    "</workbook>",
                )
                workbook.writestr(
                    "xl/_rels/workbook.xml.rels",
                    '<?xml version="1.0" encoding="UTF-8"?>'
                    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
                    '<Relationship Id="rId1" '
                    'Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" '
                    'Target="worksheets/sheet1.xml"/></Relationships>',
                )
                workbook.writestr(
                    "xl/worksheets/sheet1.xml",
                    '<?xml version="1.0" encoding="UTF-8"?>'
                    '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
                    f"<sheetData><row r=\"1\">{cells}</row></sheetData></worksheet>",
                )

        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            result_dir = root / "results" / "q1"
            result_dir.mkdir(parents=True)
            bad = result_dir / "metrics.xlsx"
            write_workbook(bad, "Sheet1", ["id", "RMSE"])
            errors = validator.result_artifact_contract_errors(root, profile)
            self.assertTrue(any("descriptive Chinese name" in item for item in errors))
            self.assertTrue(any("worksheet name" in item for item in errors))
            self.assertTrue(any("XLSX headers" in item for item in errors))

            bad.unlink()
            good = result_dir / "模型检验结果.xlsx"
            write_workbook(good, "误差指标", ["样本编号", "均方根误差（RMSE）"])
            self.assertEqual(
                validator.result_artifact_contract_errors(root, profile), []
            )

    def test_result_artifact_fixed_schema_exception_requires_problem_provenance(self) -> None:
        validator = load_script("validate_project.py")
        project_utils = load_script("project_utils.py")
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "question").mkdir()
            (root / "results" / "q1").mkdir(parents=True)
            (root / "question" / "submit-template.csv").write_bytes(
                "编号,value\n".encode("gb18030")
            )
            (root / "results" / "q1" / "submit.csv").write_bytes(
                "编号,value\n1,2\n".encode("gb18030")
            )
            profile = dict(project_utils.DEFAULT_PROFILE["result_artifacts"])
            profile["fixed_schema_exceptions"] = [
                {
                    "path": "results/q1/submit.csv",
                    "source": "question/submit-template.csv",
                    "reason": "题目要求保持上传模板的文件名、字段和编码",
                    "allow": ["filename", "headers", "encoding"],
                }
            ]
            self.assertEqual(
                validator.result_artifact_contract_errors(root, profile), []
            )

            (root / "results" / "q1" / "submit.csv").write_bytes(
                "编号,score\n1,2\n".encode("gb18030")
            )
            mismatched = validator.result_artifact_contract_errors(root, profile)
            self.assertTrue(any("headers differ" in item for item in mismatched))

            profile["fixed_schema_exceptions"][0]["source"] = "code/local.csv"
            errors = validator.result_artifact_contract_errors(root, profile)
            self.assertTrue(any("fixed-schema source" in item for item in errors))

    def test_evidence_freeze_blocks_silent_recomputation_and_detects_changes(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "results" / "q1").mkdir(parents=True)
            (root / "figures" / "q1").mkdir(parents=True)
            result = root / "results" / "q1" / "主要结果.json"
            result.write_text('{"status":"verified","value":1}\n', encoding="utf-8")
            (root / "figures" / "q1" / "拟合趋势.png").write_bytes(b"plot")

            run_script("evidence_freeze.py", root, "--write")
            blocked = run_script("finalize_project.py", root, "--run-code", expected=1)
            self.assertIn("Evidence is frozen", blocked.stdout)

            result.write_text('{"status":"verified","value":2}\n', encoding="utf-8")
            changed = run_script(
                "evidence_freeze.py",
                root,
                expected=1,
                output_encoding="cp1252:strict",
            )
            self.assertIn("changed evidence: results/q1/主要结果.json", changed.stdout)

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
            report = json.loads((root / ".cumcm" / "build" / "revision-audit.json").read_text(encoding="utf-8"))
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
        disclosure = (SKILL_ROOT / "assets" / "project-template" / "happy" / "AI工具使用详情.tex").read_text(encoding="utf-8")
        self.assertLess(disclosure.index(r"\section{主要提示方式与过程}"), disclosure.index(r"\section{采纳、人工修改与核验}"))
        main = (SKILL_ROOT / "assets" / "project-template" / "happy" / "main.tex").read_text(encoding="utf-8")
        self.assertIn("JuliaMono", main)
        self.assertIn("DejaVu Sans Mono", main)
        self.assertIn(r"\usepackage{listings}", main)
        self.assertIn("% ORBIT:QUESTIONS:BEGIN", main)
        self.assertNotIn(r"\input{sections/", main)

    def test_generated_appendix_groups_exact_support_inventory_and_runnable_sources(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            run_script("bootstrap_project.py", root, "--questions", "1")
            (root / "code" / "q1" / "sales_analysis.py").write_text("VALUE = 1\n", encoding="utf-8")

            module = load_script("build_paper.py")
            module.generate_appendices(root, module.load_profile(root))

            support = (root / ".cumcm" / "generated" / "support-files.tex").read_text(encoding="utf-8")
            source = (root / ".cumcm" / "generated" / "source-code.tex").read_text(encoding="utf-8")
            self.assertIn("支撑材料文件列表", support)
            self.assertIn(r"\begin{longtable}", support)
            self.assertIn("code/q1", support)
            self.assertIn("sales_analysis.py", support)
            self.assertNotIn(".cumcm", support)
            self.assertNotIn("evidence-freeze.json", support)
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
            command, engine = module.find_engine(Path("C:/project/.cumcm/build"))
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
            self.assertEqual(validator.code_architecture_errors(root, 1), [])

            for path in generic.glob("*.py"):
                path.unlink()
            (generic / "main.py").write_text("# 只负责串联流程。\n", encoding="utf-8")
            (generic / "forecasting.py").write_text("# 防止时间泄漏。\n", encoding="utf-8")
            (generic / "evaluation.py").write_text("# 统一评估口径。\n", encoding="utf-8")
            self.assertEqual(validator.code_architecture_warnings(root, 1), [])
            self.assertEqual(validator.code_architecture_errors(root, 1), [])

    def test_code_architecture_rejects_main_only_and_scaffold_projects(self) -> None:
        validator = load_script("validate_project.py")
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            question = root / "code" / "q1"
            question.mkdir(parents=True)
            (question / "main.py").write_text(
                'raise NotImplementedError("TODO")\n', encoding="utf-8"
            )

            errors = validator.code_architecture_errors(root, 1)

            self.assertTrue(any("only main.py" in item for item in errors))
            self.assertTrue(any("unimplemented scaffold" in item for item in errors))

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
            for path in (root / "code", root / "results", root / "figures", root / "happy", root / ".cumcm" / "build"):
                path.mkdir(parents=True, exist_ok=True)
            protected = [root / "code" / "main.py", root / "results" / "result.json", root / "figures" / "结果趋势.png", root / "happy" / "main.tex", root / "happy" / "main.pdf"]
            for path in protected:
                path.write_bytes(b"keep")
            (root / ".cumcm" / "build" / "main.aux").write_text("cache", encoding="utf-8")
            (root / "code" / "__pycache__").mkdir()
            (root / "code" / "__pycache__" / "x.pyc").write_bytes(b"cache")
            run_script("clean_project.py", root, "--apply")
            self.assertTrue(all(path.exists() for path in protected))
            self.assertFalse((root / ".cumcm" / "build" / "main.aux").exists())
            self.assertFalse((root / "code" / "__pycache__").exists())

    @unittest.skipIf(
        QUICK_MODE,
        "quick contract gate excludes the host-dependent TeX render test",
    )
    def test_complete_one_question_tex_delivery(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            run_script("bootstrap_project.py", root, "--questions", "1")
            profile_path = root / ".cumcm" / "profile.json"
            profile = json.loads(profile_path.read_text(encoding="utf-8"))
            profile["ai"]["details_pdf_required"] = True
            profile_path.write_text(json.dumps(profile, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
            (root / "question" / "data.csv").write_text("x,y\n1,2\n2,4\n", encoding="utf-8")
            run_script("inspect_inputs.py", root)
            main = root / "code" / "q1" / "main.py"
            main.write_text(
                "from __future__ import annotations\n\n"
                "from q1.data_preparation import prepare_inputs\n"
                "from q1.evaluation import evaluate_and_report\n"
                "from q1.solver import solve\n\n"
                "def main() -> None:\n"
                "    inputs = prepare_inputs()\n"
                "    solution = solve(inputs)\n"
                "    evaluate_and_report(inputs, solution)\n\n"
                "if __name__ == '__main__':\n"
                "    main()\n",
                encoding="utf-8",
            )
            (root / "code" / "q1" / "data_preparation.py").write_text(
                "from __future__ import annotations\n\n"
                "import csv\n"
                "from pathlib import Path\n\n"
                "ROOT = Path(__file__).resolve().parents[2]\n\n"
                "def prepare_inputs() -> tuple[list[float], list[float]]:\n"
                "    with (ROOT / 'question' / 'data.csv').open(encoding='utf-8') as stream:\n"
                "        rows = list(csv.DictReader(stream))\n"
                "    return ([float(row['x']) for row in rows], [float(row['y']) for row in rows])\n",
                encoding="utf-8",
            )
            (root / "code" / "q1" / "solver.py").write_text(
                "from __future__ import annotations\n\n"
                "def solve(inputs: tuple[list[float], list[float]]) -> tuple[float, float]:\n"
                "    xs, ys = inputs\n"
                "    # 使用两点解析解保持测试可复现。\n"
                "    slope = (ys[1] - ys[0]) / (xs[1] - xs[0])\n"
                "    return slope, ys[0] - slope * xs[0]\n",
                encoding="utf-8",
            )
            (root / "code" / "q1" / "evaluation.py").write_text(
                "from __future__ import annotations\n\n"
                "import csv\n"
                "from pathlib import Path\n\n"
                "ROOT = Path(__file__).resolve().parents[2]\n\n"
                "def evaluate_and_report(inputs, solution) -> None:\n"
                "    xs, ys = inputs\n"
                "    slope, intercept = solution\n"
                "    results_dir = ROOT / 'results' / 'q1'\n"
                "    results_dir.mkdir(parents=True, exist_ok=True)\n"
                "    with (results_dir / '线性拟合结果.csv').open('w', encoding='utf-8-sig', newline='') as stream:\n"
                "        writer = csv.writer(stream)\n"
                "        writer.writerow(['自变量', '观测值', '拟合值'])\n"
                "        for x, y in zip(xs, ys):\n"
                "            writer.writerow([x, y, slope * x + intercept])\n",
                encoding="utf-8",
            )
            evidence = root / ".cumcm" / "evidence-map.yaml"
            evidence_text = evidence.read_text(encoding="utf-8")
            evidence_text = evidence_text.replace(
                "results/q1/TODO-替换为实际中文结果文件",
                "results/q1/线性拟合结果.csv",
            ).replace("status: TODO", "status: verified")
            evidence.write_text(evidence_text, encoding="utf-8")
            for tex in (root / "happy").rglob("*.tex"):
                content = tex.read_text(encoding="utf-8")
                content = __import__("re").sub(r"\\TODO\{[^{}]*\}", "已核验", content)
                content = __import__("re").sub(r"TODO\[[^]]*\]", "基于线性关系的定量分析", content)
                tex.write_text(content, encoding="utf-8")
            completed = subprocess.run(
                [sys.executable, str(SCRIPTS / "finalize_project.py"), str(root), "--run-code", "--strict-layout", "--render-pages"],
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
            self.assertTrue((root / "happy" / "main.pdf").is_file())
            self.assertTrue((root / "happy" / "AI工具使用详情.pdf").is_file())
            report = json.loads((root / ".cumcm" / "build" / "revision-audit.json").read_text(encoding="utf-8"))
            self.assertGreater(len(report["rendered_pages"]), 0)


if __name__ == "__main__":
    unittest.main()
