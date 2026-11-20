import assert from "node:assert/strict";
import { Readable } from "node:stream";
import { test } from "node:test";
import { parseExecMaxTurns, readExecPrompt } from "./execInput.js";

test("preserves multiline UTF-8 across chunk boundaries and leaves unrelated stdin unread", async () => {
  const text = "检查\n  two\n";
  const data = Buffer.from(text);
  for (const arg of [undefined, "-"]) {
    assert.equal(
      await readExecPrompt(arg, Readable.from([data.subarray(0, 2), data.subarray(2)])),
      text,
    );
  }
  const pipe = Readable.from(["other input"]);
  assert.equal(await readExecPrompt("inline", pipe), "inline");
  assert.equal(pipe.readableDidRead, false);
});

test("rejects invalid or oversized tasks before initializing a session", async () => {
  for (const value of ["  ", Buffer.from([255]), "one\0two", Buffer.alloc(1024 * 1024 + 1, 97)]) {
    await assert.rejects(readExecPrompt("-", Readable.from([value])));
  }
  await assert.rejects(
    readExecPrompt(undefined, Object.assign(Readable.from([]), { isTTY: true })),
  );
});

test("validates the single-run turn cap", () => {
  for (const value of [1, 15, 1000]) assert.equal(parseExecMaxTurns(String(value)), value);
  for (const value of ["0", "-1", "1001", "NaN", "1.5", ""])
    assert.throws(() => parseExecMaxTurns(value));
});
