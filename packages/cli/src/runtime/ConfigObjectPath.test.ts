import { describe, expect, it } from "../../../../scripts/testing/support.mjs";
import { getNestedProperty, setNestedProperty } from "./ConfigObjectPath.js";

describe("ConfigObjectPath", () => {
  it("reads nested values and safely handles missing paths", () => {
    const config = { tools: { bash: { enabled: true } } };
    expect(getNestedProperty(config, "tools.bash.enabled")).toBe(true);
    expect(getNestedProperty(config, "tools.web.enabled")).toBeUndefined();
  });

  it("creates missing containers when writing a value", () => {
    const config: Record<string, unknown> = {};
    setNestedProperty(config, "tools.web.enabled", false);
    expect(config).toEqual({ tools: { web: { enabled: false } } });
  });

  it("blocks prototype-polluting paths", () => {
    const config: Record<string, unknown> = {};
    expect(getNestedProperty(config, "__proto__.polluted")).toBeUndefined();
    expect(() => setNestedProperty(config, "__proto__.polluted", true)).toThrow(
      "Unsafe configuration path",
    );
    expect(
      (Object.prototype as Record<string, unknown>).polluted,
    ).toBeUndefined();
  });
});
