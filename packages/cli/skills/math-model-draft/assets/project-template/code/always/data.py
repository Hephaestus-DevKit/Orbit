from __future__ import annotations

from pathlib import Path
from typing import Iterable

import pandas as pd

from always.config import QUESTION_DIR


def input_files(suffixes: Iterable[str]) -> list[Path]:
    normalized = {suffix.lower() for suffix in suffixes}
    return sorted(
        path
        for path in QUESTION_DIR.rglob("*")
        if path.is_file() and path.suffix.lower() in normalized
    )


def require_columns(frame: pd.DataFrame, columns: Iterable[str]) -> None:
    missing = sorted(set(columns) - set(frame.columns))
    if missing:
        raise ValueError(f"Missing required columns: {missing}")
