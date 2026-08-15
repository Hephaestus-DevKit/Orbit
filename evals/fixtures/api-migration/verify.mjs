import assert from "node:assert/strict";
import { normalizeRecords } from "./normalize.mjs";
import { processRecords } from "./pipeline.mjs";

const source = [{ Name: "  Alice  ", Score: 7 }, { Name: " Bob " }];
assert.deepEqual(normalizeRecords(source), [
  { Name: "Alice", Score: 7 },
  { Name: "Bob" },
]);
assert.deepEqual(normalizeRecords(source, { lowercaseKeys: true }), [
  { name: "Alice", score: 7 },
  { name: "Bob" },
]);
assert.deepEqual(normalizeRecords(source, { trim: false }), source);
assert.deepEqual(processRecords(source, { lowercaseKeys: true }), [
  { name: "Alice", score: 7 },
  { name: "Bob" },
]);
assert.equal(source[0].Name, "  Alice  ");
assert.throws(() => normalizeRecords({}), /array/i);
console.log("api migration verifier passed");
