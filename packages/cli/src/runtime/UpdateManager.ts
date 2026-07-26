import { execFile, execFileSync } from "child_process";
import { z } from "zod";
import { HIDDEN_CHILD_PROCESS_OPTIONS } from "@orbit-build/shared";

const SemanticVersionSchema = z
  .string()
  .trim()
  .regex(/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/);
export const UpdateChannelSchema = z.enum(["stable", "beta"]);
export type UpdateChannel = z.infer<typeof UpdateChannelSchema>;

export const UpdateCheckSchema = z.object({
  currentVersion: SemanticVersionSchema,
  latestVersion: SemanticVersionSchema,
  updateAvailable: z.boolean(),
});
export type UpdateCheck = z.infer<typeof UpdateCheckSchema>;

export interface NpmCommandOptions {
  timeoutMs: number;
  inheritOutput: boolean;
}

export type NpmCommandRunner = (
  executable: string,
  args: string[],
  options: NpmCommandOptions,
) => string;

export type AsyncNpmCommandRunner = (
  executable: string,
  args: string[],
  timeoutMs: number,
) => Promise<string>;

export interface UpdateManagerOptions {
  platform?: NodeJS.Platform;
  run?: NpmCommandRunner;
  runAsync?: AsyncNpmCommandRunner;
  timeoutMs?: number;
  windowsCommandShell?: string;
}

/** Check and install published CLI versions through the user's npm runtime. */
export class UpdateManager {
  private readonly executable: string;
  private readonly argumentPrefix: string[];
  private readonly run: NpmCommandRunner;
  private readonly runAsync: AsyncNpmCommandRunner;
  private readonly timeoutMs: number;

  constructor(options: UpdateManagerOptions = {}) {
    const platform = options.platform ?? process.platform;
    this.executable =
      platform === "win32"
        ? (options.windowsCommandShell ?? process.env.ComSpec ?? "cmd.exe")
        : "npm";
    this.argumentPrefix =
      platform === "win32" ? ["/d", "/s", "/c", "npm.cmd"] : [];
    this.run = options.run ?? runNpmCommand;
    this.runAsync = options.runAsync ?? runNpmCommandAsync;
    this.timeoutMs = options.timeoutMs ?? 15_000;
  }

  public check(
    currentVersion: string,
    channel: UpdateChannel = "stable",
  ): UpdateCheck {
    const validatedCurrentVersion = SemanticVersionSchema.parse(currentVersion);
    const raw = this.run(
      this.executable,
      this.latestVersionArguments(channel),
      {
        timeoutMs: this.timeoutMs,
        inheritOutput: false,
      },
    );
    return this.createUpdateCheck(validatedCurrentVersion, raw);
  }

  public async checkAsync(
    currentVersion: string,
    channel: UpdateChannel = "stable",
  ): Promise<UpdateCheck> {
    const validatedCurrentVersion = SemanticVersionSchema.parse(currentVersion);
    const raw = await this.runAsync(
      this.executable,
      this.latestVersionArguments(channel),
      this.timeoutMs,
    );
    return this.createUpdateCheck(validatedCurrentVersion, raw);
  }

  private latestVersionArguments(channel: UpdateChannel): string[] {
    const tag =
      UpdateChannelSchema.parse(channel) === "stable" ? "latest" : "next";
    return [
      ...this.argumentPrefix,
      "view",
      "@orbit-build/cli",
      `dist-tags.${tag}`,
      "--json",
    ];
  }

  private createUpdateCheck(
    validatedCurrentVersion: string,
    raw: string,
  ): UpdateCheck {
    const latestVersion = SemanticVersionSchema.parse(parseNpmJsonString(raw));
    return {
      currentVersion: validatedCurrentVersion,
      latestVersion,
      updateAvailable:
        compareSemanticVersions(latestVersion, validatedCurrentVersion) > 0,
    };
  }

