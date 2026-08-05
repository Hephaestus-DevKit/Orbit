from __future__ import annotations

import argparse
import re
import shutil
import subprocess
from pathlib import Path

from project_utils import iter_regular_files, load_profile, numeric_limit


EXCLUDED_PARTS = {"__pycache__", ".pytest_cache", ".mypy_cache", "build"}
CODE_SUFFIXES = {".py", ".r", ".jl", ".m", ".cpp", ".c", ".h"}
BUILD_ARTIFACT_SUFFIXES = {
    ".aux",
    ".bbl",
    ".bcf",
    ".blg",
    ".fdb_latexmk",
    ".fls",
    ".log",
    ".out",
    ".pdf",
    ".run.xml",
    ".toc",
    ".xdv",
}


def tex_path(path: str) -> str:
    return path.replace("\\", "/").replace("%", r"\%").replace("#", r"\#")


def tex_text(value: str) -> str:
    escaped = value.replace("\\", "/")
    for character, replacement in (("&", r"\&"), ("%", r"\%"), ("$", r"\$"), ("#", r"\#"), ("_", r"\_"), ("{", r"\{"), ("}", r"\}"), ("~", r"\textasciitilde{}"), ("^", r"\textasciicircum{}")):
        escaped = escaped.replace(character, replacement)
    return escaped


def tex_breakable_path(value: str) -> str:
    escaped = tex_text(value)
    escaped = escaped.replace("/", "/\\allowbreak{}")
    escaped = escaped.replace(r"\_", r"\_\allowbreak{}")
    escaped = escaped.replace("-", "-\\allowbreak{}")
    return f"\\texttt{{{escaped}}}"


def generate_appendices(root: Path, profile: dict[str, object]) -> None:
    sections = root / "paper" / "sections"
    sections.mkdir(parents=True, exist_ok=True)
    paper_profile = profile["paper"]
    assert isinstance(paper_profile, dict)

    support_path = sections / "support-files.tex"
    if bool(paper_profile.get("include_support_file_list")):
        support = []
        for directory in ("code", "results", "figures"):
            support.extend(path.relative_to(root).as_posix() for path in iter_regular_files(root, directory, EXCLUDED_PARTS))
        ai_pdf = root / "paper" / "AI工具使用详情.pdf"
        if ai_pdf.is_file():
            support.append("paper/AI工具使用详情.pdf")
        rows = ["\\begin{itemize}"] + [f"  \\item {tex_breakable_path(path)}" for path in sorted(set(support))] + ["\\end{itemize}"]
        support_path.write_text("\n".join(rows) + "\n", encoding="utf-8")
    else:
        support_path.write_text("% Disabled by paper/contest-profile.json.\n", encoding="utf-8")

    source_path = sections / "source-code.tex"
    if bool(paper_profile.get("include_source_appendix")):
        listings = []
        for path in iter_regular_files(root, "code", EXCLUDED_PARTS):
            if path.suffix.lower() not in CODE_SUFFIXES:
                continue
            relative = (Path("..") / path.relative_to(root)).as_posix()
            display = path.relative_to(root).as_posix()
            listings.extend([f"\\noindent\\textbf{{程序文件}}\\quad {tex_breakable_path(display)}\\par", "\\VerbatimInput[fontsize=\\scriptsize,breaklines=true," f"breakanywhere=true]{{{tex_path(relative)}}}"])
        source_path.write_text("\n\n".join(listings) + "\n", encoding="utf-8")
    else:
        source_path.write_text("% Disabled by paper/contest-profile.json.\n", encoding="utf-8")


def find_engine() -> tuple[list[str], str]:
    latexmk = shutil.which("latexmk")
    if latexmk:
        return [latexmk, "-xelatex", "-interaction=nonstopmode", "-halt-on-error", "-file-line-error", "-outdir=build", "main.tex"], "latexmk"
    xelatex = shutil.which("xelatex")
    if xelatex:
        return [xelatex, "-interaction=nonstopmode", "-halt-on-error", "-file-line-error", "-output-directory=build", "main.tex"], "xelatex"
    raise SystemExit("Neither latexmk nor xelatex is available on PATH (TeX Live required).")


def run(command: list[str], cwd: Path) -> subprocess.CompletedProcess[str]:
    return subprocess.run(command, cwd=cwd, text=True, encoding="utf-8", errors="replace", stdout=subprocess.PIPE, stderr=subprocess.STDOUT, check=False)


def audit_log(log_path: Path, strict_layout: bool) -> None:
    if not log_path.is_file():
        raise SystemExit(f"TeX log is missing: {log_path}")
    log = log_path.read_text(encoding="utf-8", errors="replace")
    checks: dict[str, tuple[str, ...]] = {
        "undefined cross-reference or citation": (r"LaTeX Warning:.*(?:undefined|multiply defined)", r"There were undefined references"),
        "missing glyph": (r"Missing character:",),
        "overfull box": (r"Overfull \\[hv]box",),
    }
    if strict_layout:
        checks["underfull box"] = (r"Underfull \\[hv]box",)
    failures = [label for label, patterns in checks.items() if any(re.search(pattern, log, re.IGNORECASE) for pattern in patterns)]
    if failures:
        log_lines = log.splitlines()
        hit_indices = [index for index, line in enumerate(log_lines) if re.search(r"(?:Overfull|Underfull|Missing character|undefined|multiply defined)", line, re.IGNORECASE)]
        selected: set[int] = set()
        for index in hit_indices[-6:]:
            selected.update(range(max(0, index - 3), min(len(log_lines), index + 4)))
        diagnostics = "\n".join(log_lines[index] for index in sorted(selected))
        raise SystemExit("TeX quality audit failed: " + ", ".join(failures) + f". Inspect {log_path}\n{diagnostics}")


