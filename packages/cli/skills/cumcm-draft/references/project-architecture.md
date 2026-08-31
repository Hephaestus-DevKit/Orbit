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
│   ├── requirements.txt        # optional; only when portable handoff needs it
│   ├── run_all.py
│   ├── q1/
│   │   ├── main.py             # orchestration only
│   │   ├── forecasting.py      # examples; names follow real responsibilities
│   │   └── evaluation.py
│   ├── q2/
│   └── always/                 # genuinely shared cross-question logic only
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
- Put genuinely shared behavior in `code/always`; keep question-specific logic
  in `code/qN`. Do not duplicate a module into `always` merely to make the
  tree look modular, and do not put result artifacts there.
- Each `code/qN/main.py` must run independently after prerequisites exist,
  both through `code/run_all.py` and as a direct script from its qN directory.
- `main.py` orchestrates loading, domain computation, validation, and reporting.
  Put substantive models in sibling modules named after their actual role.
- A strict finalization must not pass when qN still contains only the scaffold
  `main.py`, `NotImplementedError`, or TODO logic.
- Keep domain-module dependencies acyclic and add concise Chinese comments where
  a reviewer needs the assumption, unit, leakage guard, or numerical safeguard.
- `code/run_all.py` runs questions in dependency order. For expensive projects,
  its default path verifies and reuses accepted outputs; explicit rebuild,
  independent-audit, and figure-only modes may do the costly work.
- `results/qN` owns numeric and tabular evidence for question N. Do not create a
  synthetic `summary.json`; point `.cumcm/evidence-map.yaml` to real results.
- Keep only the prescribed submission file and auxiliary tables that support a
  model choice, validation, paper claim, or downstream contract. Timing
  experiments, serial/parallel comparisons, scratch JSON, and duplicate summaries
  belong under `.cumcm/` or should be removed before handoff.
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
- Long-running qN computations may keep hashed, versioned checkpoints and
  completion manifests under `.cumcm/qN/`. Do not rename this control directory
  merely because it is hidden on some platforms.

## Naming

- Use `q1`, `q2`, ... for structural directories; do not mix `Q1`,
  `question1`, or translated variants.
- Use descriptive Chinese filenames for generated tabular artifacts under
  `results/qN`; use Chinese CSV/TSV headers and Chinese Excel worksheet/table
  headers, with units where applicable.
- Use descriptive Chinese PNG figure filenames such as `需求预测误差对比.png`
  or `价格弹性敏感性分析.png`. Write titles, axes, legends, annotations, and
  categories in Chinese. Generate at least 300 dpi PNG output and remove stale
  PDF, SVG, JPG, and EPS siblings. Generic names such as `summary.png`,
  `plot.png`, `figure.png`, `output.png`, and `final.png` are invalid.
- Preserve a prescribed non-Chinese result schema only when the problem fixes
  it, and document the narrow exception in
  `.cumcm/profile.json.result_artifacts.fixed_schema_exceptions`.
- Treat the prescribed filename, header/column order, encoding/BOM, delimiter,
  line endings, row identity/order, Boolean spelling, and path syntax as one
  submission contract. Generic validators do not replace problem-specific row
  count and semantic checks.
- Use stable ASCII Python module names.
- Use UTF-8 for text and UTF-8 with BOM for CSV intended for Excel unless the
  official schema or example fixes another representation.
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
