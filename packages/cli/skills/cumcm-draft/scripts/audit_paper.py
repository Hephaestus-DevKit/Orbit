from __future__ import annotations

import argparse
import json
import re
import shutil
import subprocess
from pathlib import Path
from typing import Any

from project_utils import build_directory, delivery_directory, generated_directory
from script_runtime import configure_utf8_output


FIGURE_SUFFIXES = {".png"}
PROBLEM_SUFFIXES = {".pdf", ".doc", ".docx", ".csv", ".tsv", ".xls", ".xlsx"}
INVENTORY_EXCLUDED_PARTS = {"__pycache__", ".pytest_cache", ".mypy_cache", ".ruff_cache", ".orbit", "_work"}
FIGURE_STALE_TOLERANCE_SECONDS = 30.0
GENERIC_QUESTION_HEADINGS = {
    "题意、变量与约束",
    "方法选择与模型建立",
    "结果与解释",
    "验证、小结与衔接",
}


def relative(root: Path, path: Path) -> str:
    try:
        return path.resolve().relative_to(root.resolve()).as_posix()
    except ValueError:
        return str(path)


def resolve_tex_asset(root: Path, paper: Path, raw: str, suffixes: tuple[str, ...]) -> Path | None:
    normalized = raw.strip().replace("\\", "/")
    candidates = [paper / normalized, root / normalized, root / "figures" / normalized]
    expanded = []
    for candidate in candidates:
        expanded.append(candidate)
        if not candidate.suffix:
            expanded.extend(candidate.with_suffix(suffix) for suffix in suffixes)
    for candidate in expanded:
        try:
            candidate.resolve().relative_to(root.resolve())
        except ValueError:
            continue
        if candidate.is_file() and not candidate.is_symlink():
            return candidate.resolve()
    return None


def latest_mtime(paths: list[Path]) -> float:
    return max((path.stat().st_mtime for path in paths if path.is_file()), default=0.0)


def inventory_files(root: Path, base: Path) -> list[Path]:
    if not base.is_dir() or base.is_symlink():
        return []
    return [
        path
        for path in base.rglob("*")
        if path.is_file()
        and not path.is_symlink()
        and path.suffix.lower() != ".pyc"
        and not any(part in INVENTORY_EXCLUDED_PARTS for part in path.relative_to(root).parts)
    ]


def question_outline_findings(label: str, content: str) -> list[dict[str, str]]:
    findings: list[dict[str, str]] = []
    titles = [title.strip() for title in re.findall(r"\\subsection\*?\{([^{}]+)\}", content)]
    plain = re.sub(r"\\[A-Za-z@]+\*?(?:\[[^]]*\])?", "", content)
    plain = re.sub(r"[{}%\s]", "", plain)
    if len(plain) >= 1200 and len(titles) < 4:
        findings.append(
            {
                "severity": "warning",
                "kind": "coarse_question_outline",
                "message": f"{label} has {len(titles)} subsection(s) for a substantial question",
            }
        )
    generic = [title for title in titles if title in GENERIC_QUESTION_HEADINGS]
    if len(generic) >= 3:
        findings.append(
            {
                "severity": "warning",
                "kind": "generic_question_outline",
                "message": f"{label} repeats broad scaffold headings: {'; '.join(generic)}",
            }
        )
    if len(titles) > 8:
        findings.append(
            {
                "severity": "warning",
                "kind": "fragmented_question_outline",
                "message": f"{label} has {len(titles)} subsections; merge headings without independent claims or evidence",
            }
        )
    return findings


def flattened_question_sections(main_tex: Path) -> list[tuple[str, str]]:
    """Extract qN blocks from a single-file paper without creating section files."""
    if not main_tex.is_file():
        return []
    content = main_tex.read_text(encoding="utf-8", errors="replace")
    sections = list(re.finditer(r"\\section\*?\{([^{}]+)\}", content))
    extracted: list[tuple[str, str]] = []
    for index, match in enumerate(sections):
        title = match.group(1).strip()
        number = re.match(r"问题([1-9]\d*)(?:[：:]|$)", title)
        if not number:
            continue
        end = sections[index + 1].start() if index + 1 < len(sections) else len(content)
        extracted.append((f"happy/main.tex#q{number.group(1)}", content[match.start() : end]))
    return extracted


