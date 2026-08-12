# Code and output style

## Python structure

Use responsibility-based modules after reading the actual problem. For example:

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
    ├── preprocessing.py
    ├── forecasting.py
    ├── evaluation.py
    └── reporting.py
```

The names above are examples, not a fixed template. Another question may need
`simulation.py`, `policy_search.py`, or `sensitivity.py`. Create only modules
that carry real logic, keep `main.py` orchestral, and keep dependencies one-way:
`main -> domain logic -> always`.

Avoid these patterns:

- generating the same `main.py + model.py + output.py` trio for every question;
- leaving one oversized `model.py` that mixes preprocessing, fitting, evaluation,
  plotting, and file output;
- keeping a trivial wrapper module solely to make the directory look modular;
- splitting one short, cohesive algorithm into many one-function files.

## Comments

- Prefer short Chinese `#` comments unless the surrounding project uses another
  language consistently.
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
- Keep an explicit decision-time feature list beside forecasting code and
  comment every non-obvious lag that prevents target leakage.
- Validate upstream result schemas before downstream use; never silently
  substitute a historical proxy for a missing forecast.
- Keep `requirements.txt` limited to direct imports and required file readers.
  Do not retain libraries used only by one-off inspection or PDF review tools.

## Results

For each `results/qN` prefer:

- `summary.json`: primary claims, units, sample sizes, method, seed;
- `.csv`: tidy tables and diagnostics;
- `.txt` or `.md`: short model rules or readable explanations;
- serialized model only when later questions need it;
- completed `.xlsx` only when the problem requests a filled workbook.

All leaf tabular evidence is Chinese-facing by default:

- use a descriptive Chinese filename for every generated CSV, TSV, XLS, or
  XLSX file, such as `逐日需求预测.csv` rather than `forecast.csv` or
  `result.csv`;
- use Chinese column headers and include units where applicable, such as
  `日期`, `预测需求量（件）`, and `均方根误差（RMSE）`;
- use Chinese Excel worksheet names and Chinese table headers for generated
  workbooks;
- write CSV and TSV with UTF-8-SIG so Chinese text opens correctly in Excel;
- keep fixed machine-control artifacts such as `summary.json` and
  `environment.json` at their documented stable paths.

Do not translate a filename, field, column order, or worksheet name that the
problem or a supplied fill-in template explicitly fixes. Record that exact
exception in
`paper/contest-profile.json.result_artifacts.fixed_schema_exceptions`:

```json
{
  "path": "results/q2/submit.csv",
  "source": "question/附件3-提交模板.csv",
  "reason": "题目要求按原文件名和原字段上传",
  "allow": ["filename", "headers"]
}
```

Allowed exception scopes are `filename`, `headers`, `sheet_names`, and
`encoding`. Grant only what the official requirement fixes. A code-facing
English schema, a library default, or personal convenience is not an exception;
persist a Chinese schema and adapt internal variables at the read/write
boundary. Never write outputs into `question/`.

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

## Delivery hygiene

- Retain model-selection tables, validation metrics, and independent test
  outputs that substantiate claims.
- Remove one-off verifier, cleanup, ZIP-rebuild, and contact-sheet scripts after
  their reusable checks are covered by the trusted finalizer.
- Never place nested project archives, `__pycache__`, `.pyc`, TeX intermediates,
  or temporary render directories in the support archive.
- Do not compress source merely to save a nearly blank appendix tail page;
  first remove dead code and meaningless blank lines, then adjust listing layout
  while preserving reviewability.
