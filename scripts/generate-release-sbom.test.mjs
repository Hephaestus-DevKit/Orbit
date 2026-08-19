import { describe, expect, it } from "vitest";

import {
  buildCycloneDxBom,
  validateCycloneDxBom,
} from "./generate-release-sbom.mjs";

describe("release SBOM", () => {
  const manifest = {
    name: "@orbit-build/cli",
    version: "1.7.0",
    license: "Apache-2.0",
  };
  const tree = {
    name: "@orbit-build/cli",
    version: "1.7.0",
    dependencies: {
      commander: {
        version: "15.0.0",
        dependencies: {
          helper: { version: "2.0.0" },
        },
      },
      picocolors: { version: "1.1.1" },
    },
    unsavedDependencies: {
      vitest: { version: "link:vitest" },
    },
  };

  it("emits a deterministic production-only component graph", () => {
    const bom = buildCycloneDxBom(manifest, tree);

    expect(bom.metadata.component).toMatchObject({
      group: "@orbit-build",
      name: "cli",
      version: "1.7.0",
    });
    expect(bom.components.map((component) => component.name)).toEqual([
      "commander",
      "helper",
      "picocolors",
    ]);
    expect(JSON.stringify(bom)).not.toContain("vitest");
    expect(bom.dependencies[0].dependsOn).toHaveLength(2);
  });

  it("rejects missing dependency evidence and mismatched package identity", () => {
    expect(() =>
      buildCycloneDxBom(manifest, { ...tree, version: "1.6.8" }),
    ).toThrow("does not match");
    const bom = buildCycloneDxBom(manifest, tree);
    expect(() =>
      validateCycloneDxBom({ ...bom, components: [] }, manifest, ["commander"]),
    ).toThrow("does not contain every direct dependency");
  });
});
