// Node runs each test file in its own process. Keep assertion and mock state there.
import { after, afterEach, before, beforeEach, describe, it as nodeTest, mock } from "node:test";
import { format, inspect } from "node:util";
import { setTimeout as delay } from "node:timers/promises";
import { performance as realPerformance } from "node:perf_hooks";
import { install } from "@sinonjs/fake-timers";
import {
  chai,
  ChaiStyleAssertions,
  GLOBAL_EXPECT,
  JestAsymmetricMatchers,
  JestChaiExpect,
  JestExtend,
  setState,
} from "@vitest/expect";
import { clearAllMocks, fn, resetAllMocks, restoreAllMocks, spyOn } from "@vitest/spy";

export { after as afterAll, afterEach, before as beforeAll, beforeEach, describe };
for (const plugin of [JestExtend, JestChaiExpect, ChaiStyleAssertions, JestAsymmetricMatchers])
  chai.use(plugin);
export const expect = chai.expect;
globalThis[GLOBAL_EXPECT] = expect;
setState({ assertionCalls: 0, isExpectingAssertions: false }, expect);

let defaultTimeout = process.platform === "win32" ? 60_000 : 20_000;
export function it(name, optionsOrBody, bodyOrTimeout) {
  if (typeof optionsOrBody === "object") return nodeTest(name, optionsOrBody, bodyOrTimeout);
  return nodeTest(name, { timeout: bodyOrTimeout ?? defaultTimeout }, optionsOrBody);
}
it.runIf = condition => condition ? it : nodeTest.skip;
it.skipIf = condition => condition ? nodeTest.skip : it;
it.each = rows => (name, body, timeout) => {
  const tuples = rows.every(Array.isArray);
  for (const [index, row] of rows.entries()) {
    const args = tuples ? row : [row];
    let next = 0;
    const title = name.replace(/%[%#sdifjoO]|\$(\w+(?:\.\w+)*)/g, (token, key) => {
      if (token === "%%") return "%";
      if (token === "%#") return String(index);
      if (key) {
        const value = key.split(".").reduce((obj, part) => obj?.[part], row);
        return value === undefined
          ? token
          : typeof value === "string"
          ? value
          : inspect(value, { breakLength: Infinity });
      }
      return format(token, args[next++]);
    });
    it(title, () => body(...args), timeout);
  }
};

export async function mockModule(url, factory) {
  const replacements = await factory(() => import(url));
  // Older Node 24 releases accept separate default and named exports.
  const major = Number(process.versions.node.split(".")[0]);
  if (major < 26) {
    const { default: defaultExport, ...namedExports } = replacements;
    return mock.module(
      url,
      Object.hasOwn(replacements, "default")
        ? { defaultExport, namedExports }
        : { namedExports },
    );
  }
  return mock.module(url, { exports: replacements });
}

let clock;
const globals = new Map();
const env = new Map();
export const mockTools = {
  fn,
  spyOn,
  clearAllMocks,
  resetAllMocks,
  restoreAllMocks,
  mocked: value => value,
  setConfig({ testTimeout }) {
    defaultTimeout = testTimeout;
  },
  useFakeTimers() {
    clock?.uninstall();
    clock = install({
      toFake: [
        "setTimeout",
        "clearTimeout",
        "setInterval",
        "clearInterval",
        "setImmediate",
        "clearImmediate",
        "Date",
        "performance",
        "hrtime",
      ],
    });
  },
  useRealTimers() {
    clock?.uninstall();
    clock = undefined;
  },
  advanceTimersByTime: ms => clock.tick(ms),
  advanceTimersByTimeAsync: ms => clock.tickAsync(ms),
  getTimerCount: () => clock.countTimers(),
  setSystemTime(time) {
    clock ??= install({ toFake: ["Date"] });
    clock.setSystemTime(time);
  },
  stubGlobal(key, value) {
    if (!globals.has(key)) globals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, {
      configurable: true,
      writable: true,
      enumerable: true,
      value,
    });
  },
  unstubAllGlobals() {
    for (const [key, descriptor] of globals) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete globalThis[key];
    }
    globals.clear();
  },
  stubEnv(key, value) {
    if (!env.has(key)) env.set(key, process.env[key]);
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  },
  unstubAllEnvs() {
    for (const [key, value] of env) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    env.clear();
  },
  async waitFor(check, { interval = 50, timeout = 1000 } = {}) {
    const start = realPerformance.now();
    for (;;) {
      try {
        return await check();
      } catch (error) {
        if (realPerformance.now() - start >= timeout) throw error;
        if (clock) await clock.tickAsync(interval);
        await delay(interval);
      }
    }
  },
};
