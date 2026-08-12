# Paper architecture and writing standard

## Contents

1. [Observed strong-paper pattern](#observed-strong-paper-pattern)
2. [Required section sequence](#required-section-sequence)
3. [Abstract contract](#abstract-contract)
4. [Subproblem microstructure](#subproblem-microstructure)
5. [Reasoning and prose rules](#reasoning-and-prose-rules)
6. [Final evaluation](#final-evaluation)

## Observed strong-paper pattern

The reviewed 2025 A/B/C national papers consistently:

- state each subproblem's method and numerical conclusion in the abstract;
- convert the statement into a visible dependency map before solving;
- separate assumptions and notation from model derivation;
- organize the core by subproblem rather than by a generic algorithm catalog;
- show equations, algorithms, tables, and figures close to their interpretation;
- validate with sensitivity, residuals, confidence intervals, cross-validation,
  stability, or comparative methods;
- discuss limitations and extension after completing all subproblems;
- place long code and support-file inventories in appendices.

Use these as quality attributes, not a rigid imitation. Avoid their occasional
weaknesses: decorative background text, unsupported adjectives, excessive
symbol density, code screenshots, and AI tools cited as evidence for factual
claims.

## Required section sequence

For CUMCM-style papers use:

1. Title, abstract, keywords on the first electronic page.
2. Problem restatement:
   background only as needed, then precise requested outputs.
3. Problem analysis:
   dependency diagram and one compact analysis subsection per qN.
4. Model assumptions:
   assumption, rationale, consequence, and failure risk.
5. Symbol explanation:
   symbol, meaning, unit, scope; omit trivial one-use notation.
6. Data understanding and preprocessing:
   schema, missingness, anomalies, units, transformations, exclusions.
7. Model preparation or shared mechanism:
   only content genuinely reused across questions.
8. One major section per qN.
9. Model evaluation, limitations, and possible extensions.
10. Corresponding inline AI marks and an AI tool reference entry when AI was
    used; a concise disclosure paragraph may also be included.
11. References.
12. Appendix:
    the exact support-archive file list followed by complete runnable source.
    Group the list by directory instead of omitting names or printing one noisy
    path per line. Keep `AI工具使用详情.pdf` in the support ZIP rather than
    duplicating its contents in the paper.

Do not include a table of contents when CUMCM rules prohibit it.

## Abstract contract

Write the abstract last. Keep it within one page including title and keywords.

Use this logic:

1. One or two sentences: decision context and the central modeling challenge.
2. For each qN:
   - name the constructed model or transformation;
   - identify the decisive data/constraint;
   - report the primary quantitative result with units;
   - state the validation or robustness evidence.
3. One sentence: overall value, boundary, or recommendation.
4. Three to five discriminative keywords.

Reject an abstract that:

- merely says "a model was established";
- lists algorithms without explaining their role;
- contains no quantitative result where the problem permits one;
- reports precision without sample size or evaluation design;
- introduces facts absent from code/results;
- uses "good", "accurate", "reasonable", or "significant" without evidence.

## Subproblem microstructure

Keep one major section per numbered question. This mapping is useful to judges
and should not be replaced by paper-wide “method”, “results”, and “discussion”
sections that mix evidence from different questions.

Within each question, use an adaptive two-level outline. A substantial question
normally needs five to seven domain-specific subsections in this order:

1. **Objective and inputs**: what is computed, for whom, and under which units.
2. **Method choice**: candidate methods and why the chosen one fits.
3. **Model construction**: variables, assumptions, equations, constraints.
4. **Solution procedure**: algorithm or estimation steps.
5. **Results**: one primary table/figure plus exact output path.
6. **Interpretation**: practical meaning, not a second description of the plot.
7. **Validation**: error, uncertainty, robustness, sensitivity, or comparison.
8. **Sub-conclusion**: directly answer the statement in two or three sentences.

These are reasoning stages, not mandatory literal titles. Combine adjacent
stages when the question is short or one stage has no independent evidence;
split a stage when it contains distinct models or decisions. Prefer headings
such as “时间外推性能”, “弹性模型与稳定性处理”, or “历史回放与Pareto筛选” over
repeated generic headings such as “方法选择与模型建立” or “结果与解释”. A
subsection should contain a real claim, derivation, artifact, or validation—not
exist merely to make the outline longer.

Use the PDF bookmark pane as a structural test: collapsing a question should
show the question-level answer; expanding it should reveal the modeling and
evidence chain without requiring the judge to scan prose. If a question spans
more than about one page but exposes only one or two undifferentiated
subsections, refine the outline before adding more text.

For dependent questions, begin by declaring which upstream artifacts are used
and why error propagation is acceptable.

## Detail budget

- Keep a body table to one page whenever possible.
- Summarize all-item or all-date outputs by decision-relevant group, then point
  to the complete CSV/XLSX in support materials.
- Print the exact grouped file inventory required by current CUMCM rules, but
  keep machine-readable result rows in support CSV/XLSX rather than the body.
- Build source appendices from actual runnable files, not a parallel
  `core_code` summary that can drift from execution.
- Exclude finalizers, packagers, audit scripts, empty package markers, caches,
  and generated source from the modeling-code appendix.

## Reference-paper comparison

- Split page counts into body, references, source appendix, and result appendix
  before comparing two PDFs.
- Compare each subproblem's question, method, evidence, interpretation,
  validation, and limitations; do not use total length as a quality proxy.
- Normalize for subproblem count and domain. Equation-heavy mechanistic models
  naturally need more derivation than empirical prediction pipelines.
- Do not expand the body to compensate for a complete source appendix, or
  shrink the body because the appendix already makes the PDF long.
- Require every bibliography item to have at least one in-text citation, placed
  next to the method or claim it supports.

## Reasoning and prose rules

- Lead each paragraph with its claim; follow with evidence and implication.
- Explain why a model fits before presenting formulas.
- Define each symbol at first use and keep notation stable.
- State units in prose, tables, axes, and results.
- Distinguish observed, estimated, predicted, optimized, and assumed values.
- Report sample size, split strategy, random seed, and metric definition.
- Separate statistical significance from practical importance.
- Use calibrated precision; do not print more decimals than data justify.
- Reference every figure/table before it appears.
- Give captions enough context to stand without surrounding prose.
- Avoid tutorial-style explanations of standard algorithms; explain only the
  customization, assumptions, and effect on this problem.
- Use `TODO[missing evidence: ...]` rather than fabricating transitions.

## Final evaluation

Evaluate:

- model strengths tied to problem structure;
- limitations tied to assumptions, data, computation, or external validity;
- realistic improvements with expected effect;
- generalization conditions and situations where the model should not be used.

Do not use generic claims such as "high accuracy", "strong innovation", or
"wide applicability" without a test or concrete boundary.
