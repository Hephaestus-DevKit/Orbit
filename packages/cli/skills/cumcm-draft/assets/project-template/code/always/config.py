from __future__ import annotations

from pathlib import Path


CODE_ROOT = Path(__file__).resolve().parents[1]
PROJECT_ROOT = CODE_ROOT.parent
QUESTION_DIR = PROJECT_ROOT / "question"
RESULTS_DIR = PROJECT_ROOT / "results"
FIGURES_DIR = PROJECT_ROOT / "figures"
RANDOM_STATE = 2026


def question_output_dirs(question: str) -> tuple[Path, Path]:
    # 只允许 qN，避免输出目录越过项目边界。
    if not question.startswith("q") or not question[1:].isdigit():
        raise ValueError(f"Invalid question name: {question}")
    return RESULTS_DIR / question, FIGURES_DIR / question
