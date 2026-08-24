from __future__ import annotations

import sys
from typing import TextIO


def _configure_stream(stream: TextIO) -> None:
    reconfigure = getattr(stream, "reconfigure", None)
    if callable(reconfigure):
        reconfigure(encoding="utf-8", errors="backslashreplace")


def configure_utf8_output() -> None:
    """Keep Chinese paths printable in terminals and redirected subprocess output."""

    _configure_stream(sys.stdout)
    _configure_stream(sys.stderr)
