import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";

const source = readFileSync("native/orbit-browser/Targets.js", "utf8");
interface Surface {
  orbitObserve(): { controls: { id: string; label: string }[] };
  orbitClick(id: string): string | false;
}
test("browser control IDs follow a visible element and expire on change or reuse", async ({ page }) => {
  await page.route("https://orbit.example/**", route => route.fulfill({
    contentType: "text/html",
    body:
      '<button id="read" onclick="this.textContent=\'Done\'">Read</button><button hidden>Hidden</button><div style="opacity:0"><button>Invisible</button></div><input value="private"><button disabled>Disabled</button>',
  }));
  await page.goto("https://orbit.example/notes");
  await page.addScriptTag({ content: source });
  const observed = () => page.evaluate(() => (window as unknown as Surface).orbitObserve());
  const click = (id: string) =>
    page.evaluate(id => (window as unknown as Surface).orbitClick(id), id);
  const first = await observed();
  expect(first.controls.map(c => c.label)).toEqual(["Read"]);
  await page.locator("#read").evaluate(el => {
    el.textContent = "Updated";
  });
  expect(await click(first.controls[0]!.id)).toBe(false);
  const next = await observed();
  expect(await click(next.controls[0]!.id)).toBe("Updated");
  await expect(page.getByRole("button", { name: "Done" })).toBeVisible();
  expect(await click(next.controls[0]!.id)).toBe(false);
  const previous = await observed();
  await page.evaluate(() => history.pushState({}, "", "/other"));
  expect(await click(previous.controls[0]!.id)).toBe(false);
});

test("recognizes named icon controls without reading forms or hidden labels", async ({ page }) => {
  await page.route(
    "https://orbit.example/**",
    route => route.fulfill({
      contentType: "text/html",
      body: `
    <span id="save">Save</span><span id="draft">draft</span>
    <button id="save-button" aria-labelledby="save draft" aria-label="Fallback">+</button>
    <a href="#next"><img alt="Next page" width="24" height="24"></a>
    <span hidden id="hidden-name">Private label</span>
    <textarea id="note">Private note</textarea>
    <button aria-labelledby="hidden-name note" title="Help"></button>
  `,
    }),
  );
  await page.goto("https://orbit.example/notes");
  await page.addScriptTag({ content: source });
  const observed = await page.evaluate(() => (window as unknown as Surface).orbitObserve());
  expect(observed.controls.map(control => control.label)).toEqual([
    "Save draft",
    "Next page",
    "Help",
  ]);
  await page.locator("#draft").evaluate(node => {
    node.textContent = "changes";
  });
  expect(
    await page.evaluate(
      id => (window as unknown as Surface).orbitClick(id),
      observed.controls[0]!.id,
    ),
  ).toBe(false);
});
