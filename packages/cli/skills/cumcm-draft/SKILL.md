---
name: cumcm-draft
description: Build, revise, or audit a CUMCM Chinese mathematical-modeling project against the current official paper, support-archive, anonymity, citation, and AI-use rules. Produces evidence-linked Chinese LaTeX, runnable q1/q2 code, validated results and figures, a complete source appendix, AI-use records, and a submission-ready PDF/ZIP pair. Use explicitly for 全国大学生数学建模竞赛、国赛、CUMCM、国赛论文初稿或定稿审查、CUMCM TeX/PDF修订、支撑材料打包及模型—代码—结果—论文一致性核验；do not use for MCM/ICM.
---

# Build or revise a CUMCM paper

Deliver a compilable, evidence-backed project, not an outline or generic prose.
An end-to-end AI-generated project is a training artifact, not automatically a
submission-eligible contest entry. Claim submission readiness only when the
active profile records formal intent, team-led core modeling, and completed
manual review under the official AI rule.
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
   tool-call closure. Implement code/results first, then `paper/main.tex` in
   coherent groups; do not spend turns on cosmetic inspection between them.
4. Run `code/run_all.py`, repair and freeze its evidence, then perform one
   evidence-to-paper synchronization pass before calling the finalizer without
   reading the finalizer's implementation. The finalizer is a terminal gate,
   not a discovery tool: do not launch it while known code/result/paper
   mismatches remain.
5. Spend remaining turns only on failed checks and rendered-page defects.

When the project-local finalizer exits with code 0 and prints
`[ORBIT_TERMINAL_SUCCESS]`, the strict build, audit, page rendering, packaging,
and validation are already complete. Stop tool use immediately and return the
required final report. Do not edit code, evidence, figures, or paper sources;
write scratch verifier scripts; inspect build caches; re-parse the PDFs; or
rerun checks after a successful finalizer. A successful finalizer is the
terminal condition. If any source is intentionally changed afterward, the old
PDF, evidence freeze, and support archive are stale: return to the appropriate
earlier phase and run the finalizer again before claiming completion.

Do not repeat environment, path, template, or helper probes that already
succeeded. A progress plan must not delay the first substantive write.
If `.cumcm/input-inventory.json`, `.cumcm/profile.json`, `code/qN`, and
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
`skill://cumcm-draft/` is unavailable. Supplied current contest rules and
templates always outrank this Skill's defaults.

## Select the operating mode

The default `/cumcm-draft <project>` path is a one-request, end-to-end generation
(`/math-draft` remains a compatibility alias):
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

Also classify submission intent in `.cumcm/profile.json`:

- `training`: Orbit may build an end-to-end rehearsal artifact, but the final
  report must state that AI-led core modeling cannot be submitted as team-led
  work without an independent team redo and review.
- `formal`: set this only after the team supplies or approves the core model,
  assumptions, objective, validation design, and conclusions. Record
  `core_modeling_led_by_team: true` and `manual_review_completed: true` only
  after those facts are true. The finalizer rejects a formal profile otherwise.

For revision, read every relevant problem/attachment, latest code directory,
`results/`, `figures/`, current TeX/PDF, and any excellent-paper directory.
Reference papers guide structure and comparison only; they are never a source
of this project's results.
When the user supplies an existing project as a layout reference, inspect its
directory and final PDF read-only. Reuse effective structure without copying
abridged code, identities, caches, or other defects. An explicitly requested
handoff layout outranks the default scaffold. Use neutral root filenames
`main.tex` and `main.pdf` unless submission rules require another name.
Compare reference and target PDFs by body coverage and appendix coverage
separately, normalized for the number and nature of subproblems. Never imitate
total page count when a long source appendix or a more equation-heavy domain
explains the difference.

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
Numerical traceability is necessary but not sufficient: separately audit the
business meaning of each transformed field, the time at which every feature is
available, and whether the reported evaluation was isolated from model and
parameter selection.
In TeX, never write raw underscores or other special characters in paths and
identifiers; use a safe path command such as `\path{code/q1/forecasting.py}` or escape
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
orchestrator entries, but must not overwrite authored content. Confirm the
current official CUMCM format, participation, and AI-use sources before each
new contest cycle, record them in `.cumcm/profile.json`, and use the
bundled `cumcm-2026` profile only while those sources remain current.

