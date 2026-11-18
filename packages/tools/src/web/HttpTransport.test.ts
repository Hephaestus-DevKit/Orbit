import { mockModule,  describe, expect, it, mockTools as vi, afterEach } from "../../../../scripts/testing/support.mjs";

const transport = ({
  current: { constructor: { name: "Agent" } } as object,
  install: vi.fn(),
});
await mockModule(import.meta.resolve("undici"), () => ({
  Agent: class PatchedAgent {},
  getGlobalDispatcher: () => transport.current,
  setGlobalDispatcher: transport.install,
}));


afterEach(() => {
  transport.install.mockClear();
});

// Each case owns a fresh copy of the module's process-wide initialization flag.
function freshTransport(testCase: string): Promise<typeof import("./HttpTransport.js")> {
  const url = new URL(import.meta.resolve("./HttpTransport.js"));
  url.searchParams.set("case", testCase);
  return import(url.href);
}

describe("process HTTP transport ownership", () => {
  it("replaces the stock runtime once and leaves later host overrides alone", async () => {
    transport.current = { constructor: { name: "Agent" } };
    const { initializeHttpTransport } = await freshTransport("stock");
    initializeHttpTransport();
    transport.current = { constructor: { name: "ProxyAgent" } };
    initializeHttpTransport();
    expect(transport.install).toHaveBeenCalledTimes(1);
  });
  it("retains explicit host proxy dispatchers", async () => {
    transport.current = { constructor: { name: "ProxyAgent" } };
    const { initializeHttpTransport } = await freshTransport("proxy");
    initializeHttpTransport();
    expect(transport.install).not.toHaveBeenCalled();
  });
});
