from energy import energy_from_samples
from units import watts_to_kw


def close(actual: float, expected: float) -> None:
    assert abs(actual - expected) < 1e-12, (actual, expected)


close(watts_to_kw(1000), 1.0)
samples = [1000.0] * 6
snapshot = list(samples)
close(energy_from_samples(samples, 10), 1.0)
assert samples == snapshot
close(energy_from_samples([], 15), 0.0)

for action in (
    lambda: watts_to_kw(-1),
    lambda: energy_from_samples([100], 0),
):
    try:
        action()
    except ValueError:
        pass
    else:
        raise AssertionError("invalid input was accepted")

print("python unit conversion verifier passed")
