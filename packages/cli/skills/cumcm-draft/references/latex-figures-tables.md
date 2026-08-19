# LaTeX, figures, and tables

## Page system

- Use `ctexart` with XeLaTeX for Chinese.
- Use the supplied contest template and `.cumcm/profile.json`; for the
  bundled CUMCM 2026 profile use A4 and margins of at least 2.5 cm.
- Keep the electronic first page as title, abstract, and keywords only.
- Center Arabic page numbers in the footer starting at 1.
- Do not add a contents page for CUMCM.
- Keep the body visually restrained: black text, consistent hierarchy, and
  minimal decorative color.

## Equations

- Introduce the purpose of an equation before displaying it.
- Number only equations referenced later.
- Define symbols and units near first use.
- Use aligned environments for multi-line derivations.
- Check dimensional consistency.
- Do not use screenshots of formulas.

## Tables

- Use `booktabs`; avoid full cell grids unless the data requires them.
- Put units in headers.
- Align decimals and use meaningful precision.
- Report sample size and metric definition with evaluation tables.
- Keep tables within text width; use landscape or appendix for genuinely wide
  data rather than shrinking to unreadable text.
- Do not paste raw intermediate tables into the body.
- Treat more than about 25 detail rows or more than one continued page as a
  prompt to aggregate. Keep complete rows in CSV/XLSX and show a compact
  category, period, quantile, or representative-item summary in the paper.

## Figures

- Generate every final figure as PNG at 300 dpi or higher.
- Do not leave PDF, SVG, JPG, or EPS siblings in `figures/`; keep transient
  vector exports under `.cumcm/build/` when an analysis tool needs them.
- Use Chinese filenames and Chinese titles, axes, legends, annotations, and
  category labels, with a CJK-capable font fallback.
- Make labels readable at final printed size.
- Use consistent sizes and palette across questions.
- Distinguish series by more than color when grayscale printing is plausible.
- Avoid legends that cover data.
- Place a figure after its first textual reference.
- Write captions that state object, condition, and takeaway without making an
  unsupported causal claim.

## Cross-references and citations

- Use `\label` and `\ref`/`\eqref`; do not hardcode figure/table numbers.
- Use BibTeX or a consistently formatted manual bibliography.
- Cite methods at first substantive use.
- Cite data definitions and external parameter values.
- Never leave raw URLs in body prose when a reference entry is appropriate.

## Build and visual QA

- Compile twice or use `latexmk -xelatex`.
- Treat undefined references, missing citations, overfull/underfull boxes,
  missing glyphs, and duplicate labels as failures in the final build.
- Render the final PDF and inspect every page.
- Check the abstract page, dense equations, wide tables, multi-panel figures,
  appendix transitions, page numbers, and final blank pages.
- Inspect text alignment visually; a clean TeX log does not detect overlapping
  glyphs inside dense `longtable` rows.
