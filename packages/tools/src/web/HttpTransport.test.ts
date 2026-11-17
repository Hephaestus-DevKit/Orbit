import { describe, expect, it, vi, afterEach } from "vitest";

const transport = vi.hoisted(() => ({
  current: { constructor: { name: "Agent" } } as object,
  install: vi.fn(),
}));
vi.mock("undici", () => ({
  Agent: class PatchedAgent {},
  getGlobalDispatcher: () => transport.current,
  setGlobalDispatcher: transport.install,
}));
afterEach(() => {
  vi.resetModules();
  transport.install.mockClear();
});

describe("process HTTP transport ownership", () => {
  it("replaces the stock runtime once and leaves later host overrides alone", async () => {
    transport.current = { constructor: { name: "Agent" } };
    const { initializeHttpTransport } = await import("./HttpTransport.js");
    initializeHttpTransport();
    transport.current = { constructor: { name: "ProxyAgent" } };
    initializeHttpTransport();
    expect(transport.install).toHaveBeenCalledTimes(1);
  });
  it("retains explicit host proxy dispatchers", async () => {
    transport.current = { constructor: { name: "ProxyAgent" } };
    const { initializeHttpTransport } = await import("./HttpTransport.js");
    initializeHttpTransport();
    expect(transport.install).not.toHaveBeenCalled();
  });
});
