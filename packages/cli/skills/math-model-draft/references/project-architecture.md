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
- Each `code/qN/main.py` must run independently after its prerequisites exist.
- `code/run_all.py` runs subproblems in dependency order.
- `results/qN` owns numeric and tabular evidence for subproblem N.
- `figures/qN` owns final visuals for subproblem N. Put diagnostic-only images
  in a temporary build directory and remove them before handoff.
- `paper/sections/qN.tex` may consume only declared evidence from matching or
  explicitly upstream result directories.

## Naming

- Use `q1`, `q2`, ... exactly; do not mix `Q1`, `question1`, or Chinese folder
  names.
- Prefer descriptive Chinese artifact names when they improve hand editing.
- Use stable ASCII Python module names.
- Use UTF-8 for text and UTF-8 with BOM for CSV intended for Excel.
- Include units in column labels or metadata.

## Compatibility with legacy reproduction folders

Some existing projects place `question/` next to a `reproduce/` directory.
Read those inputs in place, but do not move them automatically. For a new
project, make `question/` a peer of `code/`, `results/`, `figures/`, and
`paper/` as the canonical structure above.