### 2. Plan evidence before prose

Maintain `.cumcm/evidence-map.yaml`. Every material claim needs an identifier,
an in-project `results/` source, `paper/main.tex` as its paper target, and status
`TODO` or `verified`. Define each subproblem's variables, units, constraints,
parameter sources, candidate methods, selection reason, data dependencies,
outputs, and validation. For decision or forecasting tasks, classify every
feature as known/planned at decision time, forecastable, or realized only after
the outcome. Record explicit upstream artifact contracts between subproblems.

### 3. Implement and run

- Create a shared code module only after two or more questions actually reuse
  the same configuration/loading/plotting/validation logic. Do not scaffold an
  empty `always` or `common` package pre-emptively. Give every generated artifact one producing subproblem and
  store it in `results/qN`. Downstream questions may read an upstream qN result;
  do not create `results/always`, `results/shared`, or another ownerless result
  directory. Keep each `main.py` orchestral. After reading the problem, name
  modules for their actual responsibility, such as `forecasting.py`,
  `evaluation.py`, `elasticity.py`, `pricing.py`, `simulation.py`, or
  `reporting.py`. Do not generate the same `main.py + model.py + output.py`
  trio for every question: a generic split that leaves one large `model.py` and
  a trivial `output.py` is not modular. Add concise Chinese `#` comments for
  modeling assumptions, units, leakage guards, numerical safeguards, boundary
  conditions, and non-obvious execution order; do not narrate obvious syntax.
- Validate raw data, fix seeds, record the environment, compare a transparent
  baseline where complexity matters, and use appropriate sensitivity,
  residual, uncertainty, cross-validation, or robustness checks.
- Audit field semantics before arithmetic transformations. Do not interpret a
  discount, bundle, buy-one-get-one, event note, stock snapshot, return, or
  backorder flag identically across business contexts merely because the source
  column is numeric. Flag impossible or ambiguous rows and preserve the raw
  value; never hide a semantic error by clipping it into a plausible number.
- Separate estimation/training, selection/validation, and final evaluation.
  Choose candidate models, ensemble weights, thresholds, interval calibration,
  and optimization policy parameters without using the final test period. Use
  the test set once after the choice is locked. Prefer the simplest candidate
  that wins the declared validation criterion, and allow an ensemble component
  to receive zero weight when it adds no evidence-backed value.
- Make cross-question dependencies executable: downstream code must read the
  declared upstream result file and validate entity coverage, dates, units,
  columns, and uniqueness before use. Do not silently recompute a different
  proxy or switch to another attachment when the expected upstream artifact is
  incomplete.
- Describe an optimization result as conditional on its objective, constraints,
  data window, scenario, and candidate/search space. Evaluate policies on data
  not used to select them; never add test-set constraints that manufacture a
  guaranteed improvement. Preserve the original policy or disclose a tradeoff
  when robust improvement is unsupported.
- Run from a clean entry point and repair failures before asserting results.
- Save factual outputs in `results/qN`, paper-ready visuals in `figures/qN`,
  and completed workbook deliverables in `results/qN`.
- Treat leaf tabular deliverables under `results/qN` as Chinese-facing evidence:
  give CSV/TSV/XLS/XLSX files descriptive Chinese filenames; write CSV/TSV
  column headers, Excel worksheet names, and Excel table headers in Chinese;
  include units in the header when applicable; and retain standard symbols or
  abbreviations only after the Chinese meaning, such as `均方根误差（RMSE）`.
  Encode CSV/TSV with UTF-8-SIG for reliable Excel display. Do not emit a
  generic `summary.json` into results merely to satisfy the workflow; evidence
  claims must point to the real Chinese-named result artifact. Workflow state
  and reproducibility metadata belong under `.cumcm/`, not `results/`.
