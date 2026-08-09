from units import watts_to_kw


def energy_from_samples(power_watts: list[float], interval_minutes: float) -> float:
    if interval_minutes <= 0:
        raise ValueError("interval must be positive")
    return sum(watts_to_kw(value) for value in power_watts) * interval_minutes
