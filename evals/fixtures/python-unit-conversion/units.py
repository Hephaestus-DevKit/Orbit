def watts_to_kw(value: float) -> float:
    if value < 0:
        raise ValueError("power must be non-negative")
    return value / 100.0
