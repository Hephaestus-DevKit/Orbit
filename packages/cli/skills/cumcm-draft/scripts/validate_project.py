from __future__ import annotations

import argparse
import hashlib
import json
import re
import subprocess
import sys
import zipfile
from pathlib import Path, PurePosixPath
from typing import Any

from project_utils import ensure_safe_file, load_profile, numeric_limit, question_numbers
from evidence_freeze import evidence_differences


INPUT_SUFFIXES = {".pdf", ".doc", ".docx", ".csv", ".tsv", ".xls", ".xlsx"}
SUPPORT_EXCLUDED_PARTS = {
    "__pycache__",
    ".pytest_cache",
    ".mypy_cache",
    ".ruff_cache",
    ".ipynb_checkpoints",
    "build",
}
NESTED_ARCHIVE_SUFFIXES = {".zip", ".rar", ".7z"}
SCRATCH_DELIVERY_NAMES = {
    "audit_results.py",
    "build_support_zip.ps1",
    "cleanup_workspace.ps1",
    "make_pdf_contacts.py",
    "rebuild_support.ps1",
    "verify_results.py",
}


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def read_json(path: Path) -> dict[str, Any]:
    payload = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(payload, dict):
        raise ValueError("root must be an object")
    return payload


def centimeters(value: str) -> float | None:
    match = re.fullmatch(r"\s*([0-9]+(?:\.[0-9]+)?)\s*(cm|mm|in)\s*", value)
    if not match:
        return None
    number = float(match.group(1))
    return number if match.group(2) == "cm" else number / 10 if match.group(2) == "mm" else number * 2.54


def cumcm_margin_error(main_tex: str) -> str | None:
    match = re.search(r"\\usepackage\[([^]]+)]\{geometry}", main_tex)
    if not match:
        return "CUMCM paper must declare explicit geometry margins"
    options = {}
    for item in match.group(1).split(","):
        if "=" in item:
            key, value = item.split("=", 1)
            options[key.strip()] = value.strip()
    uniform = centimeters(options.get("margin", ""))
    if uniform is not None:
        return None if uniform >= 2.5 else f"CUMCM paper margin is {uniform:g} cm; minimum is 2.5 cm"
    values = [centimeters(options.get(key, "")) for key in ("top", "bottom", "left", "right")]
    if any(value is None for value in values):
        return "CUMCM paper must declare top, bottom, left, and right margins or one uniform margin"
    if min(value for value in values if value is not None) < 2.5:
        return "every CUMCM paper margin must be at least 2.5 cm"
    return None


def expected_support_names(root: Path, ai_profile: dict[str, object], support_profile: dict[str, object]) -> set[str]:
    names: set[str] = set()
    for directory in ("code", "results", "figures"):
        base = root / directory
        if not base.is_dir() or base.is_symlink():
            continue
        for path in base.rglob("*"):
            if path.is_file() and not path.is_symlink() and not any(part in SUPPORT_EXCLUDED_PARTS for part in path.relative_to(root).parts):
                names.add(path.relative_to(root).as_posix())
    if bool(ai_profile.get("used")) and bool(ai_profile.get("details_pdf_required")):
        names.add("paper/AI工具使用详情.pdf")
    if bool(support_profile.get("include_ai_log")) and (root / "paper" / "ai-use-log.md").is_file():
        names.add("paper/ai-use-log.md")
    names.add("paper/evidence-freeze.json")
    return names


def load_evidence_yaml(path: Path) -> dict[str, Any]:
    try:
        import yaml
    except ImportError:
        return load_simple_evidence_yaml(path)
    try:
        payload = yaml.safe_load(path.read_text(encoding="utf-8"))
    except Exception as error:  # PyYAML exposes parser-specific subclasses.
        raise ValueError(str(error)) from error
    if not isinstance(payload, dict):
        raise ValueError("root must be a mapping")
    return payload


def load_simple_evidence_yaml(path: Path) -> dict[str, Any]:
    """Parse the bundled flat qN/claims schema when PyYAML is unavailable."""
    payload: dict[str, Any] = {}
    current_question: dict[str, Any] | None = None
    current_claim: dict[str, str] | None = None
    for number, raw in enumerate(path.read_text(encoding="utf-8").splitlines(), start=1):
        line = raw.split("#", 1)[0].rstrip()
        if not line.strip():
            continue
        question_match = re.fullmatch(r"(q[1-9]\d*):", line)
        if question_match:
            current_question = {"claims": []}
            payload[question_match.group(1)] = current_question
            current_claim = None
            continue
        stripped = line.strip()
        if stripped == "claims:" and current_question is not None:
            continue
        field_match = re.fullmatch(
            r"(?:-\s*)?([A-Za-z_][A-Za-z0-9_]*):\s*(.*?)\s*",
            stripped,
        )
        if not field_match or current_question is None:
            raise ValueError(
                f"unsupported evidence YAML syntax at line {number}: {raw}"
            )
        field, value = field_match.groups()
        if stripped.startswith("-"):
            current_claim = {}
            current_question["claims"].append(current_claim)
        if current_claim is None:
            raise ValueError(f"claim field outside a list item at line {number}")
        current_claim[field] = value.strip("\"'")
    return payload


