import { describe, expect, it } from "../../../../../scripts/testing/support.mjs";
import { OrbitBrowserSession, PageObservation } from "./OrbitBrowserSession.js";

describe("native browser transport", () => {
  it("rejects an untrusted workspace before spawning and tolerates repeated close", async () => {
    const browser = new OrbitBrowserSession();
    await expect(browser.start("https://example.com", "en")).rejects.toThrow();
    expect(browser.open).toBe(false);
    await expect(browser.request({ action: "observe" })).rejects.toThrow();
    browser.close();
    browser.close();
  });
  it("accepts only bounded, labelled visible control references", () => {
    const control = { id: "ac5d2696-133d-45aa-bdd9-c7420901b800", role: "button", label: "Read" };
    const page = { site: "https://example.com", title: "Notes", controls: [control] };
    expect(PageObservation.safeParse(page).success).toBe(true);
    expect(PageObservation.safeParse({ ...page, controls: Array(49).fill(control) }).success).toBe(
      false,
    );
    expect(
      PageObservation.safeParse({ ...page, controls: [{ ...control, formValue: "private" }] })
        .success,
    ).toBe(false);
  });
});
