import { describe, it, expect } from "../../../scripts/testing/support.mjs";
import { generateId } from "./ids.js";

describe("ids generator", () => {
  it("should generate human readable session IDs", () => {
    const sessId = generateId("sess");
    expect(sessId).toMatch(/^sess_[a-z]+-[a-z]+-\d{3}$/);
  });

  it("should generate standard UUID-like IDs for other prefixes", () => {
    const userId = generateId("user");
    expect(userId).toMatch(/^user_[a-f0-9]{32}$/);
  });

  it("should generate standard UUID when no prefix is provided", () => {
    const id = generateId();
    expect(id).toMatch(
      /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/,
    );
  });
});