def clear_entry_build_artifacts(paper: Path, source_name: str) -> None:
    """Remove only deterministic outputs for one TeX entry point."""
    build = paper / "build"
    stem = Path(source_name).stem
    for suffix in BUILD_ARTIFACT_SUFFIXES:
        target = build / f"{stem}{suffix}"
        if target.is_symlink():
            raise SystemExit(f"Symbolic TeX build artifacts are not allowed: {target}")
        if target.is_file():
            target.unlink()


def tex_failure_diagnostics(log_path: Path, process_output: str) -> str:
    """Extract actionable file/line errors instead of dumping latexmk noise."""
    sources = []
    if log_path.is_file():
        sources.append(log_path.read_text(encoding="utf-8", errors="replace"))
    sources.append(process_output)
    lines = "\n".join(sources).splitlines()
    hits: list[int] = []
    patterns = (
        r"^\s*[^\s].*:\d+:\s*(?:LaTeX Error|Package .* Error|Undefined control sequence|Missing \$|Extra alignment|File .* not found)",
        r"^\s*!\s+(?:LaTeX Error|Package .* Error|Undefined control sequence|Missing \$|Extra alignment|Emergency stop)",
        r"^\s*\*\*\* \(job aborted",
    )
    for index, line in enumerate(lines):
        if any(re.search(pattern, line, re.IGNORECASE) for pattern in patterns):
            hits.append(index)
    if not hits:
        return "\n".join(process_output.splitlines()[-24:])
    selected: set[int] = set()
    for index in hits[:4]:
        selected.update(range(max(0, index - 2), min(len(lines), index + 5)))
    return "\n".join(lines[index] for index in sorted(selected))


def build_tex(paper: Path, source_name: str, output_name: str, strict_layout: bool) -> tuple[str, Path]:
    source = paper / source_name
    if source.is_symlink():
        raise SystemExit(f"Symbolic TeX entry points are not allowed: {source}")
    clear_entry_build_artifacts(paper, source_name)
    command, engine = find_engine()
    command[-1] = source_name
    completed = run(command, paper)
    if completed.returncode == 0 and engine == "xelatex":
        completed = run(command, paper)
    if completed.returncode != 0:
        stem = Path(source_name).stem
        log_path = paper / "build" / f"{stem}.log"
        diagnostics = tex_failure_diagnostics(log_path, completed.stdout)
        raise SystemExit(
            f"TeX build failed ({engine}, {source_name}). "
            f"Repair the first reported source error and rerun the finalizer.\n{diagnostics}"
        )
    stem = Path(source_name).stem
    built = paper / "build" / f"{stem}.pdf"
    audit_log(paper / "build" / f"{stem}.log", strict_layout)
    if not built.is_file():
        raise SystemExit(f"TeX reported success but did not create {built}")
    final = paper / output_name
    shutil.copy2(built, final)
    return engine, final


def check_size(path: Path, maximum_mb: float | None, label: str) -> float:
    size_mb = path.stat().st_size / (1024 * 1024)
    if maximum_mb is not None and size_mb > maximum_mb:
        raise SystemExit(f"{label} is {size_mb:.2f} MB; active profile limit is {maximum_mb:g} MB.")
    return size_mb


def main() -> None:
    parser = argparse.ArgumentParser(description="Build the paper and AI-use disclosure with local TeX Live.")
    parser.add_argument("project_root", type=Path)
    parser.add_argument("--strict-layout", action="store_true", help="fail on both overfull and underfull boxes")
    args = parser.parse_args()
    root = args.project_root.resolve()
    paper = root / "paper"
    if not (paper / "main.tex").is_file():
        raise SystemExit(f"Missing paper entry point: {paper / 'main.tex'}")
    try:
        profile = load_profile(root)
        pdf_limit = numeric_limit(profile["paper"], "max_pdf_mb")
    except (ValueError, TypeError) as error:
        raise SystemExit(str(error)) from error
    (paper / "build").mkdir(parents=True, exist_ok=True)

    ai_profile = profile["ai"]
    assert isinstance(ai_profile, dict)
    ai_message = ""
    if bool(ai_profile.get("used")) and bool(ai_profile.get("details_pdf_required")):
        ai_source = paper / "AI工具使用详情.tex"
        if not ai_source.is_file():
            raise SystemExit("Active profile requires paper/AI工具使用详情.tex")
        _, ai_pdf = build_tex(paper, ai_source.name, "AI工具使用详情.pdf", args.strict_layout)
        ai_size = check_size(ai_pdf, pdf_limit, "AI disclosure")
        ai_message = f"\n  AI disclosure: {ai_pdf} ({ai_size:.2f} MB)"

    try:
        generate_appendices(root, profile)
    except ValueError as error:
        raise SystemExit(str(error)) from error
    engine, final = build_tex(paper, "main.tex", "main.pdf", args.strict_layout)
    size_mb = check_size(final, pdf_limit, "Paper PDF")
    print(f"[OK] Paper built with {engine}: {final} ({size_mb:.2f} MB){ai_message}")


if __name__ == "__main__":
    main()
