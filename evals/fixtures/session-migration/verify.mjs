import assert from "node:assert/strict";
import { migrateSession } from "./migrate.mjs";
import { isValidV2Session } from "./validate.mjs";

const input = {
  version: 1,
  id: "session-a",
  messages: [
    {
      role: "user",
      content: "hello",
      timestamp: "2026-08-09T00:00:00Z",
    },
    { role: "assistant", content: "hi" },
  ],
  metadata: { labels: ["eval"] },
};
const snapshot = JSON.stringify(input);
const migrated = migrateSession(input);
assert.equal(JSON.stringify(input), snapshot, "migration mutated v1 input");
assert.deepEqual(migrated, {
  version: 2,
  id: "session-a",
  turns: [
    {
      id: "turn-1",
      role: "user",
      content: "hello",
      timestamp: "2026-08-09T00:00:00Z",
    },
    { id: "turn-2", role: "assistant", content: "hi" },
  ],
  metadata: { labels: ["eval"] },
});
assert.equal(isValidV2Session(migrated), true);
migrated.metadata.labels.push("changed");
assert.deepEqual(input.metadata.labels, ["eval"], "metadata aliases the input");

const v2 = {
  version: 2,
  id: "s2",
  turns: [{ id: "turn-1", role: "user", content: "x" }],
};
const v2Copy = migrateSession(v2);
assert.deepEqual(v2Copy, v2);
assert.notEqual(v2Copy, v2);
assert.notEqual(v2Copy.turns, v2.turns);
assert.equal(
  isValidV2Session({
    version: 2,
    id: "s",
    turns: [{ role: "user" }],
  }),
  false,
);
assert.throws(() => migrateSession({ version: 9 }), /version|unsupported/i);

console.log("session migration verifier passed");