- Give every final figure a descriptive Chinese filename that states what is
  shown. Names such as `summary.png`, `plot.png`, `figure.png`, `output.png`,
  or `final.png` are invalid even when the graphic itself is correct.
- Preserve a non-Chinese filename, header, or worksheet name only when the
  problem statement or supplied fill-in template fixes it. Do not translate or
  silently reshape that prescribed schema. Register the exact output path,
  immutable `question/` source (or root-level problem input), reason, and only
  the necessary allowances in
  `.cumcm/profile.json.result_artifacts.fixed_schema_exceptions` so the
  finalizer can distinguish a contest requirement from an accidental English
  artifact. The finalizer requires every waived field to match that cited
  source; citation without schema congruence is rejected. Internal convenience
  and cross-question code contracts are not
  exceptions; use a Chinese persisted schema and validate it explicitly.
- Keep `paper/` compact throughout the workflow: `main.tex`,
  `AI工具使用详情.tex`, their final PDFs, and `支撑材料.zip` only (plus
  unavoidable compiler files when an external editor creates them). Never
  expose `paper/sections/` or `paper/build/`; generated appendices and build
  caches belong under `.cumcm/`. Keep
  internal CSV/JSON evidence under `results/qN`. Package code, necessary
  machine-readable results, larger intermediate figures, and the AI details PDF
  into the support ZIP before removing any reproducible workspace figures.
  Do not remove reproducible figures that are cited by the paper or required by
  the support archive.

```powershell
python <project-root>/code/run_all.py
python "<skill-root>/scripts/capture_environment.py" <project-root>
```

Once numerical outputs and figures have been accepted, treat them as a frozen
phase. The finalizer records their hashes in `.cumcm/evidence-freeze.json`.
After that file exists, `--run-code` fails closed instead of silently changing
accepted facts. Recalculation requires an explicit user request and the paired
flags `--run-code --refresh-evidence`.

Before finalization, do exactly one bounded evidence-to-paper synchronization
pass: compare the generated summaries and material result tables with the
abstract, every numbered-question section, conclusion, evidence map, and
AI-use record. Resolve every stale value, filename, unit, and claim before
launching the finalizer. If code or evidence changes during paper authoring,
rerun the affected producer and repeat this synchronization pass; never leave a
newer TeX source paired with an older PDF or support archive.

### 4. Write or revise from evidence

Use one major `\section` per numbered question so the paper maps directly to
the statement. Inside that section, expose the actual reasoning chain with
roughly five to seven domain-specific `\subsection` headings: objective and
inputs, method rationale, model/constraints, solution procedure, results,
validation, and conclusion or downstream interface. Merge adjacent stages only
for a genuinely short question. Do not reuse the same four broad headings such
as “方法选择与模型建立” and “结果与解释” for every question; rename headings to
state what is being estimated, optimized, compared, or verified. Keep the
abstract informative: each question must retain its model, algorithm, key
values, and conclusion.

Keep only decision-relevant summaries in the paper body. When daily, per-item,
per-grid, or all-sample detail would take more than one page, replace it with a
grouped summary or representative slice and retain every row in CSV/XLSX under
`results/qN`; cite that relative path in the paper. Never paste machine-readable
detail into a long table merely to prove that it was generated.

In revision mode, prefer surgical additions and corrections. Do not compress
the abstract, change global spacing, or replace large passages without factual
need. Ensure every figure is current, legible in Chinese, cited and interpreted
near first discussion, and free of clipping, overlap, drift, cross-question
misplacement, and abnormal whitespace. Check reference aliases, table labels,
paper-number shorthand, and bibliography numbering for mismatches.

Regenerate the appendix from the current project immediately before the final
build. For CUMCM, the support-file list and complete runnable source appendix
are mandatory and cannot be disabled as a stylistic preference. The displayed
file list must match the final ZIP exactly; group entries by directory to keep
the list readable without omitting filenames.
Build a source appendix from the actual runnable files; never maintain a
parallel `core_code` excerpt or hand-written substitute. Include the unified
entry point and its modeling dependency closure, but omit empty `__init__.py`,
finalizer launchers, packagers, audit scripts, and caches. Use numbered,
line-wrapped, thin-framed listings.

