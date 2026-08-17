# Project architecture

Use one stable project root and separate private workflow state from authored
and submitted artifacts.

```text
project-root/
├── .cumcm/                     # Orbit-owned workflow state; never modeling code
│   ├── profile.json
│   ├── project.json
│   ├── evidence-map.yaml
│   ├── ai-use-log.md
│   ├── environment.txt         # private interpreter/version note
│   ├── generated/              # generated TeX appendices
│   └── build/                  # LaTeX caches, page renders, audit report
├── question/                   # immutable problem and supplied data
├── code/
│   ├── requirements.txt        # actual direct runtime dependencies only
│   ├── run_all.py
│   ├── q1/
│   │   ├── main.py             # orchestration only
│   │   ├── forecasting.py      # examples; names follow real responsibilities
│   │   └── evaluation.py
│   ├── q2/
│   └── common/                 # only when two or more questions genuinely reuse it
├── results/
│   ├── q1/                     # Chinese-named tables, metrics, models, workbooks
│   ├── q2/
│   └── ...
├── figures/
│   ├── q1/                     # final Chinese-named figures only
│   ├── q2/
│   └── ...
└── happy/
    ├── main.tex
    ├── AI工具使用详情.tex
    ├── main.pdf
    ├── AI工具使用详情.pdf
    ├── 支撑材料.zip
    ├── q1/                     # copies of required result tables
    └── q2/
```

The two TeX sources are the only default authored files under `happy/`.
External editors may create compiler intermediates there, but Orbit builds into
`.cumcm/build/` and cleans known intermediates. Do not create `happy/sections/`
or `happy/build/`.

## Ownership rules

- `question/` is read-only. Never normalize, rename, fill, or save over input.
- Ignore blank workbooks/sheets unless the statement explicitly assigns them a
  role. Record that they were blank.
- A required filled table belongs in `results/qN`, even when its blank template
  came from `question/`.
- Create `code/common` only after two or more questions use the same behavior.
  A pre-generated utility package is clutter and often becomes dead code.
- Each `code/qN/main.py` must run independently after prerequisites exist,
  both through `code/run_all.py` and as a direct script from its qN directory.
- `main.py` orchestrates loading, domain computation, validation, and reporting.
  Put substantive models in sibling modules named after their actual role.
- A strict finalization must not pass when qN still contains only the scaffold
  `main.py`, `NotImplementedError`, or TODO logic.
- Keep domain-module dependencies acyclic and add concise Chinese comments where
  a reviewer needs the assumption, unit, leakage guard, or numerical safeguard.
- `code/run_all.py` runs questions in dependency order.
- `results/qN` owns numeric and tabular evidence for question N. Do not create a
  synthetic `summary.json`; point `.cumcm/evidence-map.yaml` to real results.
- `figures/qN` owns final visuals for question N. Diagnostic-only images belong
  in `.cumcm/build/` and must not enter the support archive.
- `happy/main.tex` consumes only declared evidence from matching or explicitly
  upstream result directories.
- Treat every cross-question result as a typed interface. The consumer checks
  columns, unique entity/date keys, units, coverage, and freshness.
- Keep model-selection, validation, and test artifacts under the producing
  `results/qN`; these are evidence, not disposable debug output.
- `.cumcm/` belongs to Orbit's workflow. Never cite it as modeling output or
  include audit reports, evidence freezes, environment notes, or build caches in
  the modeling-code appendix or support archive. Never create a project-local
  `finalize.py`; call the active Skill's `scripts/finalize_project.py` directly.

## Naming

- Use `q1`, `q2`, ... for structural directories; do not mix `Q1`,
  `question1`, or translated variants.
- Use descriptive Chinese filenames for generated tabular artifacts under
  `results/qN`; use Chinese CSV/TSV headers and Chinese Excel worksheet/table
  headers, with units where applicable.
- Use descriptive Chinese figure filenames such as `需求预测误差对比.svg` or
  `价格弹性敏感性分析.pdf`. Write titles, axes, legends, annotations, and
  categories in Chinese. Generate PDF and SVG vector outputs by default; PNG
  is an optional raster preview. Generic names such as `summary.png`, `plot.png`,
  `figure.png`, `output.png`, and `final.png` are invalid.
- Preserve a prescribed non-Chinese result schema only when the problem fixes
  it, and document the narrow exception in
  `.cumcm/profile.json.result_artifacts.fixed_schema_exceptions`.
- Use stable ASCII Python module names.
- Use UTF-8 for text and UTF-8 with BOM for CSV intended for Excel.
- Include units in column labels or metadata.

## Submission boundary

The formal submission pair is `happy/main.pdf` plus `happy/支撑材料.zip`.
The archive contains runnable code, necessary results, cited figures,
`AI工具使用详情.pdf` when required. It excludes immutable
question inputs and all `.cumcm/` control state.

Copy separately required CSV/Excel/Word artifacts from `results/qN` into the
matching `happy/qN`. Do not copy internal JSON audits or promote every
diagnostic and figure into the human-facing delivery directory.

## Legacy projects

Legacy projects under `paper/` must be migrated deliberately to `happy/` before
finalization. Bootstrap intentionally does not copy authored `paper/` TeX or
rewrite the old layout; preserve authored TeX while collapsing legacy sections
only after verifying the resulting `happy/main.tex`. New projects always use the
compact `happy/` layout.
