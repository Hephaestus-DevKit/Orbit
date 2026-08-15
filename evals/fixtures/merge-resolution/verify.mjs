import assert from "node:assert/strict";
import { invoiceTotal } from "./calculator.mjs";

assert.equal(invoiceTotal([0.105, 0.105], 0.1), 0.23);
assert.equal(invoiceTotal([10.004, 0.006], 0.2), 12.01);
assert.throws(() => invoiceTotal([-1], 0.1), /negative|non-negative/i);
assert.throws(() => invoiceTotal([Number.NaN], 0.1), /finite/i);
assert.throws(() => invoiceTotal([1], -0.1), /negative|non-negative/i);
console.log("merge resolution verifier passed");