  public install(version: string, inheritOutput = true): void {
    const validatedVersion = SemanticVersionSchema.parse(version);
    this.run(
      this.executable,
      [
        ...this.argumentPrefix,
        "install",
        "--global",
        `@orbit-build/cli@${validatedVersion}`,
        "--no-audit",
        "--no-fund",
      ],
      { timeoutMs: Math.max(this.timeoutMs, 120_000), inheritOutput },
    );
  }

  /** Read the version npm currently exposes from the global Orbit install. */
  public readInstalledVersion(): string {
    const raw = this.run(
      this.executable,
      [
        ...this.argumentPrefix,
        "list",
        "--global",
        "@orbit-build/cli",
        "--depth=0",
        "--json",
      ],
      { timeoutMs: this.timeoutMs, inheritOutput: false },
    );
    const parsed = z
      .object({
        dependencies: z.object({
          "@orbit-build/cli": z.object({ version: SemanticVersionSchema }),
        }),
      })
      .parse(JSON.parse(raw) as unknown);
    return parsed.dependencies["@orbit-build/cli"].version;
  }
}

function parseNpmJsonString(raw: string): unknown {
  try {
    return JSON.parse(raw) as unknown;
  } catch (error) {
    throw new Error("npm returned an invalid latest-version response.", {
      cause: error,
    });
  }
}

function compareSemanticVersions(left: string, right: string): number {
  const parse = (version: string): { core: number[]; prerelease: string[] } => {
    const withoutBuild = version.split("+", 1)[0] ?? version;
    const prereleaseSeparator = withoutBuild.indexOf("-");
    const corePart =
      prereleaseSeparator === -1
        ? withoutBuild
        : withoutBuild.slice(0, prereleaseSeparator);
    const prereleasePart =
      prereleaseSeparator === -1
        ? undefined
        : withoutBuild.slice(prereleaseSeparator + 1);
    return {
      core: corePart.split(".").map(Number),
      prerelease: prereleasePart ? prereleasePart.split(".") : [],
    };
  };
  const leftVersion = parse(left);
  const rightVersion = parse(right);
  for (let index = 0; index < 3; index++) {
    const difference =
      (leftVersion.core[index] ?? 0) - (rightVersion.core[index] ?? 0);
    if (difference !== 0) return Math.sign(difference);
  }
  if (leftVersion.prerelease.length === 0) {
    return rightVersion.prerelease.length === 0 ? 0 : 1;
  }
  if (rightVersion.prerelease.length === 0) return -1;
  const length = Math.max(
    leftVersion.prerelease.length,
    rightVersion.prerelease.length,
  );
  for (let index = 0; index < length; index++) {
    const leftPart = leftVersion.prerelease[index];
    const rightPart = rightVersion.prerelease[index];
    if (leftPart === undefined) return -1;
    if (rightPart === undefined) return 1;
    if (leftPart === rightPart) continue;
    const leftNumber = /^\d+$/.test(leftPart) ? Number(leftPart) : null;
    const rightNumber = /^\d+$/.test(rightPart) ? Number(rightPart) : null;
    if (leftNumber !== null && rightNumber !== null) {
      return Math.sign(leftNumber - rightNumber);
    }
    if (leftNumber !== null) return -1;
    if (rightNumber !== null) return 1;
    return leftPart.localeCompare(rightPart);
  }
  return 0;
}

function runNpmCommand(
  executable: string,
  args: string[],
  options: NpmCommandOptions,
): string {
  return execFileSync(executable, args, {
    ...HIDDEN_CHILD_PROCESS_OPTIONS,
    encoding: "utf8",
    timeout: options.timeoutMs,
    stdio: options.inheritOutput
      ? ["ignore", "inherit", "inherit"]
      : ["ignore", "pipe", "pipe"],
  });
}

function runNpmCommandAsync(
  executable: string,
  args: string[],
  timeoutMs: number,
): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      executable,
      args,
      {
        ...HIDDEN_CHILD_PROCESS_OPTIONS,
        encoding: "utf8",
        timeout: timeoutMs,
        windowsHide: true,
      },
      (error, stdout) => {
        if (error) {
          reject(error);
          return;
        }
        resolve(stdout);
      },
    );
  });
}