def validate_evidence(root: Path, count: int, errors: list[str], warnings: list[str]) -> None:
    path = root / "paper" / "evidence-map.yaml"
    if not path.is_file():
        errors.append("missing paper/evidence-map.yaml")
        return
    try:
        payload = load_evidence_yaml(path)
    except (OSError, ValueError) as error:
        errors.append(f"invalid evidence-map.yaml: {error}")
        return
    valid_status = {"TODO", "verified"}
    seen_ids: set[str] = set()
    for number in range(1, count + 1):
        key = f"q{number}"
        block = payload.get(key)
        if not isinstance(block, dict) or not isinstance(block.get("claims"), list):
            errors.append(f"evidence map requires {key}.claims list")
            continue
        for index, claim in enumerate(block["claims"], start=1):
            location = f"{key}.claims[{index}]"
            if not isinstance(claim, dict):
                errors.append(f"{location} must be a mapping")
                continue
            claim_id = claim.get("id")
            if not isinstance(claim_id, str) or not claim_id.strip():
                errors.append(f"{location}.id is required")
            elif claim_id in seen_ids:
                errors.append(f"duplicate evidence id: {claim_id}")
            else:
                seen_ids.add(claim_id)
            for field, prefix in (("source", "results"), ("paper_section", "paper")):
                value = claim.get(field)
                if not isinstance(value, str) or not value:
                    errors.append(f"{location}.{field} is required")
                    continue
                candidate = root / value
                try:
                    resolved = ensure_safe_file(root, candidate, {prefix})
                except ValueError as error:
                    errors.append(f"unsafe {location}.{field}: {error}")
                    continue
                relative = resolved.relative_to(root).as_posix()
                if field == "paper_section" and not relative.startswith("paper/sections/"):
                    errors.append(f"{location}.paper_section must be under paper/sections/")
                if not resolved.is_file():
                    errors.append(f"evidence path does not exist: {value}")
            status = claim.get("status")
            if status not in valid_status:
                errors.append(f"{location}.status must be TODO or verified")
            elif status == "TODO":
                warnings.append(f"unresolved evidence claim: {claim_id or location}")


def code_architecture_warnings(root: Path, count: int) -> list[str]:
    """Find review-hostile Python layouts without prescribing one fixed architecture."""
    warnings: list[str] = []
    for number in range(1, count + 1):
        question_dir = root / "code" / f"q{number}"
        if not question_dir.is_dir():
            continue
        modules = sorted(
            path
            for path in question_dir.glob("*.py")
            if path.name != "__init__.py" and path.is_file()
        )
        names = {path.name for path in modules}
        if names == {"main.py", "model.py", "output.py"}:
            warnings.append(
                f"q{number} uses the generic main.py + model.py + output.py trio; "
                "split substantial logic by actual responsibility"
            )
        for path in modules:
            lines = path.read_text(encoding="utf-8", errors="replace").splitlines()
            code_lines = [line for line in lines if line.strip()]
            comments = [line for line in lines if line.lstrip().startswith("#")]
            if len(code_lines) >= 80 and not comments:
                warnings.append(
                    f"{path.relative_to(root).as_posix()} has {len(code_lines)} nonblank "
                    "lines but no review-oriented # comments"
                )
        main_path = question_dir / "main.py"
        if main_path.is_file():
            main_lines = [
                line
                for line in main_path.read_text(encoding="utf-8", errors="replace").splitlines()
                if line.strip()
            ]
            if len(main_lines) >= 150:
                warnings.append(
                    f"code/q{number}/main.py has {len(main_lines)} nonblank lines; "
                    "keep the entry point orchestral"
                )
    return warnings


