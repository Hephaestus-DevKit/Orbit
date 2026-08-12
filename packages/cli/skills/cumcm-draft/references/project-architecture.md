# Project architecture

Use one stable project root. Keep inputs, code, paper, results, and figures
separate so a human can replace any layer without reorganizing the project.

```text
project-root/
├── question/                    # Immutable problem PDF/DOCX and source data
├── code/
│   ├── requirements.txt
│   ├── run_all.py
│   ├── always/                  # Shared configuration, data, plotting, checks
│   ├── q1/
│   ├── q2/
│   └── ...
├── results/
│   ├── q1/                      # Tables, metrics, filled workbooks, models
│   ├── q2/
│   └── ...
├── figures/
│   ├── q1/                      # Final paper-ready figures only
│   ├── q2/
│   └── ...
└── paper/
    ├── main.tex
    ├── references.bib
    ├── evidence-map.yaml
    ├── sections/
    │   ├── q1.tex
    │   ├── q2.tex
    │   └── ...
    └── build/                   # LaTeX intermediates and final PDF
```

## Ownership rules

- `question/` is read-only. Never normalize, rename, fill, or save over input.
- Ignore blank workbooks/sheets unless the statement explicitly assigns them a
  role. Record that they were blank.
- A required filled table belongs in `results/qN`, even when its blank template
  came from `question/`.
- `code/always` contains only logic used by two or more subproblems.
- Do not create a common result directory. Give cleaned data, audits, and every
  other generated artifact to the earliest subproblem that produces it; later
  subproblems declare and consume that upstream `results/qN` dependency.
- Each `code/qN/main.py` must run independently after its prerequisites exist.
- `code/qN/main.py` only orchestrates loading, domain computation, validation,
  and reporting. Name sibling modules after real responsibilities discovered
  from the problem; never require a universal `model.py` or `output.py`.
- Keep domain-module dependencies acyclic and add concise Chinese `#` comments
  where a reviewer needs the assumption, unit, guard, or execution rationale.
- `code/run_all.py` runs subproblems in dependency order.
- `results/qN` owns numeric and tabular evidence for subproblem N.
- `figures/qN` owns final visuals for subproblem N. Put diagnostic-only images
  in a temporary build directory and remove them before handoff.
- `paper/sections/qN.tex` may consume only declared evidence from matching or
  explicitly upstream result directories.
- Treat every cross-question result as a typed interface. The consumer checks
  required columns, unique entity/date keys, units, expected coverage, and
  freshness before computing. Missing coverage is an error, not permission to
  rebuild an undeclared proxy.
- Keep model-selection, validation, and test artifacts under the producing
  `results/qN`; these are evidence, not disposable debug output.

## Naming

- Use `q1`, `q2`, ... exactly; do not mix `Q1`, `question1`, or Chinese folder
  names.
- Use descriptive Chinese filenames for generated tabular artifacts under
  `results/qN`; use Chinese CSV/TSV headers and Chinese Excel worksheet/table
  headers, with units where applicable. Fixed control files such as
  `summary.json` retain their documented ASCII names.
- Preserve non-Chinese output names or headers only for a problem-prescribed
  fill-in/upload schema, and declare the narrow exception with its immutable
  source and reason under
  `contest-profile.json.result_artifacts.fixed_schema_exceptions`.
- Use stable ASCII Python module names.
- Use UTF-8 for text and UTF-8 with BOM for CSV intended for Excel.
- Include units in column labels or metadata.

## Compatibility with legacy reproduction folders

Some existing projects place `question/` next to a `reproduce/` directory.
Read those inputs in place, but do not move them automatically. For a new
project, make `question/` a peer of `code/`, `results/`, `figures/`, and
`paper/` as the canonical structure above.

When the user explicitly requests a compact handoff patterned after an
existing project, this layout is also valid:

```text
project-root/
├── main.tex
├── main.pdf
├── AI工具使用详情.tex
├── AI工具使用详情.pdf
├── 支撑材料.zip
├── question/                    # still immutable
└── produce/
    ├── code/
    │   ├── always/
    │   ├── q1/
    │   └── ...
    └── results/
        ├── q1/
        └── ...
```

Use `main` as the neutral basename unless submission rules require a
team-specific name. Do not add `core_code/`; the PDF appendix must include the
actual runnable files from `produce/code/`. Keep paper sources out of
`produce/`; inline the complete paper into one root `main.tex` for the compact
handoff. Split section files are an authoring aid, not a delivery requirement,
and should be removed after a verified merge unless the user requests them.
Build the support ZIP while `produce/figures/` still exists so the archive and
appendix list remain complete. After the PDF and ZIP are both inspected, remove
reproducible workspace figures from a minimal handoff if requested. Running
`produce/code/run_all.py` must recreate them before recompiling `main.tex`.

The formal CUMCM submission pair is the paper PDF plus one support ZIP/RAR.
Keep `AI工具使用详情.pdf` inside that archive; a root copy may remain for editing
and inspection. Place separately required filled Excel/Word artifacts at root
only when the problem statement or submission system requires them there.
Internal evidence remains in `produce/results/qN`; do not promote every CSV or
diagnostic file to the root.

Before compact handoff, remove nested ZIP/RAR/7z copies from `produce/code`,
`produce/results`, and `produce/figures`; remove scratch verification, cleanup,
rebuild, and PDF-contact scripts after their reusable checks live in the Skill
finalizer. Keep only direct runtime dependencies in `requirements.txt`, plus
the file-format engines actually required to read the supplied inputs.
