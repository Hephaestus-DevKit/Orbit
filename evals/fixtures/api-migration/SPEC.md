# Batch normalization API migration

Replace the legacy one-record API with `normalizeRecords(records, options)` and
migrate `processRecords` to use it. The implementation must not mutate input,
must trim string fields by default, optionally lowercase keys, preserve
non-string values, and reject non-array input. Do not add dependencies.