def inspect_pdf(pdf: Path) -> dict[str, Any]:
    if not pdf.is_file():
        return {"status": "missing"}
    try:
        from pypdf import PdfReader
    except ImportError:
        PdfReader = None
    if PdfReader is not None:
        try:
            reader = PdfReader(pdf)
            pages = []
            for index, page in enumerate(reader.pages, start=1):
                text = (page.extract_text() or "").strip()
                resources = page.get("/Resources") or {}
                xobjects = resources.get("/XObject") if hasattr(resources, "get") else None
                has_xobjects = bool(xobjects)
                pages.append({"page": index, "text_characters": len(text), "has_xobjects": has_xobjects, "possibly_blank": not text and not has_xobjects})
            return {"status": "ok", "backend": "pypdf", "pages": len(reader.pages), "page_checks": pages}
        except Exception as error:  # pypdf exposes parser-specific failures.
            return {"status": "manual_review", "backend": "pypdf", "reason": str(error)}

    pdf_module = None
    try:
        import pymupdf as pdf_module
    except ImportError:
        try:
            import fitz as pdf_module
        except ImportError:
            pass
    if pdf_module is not None:
        try:
            document = pdf_module.open(str(pdf))
            pages = []
            for index, page in enumerate(document, start=1):
                text = (page.get_text() or "").strip()
                has_xobjects = bool(page.get_images(full=True))
                pages.append({"page": index, "text_characters": len(text), "has_xobjects": has_xobjects, "possibly_blank": not text and not has_xobjects})
            return {"status": "ok", "backend": "pymupdf", "pages": len(document), "page_checks": pages}
        except Exception as error:
            return {"status": "manual_review", "backend": "pymupdf", "reason": str(error)}

    pdfinfo = shutil.which("pdfinfo.exe") or shutil.which("pdfinfo")
    if pdfinfo:
        completed = subprocess.run([pdfinfo, str(pdf)], stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, encoding="utf-8", errors="replace", check=False)
        match = re.search(r"^Pages:\s+(\d+)\s*$", completed.stdout, re.MULTILINE | re.IGNORECASE)
        if completed.returncode == 0 and match:
            return {"status": "metadata_only", "backend": "pdfinfo", "pages": int(match.group(1)), "page_checks": []}
        return {"status": "manual_review", "backend": "pdfinfo", "reason": completed.stdout[-500:]}
    return {"status": "dependency_missing", "dependencies": ["pypdf", "pymupdf", "pdfinfo"]}


