# Modeling and evidence quality

## Translate the task

For every subproblem record:

- target quantity or decision;
- observational unit and time/space scale;
- controllable and uncontrollable variables;
- constraints, units, and required deliverable;
- dependence on earlier subproblems;
- acceptable error or comparison criterion.

## Audit data before modeling

- Inventory sheets, tables, row counts, columns, units, formulas, and blanks.
- Preserve identifiers as strings when leading zeros matter.
- Distinguish structural zeros, measured zeros, missing values, and below-limit
  values.
- Check duplicate entities, inconsistent units, impossible ranges, leakage,
  and repeated measurements.
- Explain every exclusion or imputation and save an audit table.
- Fit preprocessing on training data only when evaluating predictions.
- Use compositional-data methods for constrained proportions when ordinary
  correlations or Euclidean distances would be misleading.

## Select models by the problem

Start with a transparent baseline. Add complexity only when it improves a
defined criterion or resolves a structural limitation.

Compare candidates on:

- compatibility with assumptions and data volume;
- interpretability required by the question;
- constraint handling;
- uncertainty quantification;
- stability and computational cost;
- out-of-sample or scenario performance.

Do not combine algorithms merely to appear innovative.

## Validate at the right level

Choose evidence appropriate to the claim:

- regression: residual structure, error metrics, intervals, collinearity;
- classification: class counts, confusion matrix, per-class precision/recall,
  F1, calibration, stratified or grouped validation;
- clustering: stability, silhouette or domain separation, sensitivity to k;
- optimization: feasibility, optimality gap/bounds, baseline comparison,
  parameter sensitivity, multiple starts;
- time series: rolling-origin validation, residual autocorrelation, intervals;
- simulation: convergence, Monte Carlo error, scenario coverage;
- mechanistic model: dimensional checks, conservation, limiting cases,
  parameter identifiability;
- ranking/evaluation: weight sensitivity, rank stability, consistency checks.

Respect grouped, temporal, or spatial dependence. Do not randomly split rows
that share the same entity or leak future information.

## Quantify uncertainty and robustness

- Perturb influential inputs over defensible ranges.
- Refit or rerun the full pipeline rather than perturbing only the final table.
- Report which conclusions are invariant and which change.
- Use bootstrap or simulation when analytic intervals are unavailable.
- Distinguish parameter uncertainty, measurement error, model-form error, and
  scenario uncertainty.

## Maintain evidence lineage

Every paper claim must map to:

- generating module/function;
- input dataset or upstream result;
- result file and field/table;
- validation evidence;
- paper section and figure/table label.

Keep this mapping in `paper/evidence-map.yaml`. Do not type important numbers
into LaTeX from memory.

## Prevent unsupported output

- Never invent sample sizes, parameter values, citations, or performance.
- Never call a result significant without a defined statistical test.
- Never infer causality from association without an identification argument.
- Never claim generalization beyond observed conditions without scenarios or
  external evidence.
- Preserve an explicit `TODO` when evidence cannot be obtained.
