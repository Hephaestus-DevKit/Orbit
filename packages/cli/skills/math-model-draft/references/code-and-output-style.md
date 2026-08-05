# Code and output style

## Python structure

Use:

```text
code/
├── requirements.txt
├── run_all.py
├── always/
│   ├── __init__.py
│   ├── config.py
│   ├── data.py
│   ├── plotting.py
│   └── validation.py
└── qN/
    ├── __init__.py
    ├── main.py
    ├── model.py
    ├── output.py
    └── domain_specific.py
```

Create only domain modules that carry real logic. Keep `main.py` orchestral.

## Comments

- Prefer short `#` comments.
- Comment the reason, invariant, unit conversion, or numerical safeguard.
- Do not restate the following line.
- Do not use decorative separators or paragraph-length comments.
- Use clear names instead of comments when naming solves the problem.
- Preserve necessary source/citation notes beside implemented formulas.

Example:

```python
# Fit preprocessing on training folds to prevent leakage.
pipeline = make_pipeline(transformer, estimator)
```

## Reproducibility

- Resolve paths from `Path(__file__)`, never the current shell directory alone.
- Fix all library random seeds through one `RANDOM_STATE`.
- Save environment/package versions.
- Make the default entry point non-interactive.
- Put expensive optional analyses behind explicit flags.
- Keep plotting headless and deterministic.
- Close figures after saving.
- Fail early with a concise message when required columns or units are absent.

## Results

For each `results/qN` prefer:

- `summary.json`: primary claims, units, sample sizes, method, seed;
- `.csv`: tidy tables and diagnostics;
- `.txt` or `.md`: short model rules or readable explanations;
- serialized model only when later questions need it;
- completed `.xlsx` only when the problem requests a filled workbook.

Use UTF-8-SIG for user-facing Chinese CSV files. Never write outputs into
`question/`.

## Figures

For each `figures/qN`:

- save only figures used or directly useful in the paper;
- prefer vector PDF for line art plus a high-resolution PNG fallback;
- use Chinese-capable fonts and minus-sign handling;
- label axes and colorbars with units;
- choose perceptually appropriate palettes;
- avoid 3D charts unless the third dimension is essential;
- avoid titles that duplicate the LaTeX caption;
- keep legends outside dense data when possible.

## Console behavior

Print:

- `[RUN]` for a running subproblem;
- `[OK]` for completion;
- `[WARN]` for a documented fallback;
- `[ERROR]` for a concise failure.

Do not dump full dataframes or stack traces during normal runs. Save detailed
diagnostics under the matching `results/qN`. ASCII status tags also remain
legible in a LaTeX source-code appendix without relying on symbol fonts.
