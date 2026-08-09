# Power-sample energy calculation

`watts_to_kw(value)` converts watts to kilowatts. `energy_from_samples`
interprets each sample as constant power over `interval_minutes` and returns
total energy in kWh.

Requirements:

- reject negative power and non-positive intervals with `ValueError`;
- return `0.0` for an empty sample sequence;
- do not mutate the caller's sequence;
- preserve the public function names and module split.
