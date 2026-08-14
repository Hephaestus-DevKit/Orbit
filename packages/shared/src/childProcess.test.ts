import { describe, expect, it } from "vitest";
import {
  buildInheritedChildEnvironment,
  buildSanitizedChildEnvironment,
  HIDDEN_CHILD_PROCESS_OPTIONS,
} from "./childProcess.js";

describe("hidden child process options", () => {
  it("keeps spawned console windows hidden", () => {
    expect(HIDDEN_CHILD_PROCESS_OPTIONS).toEqual({ windowsHide: true });
    expect(Object.isFrozen(HIDDEN_CHILD_PROCESS_OPTIONS)).toBe(true);
  });
});

describe("sanitized child process environment", () => {
  it("keeps runtime essentials while excluding credentials", () => {
    const environment = buildSanitizedChildEnvironment({
      source: {
        PATH: "C:\\tools",
        TEMP: "C:\\temp",
        LANG: "zh_CN.UTF-8",
        LC_ALL: "C.UTF-8",
        JAVA_HOME: "C:\\Java",
        SAFE_BUILD_FLAG: "enabled",
        HTTPS_PROXY: "https://proxy.example.com:443",
        HTTP_PROXY: "https://user:password@proxy.example.com:443",
        DEEPSEEK_API_KEY: "private-key",
        AWS_SECRET_ACCESS_KEY: "private-aws-key",
        ORBIT_PROVIDER_API_KEY: "private-provider-key",
      },
      extra: { ORBIT_FILE: "src/index.ts" },
    });

    expect(environment).toMatchObject({
      PATH: "C:\\tools",
      TEMP: "C:\\temp",
      LANG: "zh_CN.UTF-8",
      LC_ALL: "C.UTF-8",
      JAVA_HOME: "C:\\Java",
      SAFE_BUILD_FLAG: "enabled",
      HTTPS_PROXY: "https://proxy.example.com:443",
      ORBIT_FILE: "src/index.ts",
      ORBIT_CHILD_PROCESS: "1",
    });
    expect(environment).not.toHaveProperty("DEEPSEEK_API_KEY");
    expect(environment).not.toHaveProperty("AWS_SECRET_ACCESS_KEY");
    expect(environment).not.toHaveProperty("ORBIT_PROVIDER_API_KEY");
    expect(environment).not.toHaveProperty("HTTP_PROXY");
  });

  it("supports a minimal environment for fixed internal helpers", () => {
    const environment = buildSanitizedChildEnvironment({
      source: { PATH: "C:\\tools", JAVA_HOME: "C:\\Java" },
      mode: "minimal",
    });
    expect(environment.PATH).toBe("C:\\tools");
    expect(environment).not.toHaveProperty("JAVA_HOME");
  });

  it("can preserve credentials for an explicitly unrestricted process", () => {
    const source = {
      PATH: "C:\\tools",
      DEEPSEEK_API_KEY: "private-key",
      ORBIT_PROVIDER_API_KEY: "provider-key",
    };
    const environment = buildInheritedChildEnvironment({ source });

    expect(environment).toMatchObject({
      PATH: "C:\\tools",
      DEEPSEEK_API_KEY: "private-key",
      ORBIT_PROVIDER_API_KEY: "provider-key",
      ORBIT_CHILD_PROCESS: "1",
    });
    expect(environment).not.toBe(source);
  });
});
