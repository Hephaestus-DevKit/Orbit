from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import numpy as np


def require_finite(values: np.ndarray, label: str) -> None:
    if not np.isfinite(values).all():
        raise ValueError(f"{label} contains non-finite values.")


def write_summary(path: Path, payload: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        json.dumps(payload, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
