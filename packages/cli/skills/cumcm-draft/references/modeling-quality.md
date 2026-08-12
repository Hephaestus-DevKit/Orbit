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

## Audit business semantics before transformation

- Build a short field ledger: source meaning, unit, observation time, valid
  range, structural missingness, and permitted transformation.
- Do not apply one arithmetic rule to semantically different promotions,
  tariffs, bundles, censored values, or status flags.
- Preserve raw columns beside derived columns. Mark ambiguous or impossible
  values explicitly instead of clipping them into apparently valid evidence.
- Distinguish a global event date from sparse row-level event notes. If a note
  identifies a store-wide event, verify whether all entities on that date need
  the event indicator.
- Name event-window statistics precisely: number of qualifying days, last
  qualifying offset, and longest consecutive run are different quantities.

## Enforce decision-time availability

For every prediction or decision feature, record one class:

- known or planned before the decision;
- obtainable from a separate forecast available before the decision;
- realized only after the target outcome.

Use only the first two classes at their historically available versions.
Lag end-of-day inventory, returns, stockouts, backorders, realized weather, or
other post-outcome variables when predicting the same day. Apply the same rule
to recursive future prediction; do not train with observed lags and silently
replace them with unavailable contemporaneous values at deployment.

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

Use distinct data roles:

- training/estimation fits model parameters;
- validation selects model family, features, weights, thresholds, interval
  calibration, and policy parameters;
- test evaluates the locked pipeline once.

Never report the best test candidate after trying several candidates on the
test set. An ensemble is allowed to collapse to one component or assign another
component zero weight. A simple winning baseline is a valid final model.

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

For sequential optimization or simulation, separate parameter estimation,
policy selection, and policy evaluation by time or independent scenarios.
Do not use final-test feasibility or Pareto filters to guarantee that every
reported test metric improves.

## Verify cross-question contracts

- Define the producer, relative result path, schema, entity key, date range,
  units, and missing-data policy for every upstream artifact.
- Make downstream code read that artifact directly and fail closed on missing
  entities, duplicate keys, stale dates, unexpected units, or incomplete rows.
- Do not replace a missing upstream forecast with an attachment, historical
  mean, or freshly fitted proxy without disclosing and validating the fallback.
- Re-run all downstream questions after an upstream fact changes; then update
  figures, paper values, conclusions, and the evidence map together.

## State optimization claims honestly

- Say “best among the evaluated candidates” or “model-constrained optimum”
  unless a global-optimality proof or bound exists.
- State the objective, horizon, constraints, search grid, and data window next
  to the recommended decision.
- Report constraint conflicts and units/entities that worsen even when the
  aggregate objective improves.
- Preserve non-ideal but validated outcomes, including zero ensemble weight,
  retained original policies, higher safety stock, or an absent improvement.

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

Use `status: verified` only after the producing code has run and the claim's
schema, constraints, selection protocol, and independent validation evidence
have passed. File existence or agreement between JSON and TeX is not enough.

## Prevent unsupported output

- Never invent sample sizes, parameter values, citations, or performance.
- Never call a result significant without a defined statistical test.
- Never infer causality from association without an identification argument.
- Never claim generalization beyond observed conditions without scenarios or
  external evidence.
- Preserve an explicit `TODO` when evidence cannot be obtained.