Before packaging, derive `code/requirements.txt` from the imports and actual
file readers used by the runnable model (including engines such as `openpyxl`),
then remove unused packages and stale dependency entries. Keep validation-set
metrics and model-selection evidence, but do not deliver scratch verifiers,
cleanup/rebuild scripts, contact-sheet generators, nested project archives, or
temporary caches unless the problem explicitly requires them.

### 5. Audit, build, package, and inspect every page

Use the `run_tests` tool—not the generic shell tool—for the one-command
finalizer after the substantive code and paper are complete. `run_tests`
records verification evidence and the trusted terminal-completion contract:

```powershell
python <project-root>/.cumcm/finalize.py --run-code --strict-layout --render-pages
```

Use `--run-code` for the first finalization only. For later typography,
appendix, disclosure, packaging, or audit repairs, omit it:

```powershell
python <project-root>/.cumcm/finalize.py --strict-layout --render-pages
```

The private project-local launcher under `.cumcm/` executes the active Skill's trusted finalizer without
requiring a shell command outside the workspace. It records the environment,
rebuilds with local TeX Live, audits and optionally
renders every page, packages support materials, and runs strict validation. Its
individual scripts may be run separately while repairing a failure.

Use the machine-readable audit report to resolve missing inputs, stale figures,
missing TeX assets, unresolved references, weak question sections, and stale
PDFs. Render the final PDF and inspect every page. There must be no blank page,
orphan heading, overflow, missing glyph, undefined reference, overfull/underfull
box, clipped figure/table, or inexplicable whitespace.
Log checks do not replace visual judgment: inspect glyph overlap, column drift,
and repeated headers in dense pages. Any detail table continuing for two or
more pages must be challenged; if the complete data already exists in support
files, replace the body table with a compact summary.
Ensure every bibliography entry is cited and every externally sourced method
has a nearby citation; remove ornamental uncited references.

Clean only known caches and temporary render products after verification:

```powershell
python "<skill-root>/scripts/clean_project.py" <project-root> --apply
```

Never remove original questions, current code, effective results, paper figures,
TeX sources, final PDFs, or unknown files.

## AI-use compliance

Using this Skill is itself AI assistance. Apply the official 2026 trial AI
rule: place a dedicated `AI工具使用声明` immediately before the references. For
this Skill, use the official used-AI sentence exactly, replacing only its
bracketed purpose:

`本参赛队在竞赛过程中使用了AI工具，主要用于〖简要用途，如语言润色、代码调试等〗，详细使用情况见支撑材料。`

Include `AI工具使用详情.pdf` inside the support ZIP. It must record the actual
tool and model, purpose and stage, major prompting approach and usage process,
and the principal adoption, manual changes, and verification; typical
interactions may be included but are not mandatory. The 2026 rule does not
require per-paragraph AI markers or an AI-tool bibliography entry, so do not
invent those as official gates. The unused declaration is impossible when this
Skill contributed to the work.

Do not rewrite deep AI participation as team-independent core modeling. The
official rule requires the team to lead core modeling and analysis and manually
review and verify every AI-assisted contribution. If AI performed core modeling
or analysis in a training artifact, disclose that fact and warn that the
artifact cannot be submitted as an independently completed contest entry
without being independently redone and verified by the team. Never present an
unofficial AIGC/AIDC percentage as an official threshold.

## Completion gate

Finish only when inputs are inventoried; `question/` fingerprint is unchanged;
all q1/q2/... paths align; code runs; every reported number is evidence-linked;
assumptions, units, limitations, and validation are explicit; figures and code
appendix are current; TeX compiles under local TeX Live; the final PDF passes
page-by-page inspection; package contents satisfy the active profile; and every
remaining TODO or manual decision is reported. A formal profile additionally
requires truthful team-led core modeling and completed manual AI review flags.

The final response should contain only: material changes, defects fixed,
numerical consistency result, compile/layout verification, submission
intent/eligibility, remaining TODOs, and absolute paths to final files.