def delivery_hygiene_warnings(root: Path) -> list[str]:
    """Flag authoring leftovers that should not enter a compact submission."""
    warnings: list[str] = []
    bases = [root / directory for directory in ("code", "results", "figures")]
    bases.extend(root / "produce" / directory for directory in ("code", "results", "figures"))
    for base in bases:
        if not base.is_dir() or base.is_symlink():
            continue
        for path in base.rglob("*"):
            if not path.is_file() or path.is_symlink():
                continue
            relative = path.relative_to(root).as_posix()
            if path.suffix.lower() in NESTED_ARCHIVE_SUFFIXES:
                warnings.append(f"nested project archive should be removed before handoff: {relative}")
            if path.name.lower() in SCRATCH_DELIVERY_NAMES:
                warnings.append(f"authoring-only helper should not be delivered as model code: {relative}")
    for directory in ("produce", "code", "results", "figures"):
        if not (root / directory).is_dir():
            continue
        for suffix in NESTED_ARCHIVE_SUFFIXES:
            duplicate = root / f"{directory}{suffix}"
            if duplicate.is_file() and not duplicate.is_symlink():
                warnings.append(
                    f"duplicate directory archive should be removed before handoff: {duplicate.name}"
                )
    temporary = root / "tmp"
    if temporary.is_dir() and any(temporary.iterdir()):
        warnings.append("non-empty tmp/ directory should be cleaned before handoff")
    return warnings


