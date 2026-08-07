---
name: math-model-draft
description: Build, revise, or audit a mathematical-modeling competition project from problem statements, attachments, current code, machine-readable results, figures, TeX, PDFs, and reference papers. Produces evidence-linked Chinese LaTeX, runnable q1/q2 code, validated outputs, current figures, AI-use disclosure, and submission packages. Use explicitly for 数学建模、国赛/CUMCM、研究生数模、校赛、美赛中文稿、论文初稿或定稿审查、TeX/PDF 修订、模型—代码—结果—论文一致性核验。
---

# Build or revise a mathematical-modeling paper

Deliver a compilable, evidence-backed project, not an outline or generic prose.
Never invent a model, algorithm, datum, parameter, numerical result, validation,
or figure that the current code and artifacts do not support. Mark unresolved
facts visibly with `TODO[reason]`.

## Mandatory execution order for generation

After one project inventory, begin implementation immediately:

1. Trust bundled helpers as public interfaces. Do **not** read their source,
   test verifiers, every template section, or all optional references first.
2. Do **not** probe or install the scientific Python stack up front. Use the
   available dependencies; for a small deterministic task, prefer the standard
   library. Add a dependency only when the selected model truly requires it.
3. Start the first substantive write within five tool calls after inventory.
   Work in bounded batches: at most four write/edit calls per model response,
   no giant all-project tool call, and leave enough output budget for valid
   tool-call closure. Implement code/results first, then paper sections in
   coherent groups; do not spend turns on cosmetic inspection between them.
4. Run `code/run_all.py`, repair its evidence, then call the finalizer without
   reading the finalizer's implementation.
5. Spend remaining turns only on failed checks and rendered-page defects.

When the project-local finalizer exits with code 0, the strict build, audit,
page rendering, packaging, and validation are already complete. Stop tool use
immediately and return the required final report. Do not write scratch verifier
scripts, inspect build caches, re-parse the PDFs, or rerun checks after a
successful finalizer. A successful finalizer is the terminal condition.

Do not repeat environment, path, template, or helper probes that already
succeeded. A progress plan must not delay the first substantive write.
If `paper/input-inventory.json`, `paper/contest-profile.json`, `code/qN`, and
`paper/main.tex` already exist, the scaffold is ready: do not read the Skill
directory, helper sources, or every placeholder section. Read only the problem
inventory/data and the target files needed for the next bounded write batch.
Never create an environment-probe script; run the required project entry point
and react only to a concrete missing dependency.

## Guidance routing and round-trip budget

This `SKILL.md` contains the complete mandatory contract. Do not spend the
opening tool turns reading every reference file. Prepare and inspect the actual
project first, then read only the reference needed at the decision point:

- structure: `references/project-architecture.md` and `paper-architecture.md`;
- model/code quality: `modeling-quality.md` and `code-and-output-style.md`;
- existing paper: `paper-revision.md`;
- CUMCM compliance: `cumcm-compliance.md`;
- final typesetting: `latex-figures-tables.md`.

Batch independent reads, writes, and safe commands. Do not repeatedly probe the
same binary input: use `inspect_inputs.py` once, then consume its extracted text
and structured inventory. Resolve references relative to this `SKILL.md` if
`skill://math-model-draft/` is unavailable. Supplied current contest rules and
templates always outrank this Skill's defaults.

## Select the operating mode

The default `/math-draft <project>` path is a one-request, end-to-end generation:
read the problem, model every question, implement and run the code, generate
results and figures, write the complete paper, compile, inspect, and package it.
Do not stop after scaffolding, an outline, sample paragraphs, or formatting.

Inspect the project before editing and choose one mode automatically:

- **Generate** (default for a problem directory): create the skeleton and fill
  every substantive section from the problem and computed evidence, then finish
  the PDF and support package in the same run.
- **Revise**: TeX/PDF and code/results already exist. Preserve sound content and
  make local additions or corrections; do not rewrite merely for style.
- **Audit**: the user asks only for findings. Run read-only checks and report;
  do not change project files.

For revision, read every relevant problem/attachment, latest code directory,
`results/`, `figures/`, current TeX/PDF, and any excellent-paper directory.
Reference papers guide structure and comparison only; they are never a source
of this project's results.

## Establish sources of truth

Use this precedence for factual conflicts:

1. official problem, supplied data, and current contest rules;
2. current runnable code and configuration;
3. program-generated JSON/CSV/XLSX and validation artifacts;
4. figures generated from those artifacts;
5. TeX and compiled PDF;
6. excellent papers and secondary commentary.

Treat `question/` as immutable. Use JSON/CSV as the numerical fact source and
check every summary/body/table/figure/conclusion value for units, signs,
precision, constraints, and consistency. Prefer a reference paper's final
results table over its abstract when auditing that paper's own numbers.
In TeX, never write raw underscores or other special characters in paths and
identifiers; use a safe path command such as `\path{code/q1/model.py}` or escape
the character explicitly. Treat the finalizer's first file/line diagnostic as
the repair target instead of launching ad-hoc TeX probes.

## Run the workflow

