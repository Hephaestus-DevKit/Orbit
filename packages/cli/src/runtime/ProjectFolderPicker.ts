import { execFile } from "child_process";
import { promisify } from "util";
import { HIDDEN_CHILD_PROCESS_OPTIONS } from "@orbit-build/shared";

const execFileAsync = promisify(execFile);

const WINDOWS_FOLDER_PICKER_SOURCE = String.raw`
using System;
using System.Runtime.InteropServices;

public static class OrbitFolderPicker
{
    private const int CancelledHResult = unchecked((int)0x800704C7);

    [Flags]
    private enum FileOpenOptions : uint
    {
        PickFolders = 0x00000020,
        ForceFileSystem = 0x00000040,
        PathMustExist = 0x00000800,
        DontAddToRecent = 0x02000000
    }

    private enum ShellItemDisplayName : uint
    {
        FileSystemPath = 0x80058000
    }

    [ComImport]
    [Guid("DC1C5A9C-E88A-4DDE-A5A1-60F82A20AEF7")]
    private class FileOpenDialog
    {
    }

    [ComImport]
    [Guid("D57C7288-D4AD-4768-BE02-9D969532D960")]
    [InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    private interface IFileOpenDialog
    {
        [PreserveSig]
        int Show(IntPtr owner);
        void SetFileTypes(uint count, IntPtr filterSpecs);
        void SetFileTypeIndex(uint fileTypeIndex);
        void GetFileTypeIndex(out uint fileTypeIndex);
        void Advise(IntPtr events, out uint cookie);
        void Unadvise(uint cookie);
        void SetOptions(FileOpenOptions options);
        void GetOptions(out FileOpenOptions options);
        void SetDefaultFolder(IShellItem shellItem);
        void SetFolder(IShellItem shellItem);
        void GetFolder(out IShellItem shellItem);
        void GetCurrentSelection(out IShellItem shellItem);
        void SetFileName([MarshalAs(UnmanagedType.LPWStr)] string fileName);
        void GetFileName([MarshalAs(UnmanagedType.LPWStr)] out string fileName);
        void SetTitle([MarshalAs(UnmanagedType.LPWStr)] string title);
        void SetOkButtonLabel([MarshalAs(UnmanagedType.LPWStr)] string text);
        void SetFileNameLabel([MarshalAs(UnmanagedType.LPWStr)] string label);
        void GetResult(out IShellItem shellItem);
        void AddPlace(IShellItem shellItem, uint alignment);
        void SetDefaultExtension([MarshalAs(UnmanagedType.LPWStr)] string extension);
        void Close(int result);
        void SetClientGuid(ref Guid clientGuid);
        void ClearClientData();
        void SetFilter(IntPtr filter);
        void GetResults(out IntPtr shellItems);
        void GetSelectedItems(out IntPtr shellItems);
    }

    [ComImport]
    [Guid("43826D1E-E718-42EE-BC55-A1E261C37BFE")]
    [InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    private interface IShellItem
    {
        void BindToHandler(IntPtr bindingContext, ref Guid handlerId, ref Guid interfaceId, out IntPtr result);
        void GetParent(out IShellItem shellItem);
        void GetDisplayName(ShellItemDisplayName displayName, out IntPtr name);
        void GetAttributes(uint mask, out uint attributes);
        void Compare(IShellItem shellItem, uint hint, out int order);
    }

    [DllImport("user32.dll")]
    private static extern IntPtr GetForegroundWindow();

    [DllImport("user32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool SetProcessDpiAwarenessContext(IntPtr dpiContext);

    [DllImport("user32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool SetProcessDPIAware();

    public static string Show()
    {
        EnablePerMonitorDpiAwareness();
        IntPtr owner = GetForegroundWindow();
        IFileOpenDialog dialog = (IFileOpenDialog)new FileOpenDialog();
        IShellItem result = null;
        IntPtr pathPointer = IntPtr.Zero;

        try
        {
            FileOpenOptions options;
            dialog.GetOptions(out options);
            dialog.SetOptions(
                options |
                FileOpenOptions.PickFolders |
                FileOpenOptions.ForceFileSystem |
                FileOpenOptions.PathMustExist |
                FileOpenOptions.DontAddToRecent);
            dialog.SetTitle("Open an Orbit project folder");
            dialog.SetOkButtonLabel("Open folder");

            int showResult = dialog.Show(owner);
            if (showResult == CancelledHResult)
            {
                return null;
            }
            Marshal.ThrowExceptionForHR(showResult);

            dialog.GetResult(out result);
            result.GetDisplayName(ShellItemDisplayName.FileSystemPath, out pathPointer);
            return Marshal.PtrToStringUni(pathPointer);
        }
        finally
        {
            if (pathPointer != IntPtr.Zero)
            {
                Marshal.FreeCoTaskMem(pathPointer);
            }
            if (result != null)
            {
                Marshal.FinalReleaseComObject(result);
            }
            Marshal.FinalReleaseComObject(dialog);
        }
    }

    private static void EnablePerMonitorDpiAwareness()
    {
        try
        {
            SetProcessDpiAwarenessContext(new IntPtr(-4));
        }
        catch (EntryPointNotFoundException)
        {
            SetProcessDPIAware();
        }
    }
}
`.trim();

const WINDOWS_FOLDER_PICKER_SCRIPT = [
  "$ErrorActionPreference = 'Stop'",
  `Add-Type -TypeDefinition @'\n${WINDOWS_FOLDER_PICKER_SOURCE}\n'@`,
  "$selectedPath = [OrbitFolderPicker]::Show()",
  "if (-not [string]::IsNullOrWhiteSpace($selectedPath)) { [Console]::Out.Write($selectedPath) }",
].join("\n");

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
    if (isPickerCancellation(error, platform)) return null;
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
        WINDOWS_FOLDER_PICKER_SCRIPT,
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

function isPickerCancellation(
  error: unknown,
  platform: NodeJS.Platform,
): boolean {
  if (!error || typeof error !== "object") return false;
  const candidate = error as { code?: unknown; stderr?: unknown };
  const stderr =
    typeof candidate.stderr === "string" ? candidate.stderr.trim() : "";
  return (
    stderr.includes("User canceled") ||
    (platform === "linux" && candidate.code === 1 && stderr.length === 0)
  );
}
