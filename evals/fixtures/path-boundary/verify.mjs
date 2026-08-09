import assert from "node:assert/strict";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { resolveWorkspacePath } from "./safe-path.mjs";

const root = join(tmpdir(), "orbit-eval-workspace");
assert.equal(resolveWorkspacePath(root, "."), resolve(root));
assert.equal(
  resolveWorkspacePath(root, "src/main.js"),
  resolve(root, "src/main.js"),
);

for (const candidate of [
  "../orbit-eval-workspace-escape/file.js",
  "../outside/file.js",
  resolve(tmpdir(), "outside-absolute.txt"),
]) {
  assert.throws(
    () => resolveWorkspacePath(root, candidate),
    /escape|outside|workspace/i,
  );
}

console.log("path boundary verifier passed");
