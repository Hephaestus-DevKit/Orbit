import readline from "readline";
import picocolors from "picocolors";
import { z } from "zod";
import { redactSecrets } from "@orbit-build/shared";
import {
  UpdateChannelSchema,
  UpdateManager,
  type UpdateChannel,
  type UpdateCheck,
} from "../runtime/UpdateManager.js";

const UpdateCommandOptionsSchema = z
  .object({
    check: z.boolean().prefault(false),
    yes: z.boolean().prefault(false),
    json: z.boolean().prefault(false),
    channel: UpdateChannelSchema.prefault("stable"),
  })
  .strict();

export interface UpdateCommandOptions {
  check?: boolean;
  yes?: boolean;
  json?: boolean;
  channel?: UpdateChannel;
}

export interface UpdateCommandDependencies {
  manager?: Pick<UpdateManager, "check" | "install" | "readInstalledVersion">;
  interactive?: boolean;
  confirm?: (prompt: string) => Promise<boolean>;
  write?: (text: string) => void;
  beforeInstall?: () => void;
  afterInstall?: () => void;
}

export interface UpdateCommandResult {
  check: UpdateCheck;
  installed: boolean;
  /** The package on disk is newer than this still-running process. */
  restartRequired: boolean;
  channel: UpdateChannel;
  rollback?: "not-needed" | "succeeded" | "failed";
}

/** Check the published npm version and explicitly install an available update. */
export async function runUpdate(
  currentVersion: string,
  rawOptions: UpdateCommandOptions,
  dependencies: UpdateCommandDependencies = {},
): Promise<UpdateCommandResult> {
  const options = UpdateCommandOptionsSchema.parse(rawOptions);
  const manager = dependencies.manager ?? new UpdateManager();
  const write = dependencies.write ?? ((text: string) => console.log(text));
  const check = manager.check(currentVersion, options.channel);

  if (!check.updateAvailable) {
    const result = {
      check,
      installed: false,
      restartRequired: false,
      channel: options.channel,
    };
    write(
      options.json
        ? JSON.stringify({ schemaVersion: 1, ...result })
        : picocolors.green(
          `✔ Orbit ${check.currentVersion} is already up to date.`,
        ),
    );
    return result;
  }

  // A previous /update may already have replaced the global package while this
  // process is still executing its old in-memory code. Do not reinstall it or
  // claim that the live TUI/Web UI has hot-updated.
  let latestAlreadyInstalled = false;
  try {
    latestAlreadyInstalled = manager.readInstalledVersion() === check.latestVersion;
  } catch {
    // npx and project-local invocations might not have a global package yet.
    // In that case the normal install flow remains the safe recovery path.
  }
  if (latestAlreadyInstalled) {
    const result = {
      check,
      installed: false,
      restartRequired: true,
      channel: options.channel,
    };
    write(
      options.json
        ? JSON.stringify({ schemaVersion: 1, ...result })
        : picocolors.yellow(
          `● Orbit ${check.latestVersion} is installed, but this process is still ${check.currentVersion}. Exit and relaunch Orbit, then reopen /webui.`,
        ),
    );
    return result;
  }

  if (options.check || (options.json && !options.yes)) {
    const result = {
      check,
      installed: false,
      restartRequired: false,
      channel: options.channel,
    };
    write(
      options.json
        ? JSON.stringify({ schemaVersion: 1, ...result })
        : `${
          picocolors.yellow("● Update available:")
        } ${check.currentVersion} → ${check.latestVersion}\n  Run ${
          picocolors.cyan("orbit update --yes")
        } in a terminal, then restart Orbit and reopen ${picocolors.cyan("/webui")}.`,
    );
    return result;
  }

  let confirmed = options.yes;
  if (!confirmed) {
    const interactive = dependencies.interactive ?? Boolean(process.stdin.isTTY);
    if (!interactive) {
      throw new Error(
        "Updating requires an interactive confirmation or the explicit --yes flag.",
      );
    }
    const confirm = dependencies.confirm ?? confirmUpdate;
    confirmed = await confirm(
      `Update Orbit ${check.currentVersion} → ${check.latestVersion}? [y/N] `,
    );
  }

  if (!confirmed) {
    write(picocolors.yellow("⚠ Update cancelled."));
    return {
      check,
      installed: false,
      restartRequired: false,
      channel: options.channel,
    };
  }

  dependencies.beforeInstall?.();
  try {
    manager.install(check.latestVersion, !options.json);
    const installedVersion = manager.readInstalledVersion();
    if (installedVersion !== check.latestVersion) {
      throw new Error(
        `npm reported Orbit ${installedVersion} after installing ${check.latestVersion}.`,
      );
    }
  } catch (error: unknown) {
    let rollback: "succeeded" | "failed";
    try {
      manager.install(check.currentVersion, !options.json);
      rollback = manager.readInstalledVersion() === check.currentVersion
        ? "succeeded"
        : "failed";
    } catch {
      rollback = "failed";
    }
    const detail = redactSecrets(
      error instanceof Error ? error.message : String(error),
    )
      .replace(/[\u0000-\u001f\u007f-\u009f]/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 2_000);
    const recovery = rollback === "succeeded"
      ? `Orbit ${check.currentVersion} was restored.`
      : `Automatic rollback failed. Run npm install --global @orbit-build/cli@${check.currentVersion}.`;
    throw new Error(`Orbit update did not complete: ${detail} ${recovery}`, {
      cause: error,
    });
  } finally {
    dependencies.afterInstall?.();
  }
  const result = {
    check,
    installed: true,
    restartRequired: true,
    channel: options.channel,
    rollback: "not-needed" as const,
  };
  write(
    options.json
      ? JSON.stringify({ schemaVersion: 1, ...result })
      : picocolors.green(
        `✔ Orbit ${check.latestVersion} was installed and verified. This process is still ${check.currentVersion}; exit and relaunch Orbit, then reopen /webui.`,
      ),
  );
  return result;
}

async function confirmUpdate(prompt: string): Promise<boolean> {
  const interfaceInstance = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  try {
    const answer = await new Promise<string>((resolve) =>
      interfaceInstance.question(prompt, resolve)
    );
    return /^(?:y|yes)$/i.test(answer.trim());
  } finally {
    interfaceInstance.close();
  }
}
