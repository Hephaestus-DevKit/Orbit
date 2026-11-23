import { test } from "@playwright/test";
import {
  type SafariWebDriver,
  startSafariWebDriver,
} from "../packages/cli/src/runtime/browser/SafariWebDriver.js";

export async function withSafari(run: (session: SafariWebDriver) => Promise<void>): Promise<void> {
  const session = await startSafariWebDriver();
  try {
    await run(session);
  } finally {
    await session.close();
  }
}

async function findSafariElement(session: SafariWebDriver, selector: string): Promise<string> {
  const result = await session.command("POST", "/element", {
    using: "css selector",
    value: selector,
  }) as Record<string, unknown> | null;
  const id = result?.["element-6066-11e4-a52e-4f735466cecf"];
  if (typeof id !== "string") throw new Error("SafariDriver did not find " + selector);
  return "/element/" + encodeURIComponent(id);
}

export async function clickSafari(session: SafariWebDriver, selector: string): Promise<void> {
  await test.step("Click " + selector, async () => {
    // Re-select the automation window after a resize or capture before sending a native click.
    const windowHandle = await session.command("GET", "/window");
    await session.command("POST", "/window", { handle: windowHandle });
    await session.command("POST", "/execute/async", {
      script:
        "const done = arguments[0]; requestAnimationFrame(() => requestAnimationFrame(() => done(true)));",
      args: [],
    });
    await session.command("POST", (await findSafariElement(session, selector)) + "/click", {});
  }, { box: true });
}

export async function typeSafari(
  session: SafariWebDriver,
  selector: string,
  text: string,
): Promise<void> {
  await session.command("POST", (await findSafariElement(session, selector)) + "/value", { text });
}

export function readSafari(session: SafariWebDriver, script: string): Promise<unknown> {
  return session.command("POST", "/execute/sync", { script, args: [] });
}