def main() -> None:
    parser = argparse.ArgumentParser(description="Audit a modeling project and active contest profile.")
    parser.add_argument("project_root", type=Path)
    parser.add_argument("--strict", action="store_true")
    parser.add_argument("--run-code", action="store_true")
    args = parser.parse_args()
    root = args.project_root.resolve()
    errors: list[str] = []
    warnings: list[str] = []
    try:
        profile = load_profile(root)
        paper_profile = profile["paper"]
        support_profile = profile["support"]
        ai_profile = profile["ai"]
        assert isinstance(paper_profile, dict) and isinstance(support_profile, dict) and isinstance(ai_profile, dict)
        pdf_limit = numeric_limit(paper_profile, "max_pdf_mb")
        page_limit = numeric_limit(paper_profile, "max_body_pages")
        archive_limit = numeric_limit(support_profile, "max_archive_mb")
    except (ValueError, TypeError, AssertionError) as error:
        errors.append(str(error))
        profile = {}
        paper_profile = support_profile = ai_profile = {}
        pdf_limit = page_limit = archive_limit = None

    for name in ("question", "code", "results", "figures", "paper"):
        path = root / name
        if not path.is_dir():
            errors.append(f"missing top-level directory: {name}/")
        elif path.is_symlink():
            errors.append(f"symbolic top-level directory is unsafe: {name}/")

    count_path = root / "paper" / "question-count.json"
    count = 0
    if not count_path.is_file():
        errors.append("missing paper/question-count.json")
    else:
        try:
            count = int(read_json(count_path).get("questions", 0))
        except (OSError, ValueError, json.JSONDecodeError) as error:
            errors.append(f"invalid paper/question-count.json: {error}")
        if not 1 <= count <= 20:
            errors.append("paper/question-count.json must declare 1 to 20 questions")
    discovered = question_numbers(root)
    if discovered and max(discovered) > count:
        errors.append(f"question-count.json omits discovered subproblem q{max(discovered)}")

    if args.run_code:
        entry = root / "code" / "run_all.py"
        if not entry.is_file():
            errors.append("missing code/run_all.py")
        else:
            completed = subprocess.run([sys.executable, str(entry)], cwd=root / "code", stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, encoding="utf-8", errors="replace", check=False)
            if completed.returncode:
                errors.append("code/run_all.py failed:\n" + "\n".join(completed.stdout.splitlines()[-25:]))
            else:
                print("[OK] code/run_all.py completed")

    for number in range(1, count + 1):
        name = f"q{number}"
        required = (f"code/{name}", f"results/{name}", f"figures/{name}", f"paper/sections/{name}.tex")
        for relative in required:
            if not (root / relative).exists():
                errors.append(f"missing subproblem artifact: {relative}")
        summary = root / "results" / name / "summary.json"
        if not summary.is_file():
            errors.append(f"missing result evidence: results/{name}/summary.json")
        else:
            try:
                if read_json(summary).get("status") == "TODO":
                    warnings.append(f"{name} still emits placeholder results")
            except (OSError, ValueError, json.JSONDecodeError) as error:
                errors.append(f"invalid {summary.relative_to(root)}: {error}")

    inventory_path = root / "paper" / "input-inventory.json"
    if not inventory_path.is_file():
        warnings.append("input inventory is missing; run inspect_inputs.py")
    else:
        try:
            inventory = read_json(inventory_path)
            unresolved = [item.get("path", "unknown") for item in inventory.get("files", []) if isinstance(item, dict) and item.get("status") != "ok" and not item.get("details", {}).get("blank")]
            if unresolved:
                warnings.append("unresolved input inspection: " + ", ".join(map(str, unresolved)))
        except (OSError, ValueError, json.JSONDecodeError) as error:
            errors.append(f"invalid input inventory: {error}")

    baseline = root / "paper" / "question-fingerprint.json"
    if not baseline.is_file():
        warnings.append("question fingerprint baseline is missing; run inspect_inputs.py")
    else:
        try:
            expected = {str(item["path"]): str(item["sha256"]) for item in read_json(baseline).get("files", [])}
            candidates = []
            question = root / "question"
            if question.is_dir():
                candidates.extend(path for path in question.rglob("*") if path.is_file())
            candidates.extend(path for path in root.iterdir() if path.is_file() and path.suffix.lower() in INPUT_SUFFIXES)
            if any(path.is_symlink() for path in candidates):
                raise ValueError("symbolic input paths are not allowed")
            actual = {path.relative_to(root).as_posix(): sha256(path) for path in sorted(set(candidates))}
            if actual != expected:
                errors.append("problem inputs changed after their fingerprint baseline was recorded")
        except (KeyError, OSError, ValueError, json.JSONDecodeError) as error:
            errors.append(f"invalid question fingerprint: {error}")

    compile_result = subprocess.run([sys.executable, "-m", "compileall", "-q", str(root / "code")], stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, check=False)
    if compile_result.returncode:
        errors.append("Python compile failed: " + compile_result.stdout.strip())
    warnings.extend(code_architecture_warnings(root, count))
    warnings.extend(delivery_hygiene_warnings(root))
    validate_evidence(root, count, errors, warnings)
    try:
        frozen_differences = evidence_differences(root)
        if frozen_differences:
            errors.extend(frozen_differences)
    except (KeyError, OSError, TypeError, ValueError, json.JSONDecodeError) as error:
        errors.append(f"invalid evidence freeze: {error}")

    tex_files = [path for path in (root / "paper").rglob("*.tex") if path.is_file() and not path.is_symlink()]
    tex = "\n".join(path.read_text(encoding="utf-8", errors="replace") for path in tex_files)
    todo_count = tex.count(r"\TODO{") + len(re.findall(r"TODO\[", tex))
    if todo_count:
        warnings.append(f"paper contains {todo_count} visible TODO marker(s)")
    if re.search(r"[A-Za-z]:[\\/]", tex):
        errors.append("paper contains an absolute Windows path")
    if re.search(r"(姓名|学号|学校|指导教师)\s*[:：]\s*\S+", tex):
        warnings.append("paper may contain identifying information")
    main_tex = root / "paper" / "main.tex"
    if main_tex.is_file():
        content = main_tex.read_text(encoding="utf-8", errors="replace")
        if profile.get("profile") == "cumcm-2026":
            margin_error = cumcm_margin_error(content)
            if margin_error:
                errors.append(margin_error)
            if r"\tableofcontents" in content:
                errors.append("CUMCM paper must not contain a table of contents")
        if bool(ai_profile.get("used")):
            if bool(ai_profile.get("inline_markers_required")) and tex.count(r"\AIUseMark") < 2:
                errors.append("AI-assisted body content must carry corresponding inline markers")
            if bool(ai_profile.get("reference_entry_required")):
                reference_key = str(ai_profile.get("reference_key") or "ai-tool")
                if f"\\bibitem{{{reference_key}}}" not in tex:
                    errors.append(f"AI tool reference entry is missing: {reference_key}")

    if bool(paper_profile.get("include_support_file_list")):
        support_tex = root / "paper" / "sections" / "support-files.tex"
        if not support_tex.is_file() or "支撑材料文件列表" not in support_tex.read_text(encoding="utf-8", errors="replace"):
            errors.append("CUMCM appendix is missing the required support-material file list")
    if bool(paper_profile.get("include_source_appendix")):
        source_tex = root / "paper" / "sections" / "source-code.tex"
        if not source_tex.is_file() or r"\lstinputlisting" not in source_tex.read_text(encoding="utf-8", errors="replace"):
            errors.append("CUMCM appendix is missing complete runnable source listings")

    pdf = root / "paper" / "main.pdf"
    if not pdf.is_file():
        errors.append("paper/main.pdf is missing; run build_paper.py")
    else:
        if pdf_limit is not None and pdf.stat().st_size > pdf_limit * 1024 * 1024:
            errors.append(f"paper/main.pdf exceeds active {pdf_limit:g} MB limit")
        if any(path.stat().st_mtime > pdf.stat().st_mtime for path in tex_files):
            warnings.append("paper/main.pdf is older than at least one TeX source")
        if profile.get("profile") == "cumcm-2026":
            try:
                from pypdf import PdfReader
                from pypdf.errors import PdfReadError
            except ImportError as error:
                if "摘要" not in tex or "关键词" not in tex:
                    errors.append(f"could not verify CUMCM first-page content without pypdf: {error}")
            else:
                try:
                    first_page = (PdfReader(pdf).pages[0].extract_text() or "").strip()
                    if "摘要" not in first_page or "关键词" not in first_page:
                        errors.append("CUMCM electronic paper first page must contain the abstract and keywords")
                    if "目录" in first_page:
                        errors.append("CUMCM electronic paper first page must not be a table of contents")
                except (IndexError, OSError, PdfReadError, ValueError) as error:
                    warnings.append(f"could not verify CUMCM first-page content: {error}")

    archive = root / "paper" / "support-materials.zip"
    if not archive.is_file():
        warnings.append("support-materials.zip is missing; run package_support.py")
    else:
        if archive_limit is not None and archive.stat().st_size > archive_limit * 1024 * 1024:
            errors.append(f"support-materials.zip exceeds active {archive_limit:g} MB limit")
        try:
            with zipfile.ZipFile(archive) as bundle:
                names = [name for name in bundle.namelist() if not name.endswith("/")]
            unsafe = [name for name in names if PurePosixPath(name.replace("\\", "/")).is_absolute() or ".." in PurePosixPath(name.replace("\\", "/")).parts or re.match(r"^[A-Za-z]:", name)]
            if unsafe:
                errors.append("support archive contains unsafe absolute/traversal paths")
            if any(name.replace("\\", "/").lower().startswith("question/") for name in names):
                errors.append("support archive contains immutable question input files")
            if "paper/ai-use-log.md" in names and not bool(support_profile.get("include_ai_log")):
                errors.append("support archive leaks internal ai-use-log.md contrary to profile")
            if "paper/evidence-freeze.json" not in names:
                errors.append("support archive is missing paper/evidence-freeze.json")
            if bool(ai_profile.get("used")) and bool(ai_profile.get("details_pdf_required")) and "paper/AI工具使用详情.pdf" not in names:
                errors.append("support archive is missing required AI工具使用详情.pdf")
            expected_names = expected_support_names(root, ai_profile, support_profile)
            actual_names = set(names)
            missing_names = sorted(expected_names - actual_names)
            extra_names = sorted(actual_names - expected_names)
            if missing_names:
                errors.append("support archive is missing listed project files: " + ", ".join(missing_names[:12]))
            if extra_names:
                errors.append("support archive contains unlisted project files: " + ", ".join(extra_names[:12]))
        except zipfile.BadZipFile:
            errors.append("paper/support-materials.zip is not a valid ZIP archive")

    aux = root / "paper" / "build" / "main.aux"
    if page_limit is not None and aux.is_file():
        match = re.search(r"\\newlabel\{body-end\}\{\{.*?\}\{(\d+)\}", aux.read_text(encoding="utf-8", errors="replace"))
        if match:
            body_pages = max(int(match.group(1)) - 1, 0)
            if body_pages > page_limit:
                errors.append(f"paper body has {body_pages} pages; active limit is {page_limit:g}")
            else:
                print(f"  Body page audit: {body_pages}/{page_limit:g}")
        else:
            warnings.append("could not resolve body-end page label")

    if bool(ai_profile.get("used")):
        disclosure = root / "paper" / "ai-use-log.md"
        if not disclosure.is_file():
            warnings.append("internal AI use log is missing")
        if bool(ai_profile.get("details_pdf_required")) and not (root / "paper" / "AI工具使用详情.pdf").is_file():
            errors.append("AI tool disclosure PDF is required but missing")
        details_source = root / "paper" / "AI工具使用详情.tex"
        if bool(ai_profile.get("details_pdf_required")) and (
            not details_source.is_file()
            or "关键交互记录" not in details_source.read_text(encoding="utf-8", errors="replace")
        ):
            errors.append("AI details source must include key prompt-and-response interactions")

    print(f"[RUN] Validation summary: {len(errors)} error(s), {len(warnings)} warning(s)")
    for message in errors:
        print(f"[ERROR] {message}")
    for message in warnings:
        print(f"[WARN] {message}")
    if errors or (args.strict and warnings):
        raise SystemExit(1)
    print("[OK] Structure, provenance, evidence, syntax, profile, and delivery checks passed")


if __name__ == "__main__":
    main()
