# Abort-safe delayed job runner

`runDelayedJob(task, delayMs, signal)` starts `task` once after the requested
delay and resolves to its result. It must reject with an error named
`AbortError` when the signal is already aborted or aborts before the task
starts. In that case the task must never execute. Remove timers and listeners
on every terminal path and never settle twice.

Reject negative or non-finite delays. Preserve the exported function signature.
