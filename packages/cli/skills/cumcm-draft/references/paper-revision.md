# Existing-paper revision and consistency audit

Use this workflow when a project already contains TeX/PDF, code, outputs, or
reference papers. The objective is to make the submitted paper true, complete,
and readable while preserving good authored work.

## Read before editing

Inventory and read, where present:

- problem statements, official templates, rules, and attachments;
- the newest code tree and its configuration/entry points;
- `results/` machine-readable outputs and `figures/`;
- all TeX entry points, included sections, bibliography, and current PDF;
- excellent/reference papers, especially their final results tables.

Resolve ambiguous “latest” directories by modification time plus entry-point
references. Do not infer currency from a folder name alone.

## Question-by-question completeness

Each question should form a traceable argument:

1. what the question asks and what is delivered;
2. variables, targets, units, constraints, and upstream inputs;
3. why the chosen model fits better than plausible alternatives;
4. equations and parameter provenance;
5. solver/algorithm steps matching the actual implementation;
6. numerical results sourced from JSON/CSV/XLSX;
7. interpretation in the problem's terms;
8. appropriate validation, sensitivity, uncertainty, or baseline comparison;
9. direct conclusion and link to the next question.

Thin prose is repaired with local evidence-backed additions. Do not add a
method simply because another paper uses it.

## Numerical cross-check

Build a ledger for every material value: source path and field, paper locations,
unit, transformation, precision, and status. Compare abstract, body, tables,
captions, figures, conclusions, and appendices. Check negative signs, percentage
versus fraction, coordinate/order conventions, constraint directions, and
rounding. A program-generated JSON/CSV value wins over a hand-entered TeX value
unless code/output is proven stale and rerun.

## Figures and tables

Confirm each figure was produced by current code, appears near first discussion,
has a preceding textual reference, and receives interpretation beyond repeating
its caption. Check Chinese fonts, legends, units, resolution, clipping, overlap,
float drift, cross-question placement, and blank-page/whitespace effects. Remove
obsolete figures only when provenance proves they are generated duplicates and
the deletion is safe; otherwise report them.

For comparisons with excellent papers, use their final result table as the
paper's authoritative value and verify that aliases such as “论文1/2/3” match
table columns, prose, and bibliography entries.

## Editing boundaries

- Preserve the abstract's information density. Each question should retain its
  model, algorithm, key numerical result, and conclusion.
- Prefer localized additions, factual corrections, and float placement fixes.
- Do not change global spacing or reformat the entire paper unless a verified
  layout defect requires it.
- Regenerate pasted code appendices from current source; do not hand-maintain
  stale listings.
- Do not delete important or unknown materials. Ask only when a model direction
  would change or a deletion cannot be proven safe.

## Final QA

Compile with local TeX Live. Inspect the actual final PDF page by page and the
log for missing glyphs, undefined citations/references, overfull/underfull boxes,
blank pages, orphan headings, table/figure overflow, and abnormal whitespace.
Clean only deterministic caches and temporary page renders after QA.
