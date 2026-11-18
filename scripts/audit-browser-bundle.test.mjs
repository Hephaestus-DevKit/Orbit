import {
  mkdtempSync,
  mkdirSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it } from "./testing/support.mjs";
import { inspectBrowserBundle } from "./audit-browser-bundle.mjs";

let root;
let lib;
const inventory =
  "The following npm packages are inlined into this bundle.\n- example@1.0.0";

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "orbit-browser-audit-"));
  lib = join(root, "lib");
  mkdirSync(lib);
  for (const name of ["serverRegistry.js", "utilsBundle.js"]) {
    writeFileSync(join(lib, name), "/* bundle */");
    writeFileSync(join(lib, name + ".LICENSE"), inventory);
  }
});

afterEach(() => rmSync(root, { recursive: true, force: true }));

it("accepts reviewed inventories and ignores a similarly named package", () => {
  writeFileSync(
    join(lib, "other.cjs"),
    "// node_modules/picomatch-extra/index.js",
  );
  expect(inspectBrowserBundle(root)).toEqual({
    inventories: 2,
    scripts: 3,
    matches: [],
  });
});

it.each([
  "node_modules/picomatch/lib/parse.js",
  "node_modules\\picomatch\\lib\\parse.js",
])(
  "detects a nested bundled module independently of notices (%s)",
  (marker) => {
    mkdirSync(join(lib, "nested"));
    writeFileSync(join(lib, "nested", "driver.mjs"), "// " + marker);
    expect(inspectBrowserBundle(root).matches).toEqual([
      join("lib", "nested", "driver.mjs"),
    ]);
  },
);

it("detects an inventory listing independently of source markers", () => {
  writeFileSync(
    join(lib, "utilsBundle.js.LICENSE"),
    inventory + "\n- picomatch@2.3.2",
  );
  expect(inspectBrowserBundle(root).matches).toEqual([
    join("lib", "utilsBundle.js.LICENSE"),
  ]);
});

it.each(["serverRegistry.js", "utilsBundle.js.LICENSE"])(
  "requires review when %s disappears",
  (file) => {
    unlinkSync(join(lib, file));
    expect(() => inspectBrowserBundle(root)).toThrow(/layout changed/);
  },
);

it("requires a recognizable inventory with at least one package", () => {
  writeFileSync(join(lib, "utilsBundle.js.LICENSE"), inventory.split("\n")[0]);
  expect(() => inspectBrowserBundle(root)).toThrow(/layout changed/);
});