Resolve `<skill-root>` to this Skill's directory and `<project-root>` to the
project being handled.

### 1. Inventory and configure

```powershell
python "<skill-root>/scripts/inspect_inputs.py" <project-root>
python "<skill-root>/scripts/bootstrap_project.py" <project-root> --questions <N>
```

The inventory accepts canonical inputs under `question/` and supported problem
files placed directly in the project root. Root-level inputs remain in place and
are fingerprinted as immutable; do not move or duplicate them merely to satisfy
the canonical layout.

The bootstrap is additive and idempotent. It may add missing q-folders and
orchestrator entries, but must not overwrite authored content. Review
`paper/contest-profile.json`; select `cumcm-2026` only when applicable. Do not
silently apply CUMCM limits to another contest.

### 2. Plan evidence before prose

Maintain `paper/evidence-map.yaml`. Every material claim needs an identifier,
an in-project `results/` source, a target `paper/sections/` file, and status
`TODO` or `verified`. Define each subproblem's variables, units, constraints,
parameter sources, candidate methods, selection reason, data dependencies,
outputs, and validation.

### 3. Implement and run

- Put shared configuration/loading/plotting/validation in `code/always` and
  question-specific work in `code/qN`; keep each `main.py` orchestral.
- Validate raw data, fix seeds, record the environment, compare a transparent
  baseline where complexity matters, and use appropriate sensitivity,
  residual, uncertainty, cross-validation, or robustness checks.
- Run from a clean entry point and repair failures before asserting results.
- Save factual outputs in `results/qN`, paper-ready visuals in `figures/qN`,
  and completed workbook deliverables in `results/qN`.

```powershell
python <project-root>/code/run_all.py
python "<skill-root>/scripts/capture_environment.py" <project-root>
```

Once numerical outputs and figures have been accepted, treat them as a frozen
phase. The finalizer records their hashes in `paper/evidence-freeze.json`.
After that file exists, `--run-code` fails closed instead of silently changing
accepted facts. Recalculation requires an explicit user request and the paired
flags `--run-code --refresh-evidence`.

### 4. Write or revise from evidence

For every question, make the progression explicit: task interpretation,
variables and constraints, model choice and reason, equations, parameter
sources, algorithm, numerical results, interpretation, validation, conclusion,
and handoff to the next question. Keep the abstract informative: each question
must retain its model, algorithm, key values, and conclusion.

In revision mode, prefer surgical additions and corrections. Do not compress
the abstract, change global spacing, or replace large passages without factual
need. Ensure every figure is current, legible in Chinese, cited and interpreted
near first discussion, and free of clipping, overlap, drift, cross-question
misplacement, and abnormal whitespace. Check reference aliases, table labels,
paper-number shorthand, and bibliography numbering for mismatches.

If the appendix includes source code, regenerate it from the current code tree.
Whether support-file lists or source appendices are included is controlled by
the contest profile; official CUMCM requirements must not be disabled merely as
a stylistic preference.

### 5. Audit, build, package, and inspect every page

Use the one-command finalizer after the substantive code and paper are complete:

```powershell
python <project-root>/code/finalize.py --run-code --strict-layout --render-pages
```

Use `--run-code` for the first finalization only. For later typography,
appendix, disclosure, packaging, or audit repairs, omit it:

```powershell
python <project-root>/code/finalize.py --strict-layout --render-pages
```

The project-local launcher executes the active Skill's trusted finalizer without
requiring a shell command outside the workspace. It records the environment,
rebuilds with local TeX Live, audits and optionally
renders every page, packages support materials, and runs strict validation. Its
individual scripts may be run separately while repairing a failure.

Use the machine-readable audit report to resolve missing inputs, stale figures,
missing TeX assets, unresolved references, weak question sections, and stale
PDFs. Render the final PDF and inspect every page. There must be no blank page,
orphan heading, overflow, missing glyph, undefined reference, overfull/underfull
box, clipped figure/table, or inexplicable whitespace.

Clean only known caches and temporary render products after verification:

```powershell
python "<skill-root>/scripts/clean_project.py" <project-root> --apply
```

Never remove original questions, current code, effective results, paper figures,
TeX sources, final PDFs, or unknown files.

## AI-use compliance

Using this Skill is itself AI assistance. For CUMCM 2026, default to the
official “used AI” declaration unless the project demonstrably predates use.
Keep the declaration immediately before references and generate the required
`AI工具使用详情.pdf`. Record tool/model, stage and purpose, prompting process,
adoption/manual changes, and verification. Never present an unofficial AIGC or
AIDC percentage from a secondary article as an official disqualification rule.

## Completion gate

Finish only when inputs are inventoried; `question/` fingerprint is unchanged;
all q1/q2/... paths align; code runs; every reported number is evidence-linked;
assumptions, units, limitations, and validation are explicit; figures and code
appendix are current; TeX compiles under local TeX Live; the final PDF passes
page-by-page inspection; package contents satisfy the active profile; and every
remaining TODO or manual decision is reported.

The final response should contain only: material changes, defects fixed,
numerical consistency result, compile/layout verification, remaining TODOs, and
absolute paths to final files.
