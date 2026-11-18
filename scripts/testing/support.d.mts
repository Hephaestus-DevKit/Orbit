import type { TestOptions } from "node:test";
import type { ExpectStatic } from "@vitest/expect";
import type { MaybeMocked } from "@vitest/spy";
import * as spies from "@vitest/spy";
export type { Mock } from "@vitest/spy";
export { after as afterAll, afterEach, before as beforeAll, beforeEach, describe } from "node:test";
export const expect: ExpectStatic;
type Body = () => void | Promise<void>;
interface Test {
  (name: string, body: Body, timeout?: number): void;
  (name: string, options: TestOptions, body: Body): void;
  each<T extends unknown[] | [unknown]>(cases: readonly T[]): (name: string, body: (...args: T) => void | Promise<void>, timeout?: number) => void;
  each<T>(cases: readonly T[]): (name: string, body: (row: T) => void | Promise<void>, timeout?: number) => void;
  skipIf(condition: unknown): Test;
  runIf(condition: unknown): Test;
}
export const it: Test;
export function mockModule(url: string, factory: (loadOriginal: <T = Record<string, unknown>>() => Promise<T>) => object | Promise<object>): Promise<unknown>;
export const mockTools: Pick<typeof spies, "fn" | "spyOn" | "resetAllMocks" | "restoreAllMocks" | "clearAllMocks"> & {
  mocked<T>(value: T): MaybeMocked<T>;
  setConfig(options: {testTimeout: number}): void;
  useFakeTimers(): void;
  useRealTimers(): void;
  advanceTimersByTime(ms: number): void;
  advanceTimersByTimeAsync(ms: number): Promise<void>;
  getTimerCount(): number;
  setSystemTime(time: Date | number): void;
  stubGlobal(key: string, value: unknown): void;
  unstubAllGlobals(): void;
  stubEnv(key: string, value: string | undefined): void;
  unstubAllEnvs(): void;
  waitFor<T>(check: () => T, options?: {timeout?: number;interval?: number}): Promise<Awaited<T>>;
};
