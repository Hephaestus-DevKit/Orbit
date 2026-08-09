# Session schema migration

Migrate version-1 sessions from `messages` to version-2 `turns`. Each migrated
turn has a deterministic one-based ID (`turn-1`, `turn-2`, ...), while role,
content, and optional timestamp are preserved. Session ID and metadata are
preserved.

`migrateSession` accepts versions 1 and 2, returns a deep independent value,
does not mutate its input, and rejects unsupported versions. `isValidV2Session`
must reject malformed session/turn structures rather than checking the version
alone. Keep both public function names and the two-module structure.
