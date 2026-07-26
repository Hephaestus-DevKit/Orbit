import { execFile } from "child_process";
import { promisify } from "util";
import { HIDDEN_CHILD_PROCESS_OPTIONS } from "@orbit-build/shared";

const execFileAsync = promisify(execFile);

export interface ProjectFolderPickerOptions {
  platform?: NodeJS.Platform;
  run?: (
    executable: string,
    args: string[],
  ) => Promise<{ stdout: string; stderr?: string }>;
}

/** Open the operating system's folder picker and return the selected path. */
export async function selectOrbitProjectFolder(
  options: ProjectFolderPickerOptions = {},
): Promise<string | null> {
  const platform = options.platform ?? process.platform;
  const run =
    options.run ??
    (async (executable: string, args: string[]) =>
      execFileAsync(executable, args, {
        ...HIDDEN_CHILD_PROCESS_OPTIONS,
        timeout: 120_000,
        maxBuffer: 64 * 1024,
      }));
  const command = projectPickerCommand(platform);
  try {
    const result = await run(command.executable, command.args);
    return result.stdout.trim() || null;
  } catch (error: unknown) {
    if (isPickerCancellation(error)) return null;
    throw new Error(
      platform === "linux"
        ? "The system folder picker is unavailable. Install zenity or enter the path manually."
        : "The system folder picker could not be opened. Enter the path manually.",
      { cause: error },
    );
  }
}

function projectPickerCommand(platform: NodeJS.Platform): {
  executable: string;
  args: string[];
} {
  if (platform === "win32") {
    return {
      executable: "powershell.exe",
      args: [
        "-NoProfile",
        "-NonInteractive",
        "-STA",
        "-Command",
        [
          "Add-Type -AssemblyName System.Windows.Forms",
          "$dialog = New-Object System.Windows.Forms.FolderBrowserDialog",
          "$dialog.Description = 'Select an Orbit project folder'",
          "$dialog.ShowNewFolderButton = $true",
          "if ($dialog.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) { [Console]::Out.Write($dialog.SelectedPath) }",
          "$dialog.Dispose()",
        ].join("; "),
      ],
    };
  }
  if (platform === "darwin") {
    return {
      executable: "osascript",
      args: [
        "-e",
        'POSIX path of (choose folder with prompt "Select an Orbit project folder")',
      ],
    };
  }
  return {
    executable: "zenity",
    args: [
      "--file-selection",
      "--directory",
      "--title=Select an Orbit project folder",
    ],
  };
}

function isPickerCancellation(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const candidate = error as { code?: unknown; stderr?: unknown };
  return (
    candidate.code === 1 ||
    (typeof candidate.stderr === "string" &&
      candidate.stderr.includes("User canceled"))
  );
}
