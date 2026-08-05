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
10. AI-use declaration when required by the active contest profile.
11. References.
12. Appendix:
    support-file list and complete runnable source when required by the active
    contest profile. A separately submitted AI-use details PDF is not duplicated
    as a long appendix unless the rules explicitly request that.

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

Use the following internal order for each `qN`:

1. **Objective and inputs**: what is computed, for whom, and under which units.
2. **Method choice**: candidate methods and why the chosen one fits.
3. **Model construction**: variables, assumptions, equations, constraints.
4. **Solution procedure**: algorithm or estimation steps.
5. **Results**: one primary table/figure plus exact output path.
6. **Interpretation**: practical meaning, not a second description of the plot.
7. **Validation**: error, uncertainty, robustness, sensitivity, or comparison.
8. **Sub-conclusion**: directly answer the statement in two or three sentences.

For dependent questions, begin by declaring which upstream artifacts are used
and why error propagation is acceptable.

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