def main() -> None:
    parser = argparse.ArgumentParser(description="Audit TeX/PDF, figures, results, code, and reference-paper consistency surfaces.")
    parser.add_argument("project_root", type=Path)
    parser.add_argument("--render-pages", action="store_true")
    parser.add_argument("--fail-on-findings", action="store_true")
    parser.add_argument("--fail-on-errors", action="store_true")
    args = parser.parse_args()
    root = args.project_root.resolve()
    paper = delivery_directory(root)
    findings: list[dict[str, str]] = []
    inventory: dict[str, list[str]] = {}
    root_problem_files = [path for path in root.iterdir() if path.is_file() and not path.is_symlink() and path.suffix.lower() in PROBLEM_SUFFIXES]
    categories = {
        "problem_and_attachments": [root / "question"],
        "code": [root / "code"],
        "results": [root / "results"],
        "figures": [root / "figures"],
        "tex": [paper],
    }
    for category, bases in categories.items():
        files = []
        for base in bases:
            if base.is_dir():
                files.extend(inventory_files(root, base))
        if category == "problem_and_attachments":
            files.extend(root_problem_files)
        if category == "tex":
            files = [path for path in files if path.suffix.lower() in {".tex", ".bib", ".cls", ".sty"}]
        inventory[category] = [relative(root, path) for path in sorted(files)]
    reference_dirs = [path for path in root.rglob("*") if path.is_dir() and re.search(r"优秀|参考论文|excellent|reference.?paper", path.name, re.IGNORECASE)]
    inventory["reference_papers"] = [relative(root, path) for base in reference_dirs for path in sorted(base.rglob("*")) if path.is_file() and not path.is_symlink()]

    tex_files = [
        path
        for base in (paper, generated_directory(root))
        if base.is_dir()
        for path in base.rglob("*.tex")
        if path.is_file() and not path.is_symlink()
    ]
    tex_texts = {path: path.read_text(encoding="utf-8", errors="replace") for path in tex_files}
    combined = "\n".join(tex_texts.values())
    for source, content in tex_texts.items():
        for raw in re.findall(r"\\(?:input|include)\{([^}]+)\}", content):
            if resolve_tex_asset(root, paper, raw, (".tex",)) is None:
                findings.append({"severity": "error", "kind": "missing_tex_input", "message": f"{relative(root, source)} -> {raw}"})
        for raw in re.findall(r"\\includegraphics(?:\[[^]]*\])?\{([^}]+)\}", content):
            if resolve_tex_asset(root, paper, raw, tuple(FIGURE_SUFFIXES)) is None:
                findings.append({"severity": "error", "kind": "missing_figure", "message": f"{relative(root, source)} -> {raw}"})

    labels = set(re.findall(r"\\label\{([^}]+)\}", combined))
    refs = set(re.findall(r"\\(?:ref|eqref|pageref)\{([^}]+)\}", combined))
    for key in sorted(refs - labels):
        findings.append({"severity": "error", "kind": "undefined_label", "message": key})
    citations = set(item.strip() for group in re.findall(r"\\cite\{([^}]+)\}", combined) for item in group.split(","))
    bibliography_keys = set(re.findall(r"\\bibitem(?:\[[^]]*\])?\{([^}]+)\}", combined))
    for key in sorted(citations - bibliography_keys):
        findings.append({"severity": "error", "kind": "undefined_citation", "message": key})

    referenced_names = {Path(raw.replace("\\", "/")).stem.lower() for raw in re.findall(r"\\includegraphics(?:\[[^]]*\])?\{([^}]+)\}", combined)}
    figure_files = [path for path in (root / "figures").rglob("*") if path.is_file() and path.suffix.lower() in FIGURE_SUFFIXES and not path.is_symlink()] if (root / "figures").is_dir() else []
    for figure in figure_files:
        if figure.stem.lower() not in referenced_names:
            findings.append({"severity": "warning", "kind": "unreferenced_figure", "message": relative(root, figure)})
        question = next((part for part in figure.parts if re.fullmatch(r"q\d+", part)), None)
        if question:
            sources = [path for base in (root / "results" / question,) if base.is_dir() for path in base.rglob("*") if path.is_file()]
            if latest_mtime(sources) > figure.stat().st_mtime + FIGURE_STALE_TOLERANCE_SECONDS:
                findings.append({"severity": "warning", "kind": "possibly_stale_figure", "message": relative(root, figure)})

    question_sections = [
        (relative(root, path), tex_texts.get(path, ""))
        for path in sorted((paper / "sections").glob("q*.tex"))
        if re.fullmatch(r"q[1-9]\d*\.tex", path.name)
    ] if (paper / "sections").is_dir() else flattened_question_sections(paper / "main.tex")
    for section_label, content in question_sections:
        findings.extend(question_outline_findings(section_label, content))
        plain = re.sub(r"\\[A-Za-z@]+\*?(?:\[[^]]*\])?", "", content)
        plain = re.sub(r"[{}%]", "", plain)
        if len(re.sub(r"\s+", "", plain)) < 500:
            findings.append({"severity": "warning", "kind": "thin_question_section", "message": section_label})
        required_groups = (
            ("变量", "符号", "参数", "约束", "条件", "假设"),
            ("选择", "理由", "原因", "采用", "建立", "基于", "考虑", "模型"),
            ("结果", "解释", "表明", "说明", "可见", "得到", "结论", "分析"),
            ("验证", "检验", "敏感", "稳健", "误差", "残差", "对比", "评估", "合理"),
        )
        for group in required_groups:
            if not any(token in content for token in group):
                findings.append({"severity": "warning", "kind": "missing_reasoning_stage", "message": f"{section_label} lacks {'/'.join(group)}"})

    main_pdf = paper / "main.pdf"
    source_files = tex_files + [path for base_name in ("code", "results", "figures") for path in (root / base_name).rglob("*") if path.is_file()] if all((root / name).exists() for name in ("code", "results", "figures")) else tex_files
    if not main_pdf.is_file():
        findings.append({"severity": "error", "kind": "missing_pdf", "message": "happy/main.pdf"})
    elif latest_mtime(source_files) > main_pdf.stat().st_mtime:
        findings.append({"severity": "warning", "kind": "stale_pdf", "message": "happy/main.pdf is older than TeX/code/results/figures"})
    pdf_check = inspect_pdf(main_pdf)
    for page in pdf_check.get("page_checks", []):
        if page.get("possibly_blank"):
            findings.append({"severity": "error", "kind": "possibly_blank_page", "message": f"happy/main.pdf page {page['page']}"})

    rendered: list[str] = []
    if args.render_pages and main_pdf.is_file():
        pdftoppm = shutil.which("pdftoppm.exe") or shutil.which("pdftoppm")
        if not pdftoppm:
            findings.append({"severity": "warning", "kind": "render_dependency_missing", "message": "pdftoppm not found"})
        else:
            output_dir = build_directory(root) / "page-review"
            output_dir.mkdir(parents=True, exist_ok=True)
            for previous in output_dir.glob("page-*.png"):
                if previous.is_file() and not previous.is_symlink():
                    previous.unlink()
            completed = subprocess.run([pdftoppm, "-png", "-r", "144", str(main_pdf), str(output_dir / "page")], stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, encoding="utf-8", errors="replace", check=False)
            if completed.returncode:
                findings.append({"severity": "error", "kind": "render_failed", "message": completed.stdout[-500:]})
            else:
                rendered = [relative(root, path) for path in sorted(output_dir.glob("page-*.png"))]

    report = {
        "schema_version": 1,
        "project_root": str(root),
        "inventory": inventory,
        "pdf": pdf_check,
        "rendered_pages": rendered,
        "findings": findings,
        "summary": {"errors": sum(item["severity"] == "error" for item in findings), "warnings": sum(item["severity"] == "warning" for item in findings)},
    }
    output = build_directory(root) / "revision-audit.json"
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"[RUN] Paper audit: {report['summary']['errors']} error(s), {report['summary']['warnings']} warning(s)")
    for item in findings:
        print(f"[{item['severity'].upper()}] {item['kind']}: {item['message']}")
    print(f"[OK] Audit report: {output}")
    if args.fail_on_findings and findings:
        raise SystemExit(1)
    if args.fail_on_errors and report["summary"]["errors"]:
        raise SystemExit(1)


if __name__ == "__main__":
    configure_utf8_output()
    main()
