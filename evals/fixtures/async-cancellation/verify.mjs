import assert from "node:assert/strict";
import { runDelayedJob } from "./job-runner.mjs";

const wait = (milliseconds) =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));

let executions = 0;
const preAborted = new AbortController();
preAborted.abort();
await assert.rejects(
  runDelayedJob(
    () => {
      executions += 1;
    },
    5,
    preAborted.signal,
  ),
  { name: "AbortError" },
);

const controller = new AbortController();
const pending = runDelayedJob(
  () => {
    executions += 1;
    return "late";
  },
  30,
  controller.signal,
);
controller.abort();
await assert.rejects(pending, { name: "AbortError" });
await wait(50);
assert.equal(executions, 0, "cancelled task executed after rejection");

assert.equal(
  await runDelayedJob(() => {
    executions += 1;
    return "ok";
  }, 1),
  "ok",
);
assert.equal(executions, 1);
await assert.rejects(
  runDelayedJob(() => "never", -1),
  /delay/i,
);

console.log("async cancellation verifier passed");
