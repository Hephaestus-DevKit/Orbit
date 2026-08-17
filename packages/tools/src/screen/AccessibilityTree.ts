import { execa } from "execa";
import { z } from "zod";
import {
  HIDDEN_CHILD_PROCESS_OPTIONS,
  redactSecrets,
} from "@orbit-build/shared";
import type { OrbitTool, ToolContext, ToolResult } from "../types.js";

const MAX_TREE_BYTES = 512 * 1024;
const MAX_NODES = 2_000;
const ACCESSIBILITY_TIMEOUT_MS = 30_000;

export const AccessibilityTreeInputSchema = z.object({
  windowTitle: z.string().trim().min(1).max(256).optional(),
  maxNodes: z.number().int().min(1).max(MAX_NODES).optional(),
});
export type AccessibilityTreeInput = z.infer<
  typeof AccessibilityTreeInputSchema
>;

interface AccessibilityNodeInput {
  role: string;
  name: string;
  value?: string;
  enabled?: boolean;
  focused?: boolean;
  children?: AccessibilityNodeInput[];
}

export const AccessibilityNodeSchema: z.ZodType<
  AccessibilityNode,
  z.ZodTypeDef,
  AccessibilityNodeInput
> = z.lazy(() =>
  z
    .object({
      role: z.string().max(128),
      name: z.string().max(1_000),
      value: z.string().max(1_000).optional(),
      enabled: z.boolean().optional(),
      focused: z.boolean().optional(),
      children: z.array(AccessibilityNodeSchema).max(MAX_NODES).default([]),
    })
    .strict(),
);

export interface AccessibilityNode {
  role: string;
  name: string;
  value?: string;
  enabled?: boolean;
  focused?: boolean;
  children: AccessibilityNode[];
}

export interface AccessibilityTreeOutput {
  platform: NodeJS.Platform;
  backend: string;
  root: AccessibilityNode;
  nodeCount: number;
  truncated: boolean;
}

/**
 * Read-only accessibility snapshot for computer-use planning. It never
 * clicks, types, opens windows, or returns password-field values. Host OS
 * accessibility permission is required and missing backends fail clearly.
 */
export class AccessibilityTreeTool implements OrbitTool<
  AccessibilityTreeInput,
  AccessibilityTreeOutput
> {
  name = "inspect_accessibility";
  description =
    "Read a bounded, redacted accessibility tree for computer-use planning. This is read-only: it never clicks or types, skips password values, and requires the host accessibility permission/backend.";
  inputSchema = AccessibilityTreeInputSchema;
  risk = "execute" as const;

  async execute(
    input: AccessibilityTreeInput,
    ctx: ToolContext,
  ): Promise<ToolResult<AccessibilityTreeOutput>> {
    const result = await inspectAccessibilityTree({
      platform: process.platform,
      windowTitle: input.windowTitle,
      maxNodes: input.maxNodes ?? MAX_NODES,
      env: process.env,
      cwd: ctx.cwd,
      signal: ctx.abortSignal,
      timeoutMs: Math.min(
        ctx.config?.tools.bash.timeoutMs ?? ACCESSIBILITY_TIMEOUT_MS,
        ACCESSIBILITY_TIMEOUT_MS,
      ),
    });
    if (!result.ok || !result.data) return { ok: false, error: result.error };
    return {
      ok: true,
      data: result.data,
      display: `Read ${result.data.nodeCount} accessibility node(s) with ${result.data.backend}${result.data.truncated ? "; tree truncated" : ""}.`,
      metadata: {
        backend: result.data.backend,
        nodeCount: result.data.nodeCount,
        truncated: result.data.truncated,
      },
    };
  }
}

export interface AccessibilityTreeRequest {
  platform: NodeJS.Platform;
  windowTitle?: string;
  maxNodes: number;
  env: NodeJS.ProcessEnv;
  cwd: string;
  signal?: AbortSignal;
  timeoutMs: number;
}

export async function inspectAccessibilityTree(
  request: AccessibilityTreeRequest,
): Promise<ToolResult<AccessibilityTreeOutput>> {
  const command = resolveAccessibilityCommand(request);
  if (!command)
    return {
      ok: false,
      error:
        "Accessibility inspection dependency_missing: no supported native accessibility backend was detected or permission was not configured.",
    };
  try {
    const result = await execa(command.file, command.args, {
      ...HIDDEN_CHILD_PROCESS_OPTIONS,
      cwd: request.cwd,
      env: sanitizedAccessibilityEnvironment(request.env),
      extendEnv: false,
      timeout: request.timeoutMs,
      signal: request.signal,
      reject: false,
      maxBuffer: MAX_TREE_BYTES,
    });
    if (result.isCanceled || request.signal?.aborted)
      return { ok: false, error: "Accessibility inspection was canceled." };
    if (result.failed || result.exitCode !== 0)
      return {
        ok: false,
        error: `Accessibility backend ${command.backend} failed: ${redactSecrets(result.stderr || "unknown accessibility error").slice(0, 2_000)}`,
      };
    if (Buffer.byteLength(result.stdout, "utf8") > MAX_TREE_BYTES)
      return {
        ok: false,
        error: "Accessibility tree exceeded its bounded output limit.",
      };
    const parsed: unknown = JSON.parse(result.stdout);
    const root = AccessibilityNodeSchema.parse(parsed);
    const nodeCount = countNodes(root);
    return {
      ok: true,
      data: {
        platform: request.platform,
        backend: command.backend,
        root,
        nodeCount,
        truncated: nodeCount >= request.maxNodes,
      },
    };
  } catch (error: unknown) {
    return {
      ok: false,
      error: redactSecrets(
        error instanceof Error ? error.message : String(error),
      ),
    };
  }
}

interface AccessibilityCommand {
  backend: string;
  file: string;
  args: string[];
}

function resolveAccessibilityCommand(
  request: AccessibilityTreeRequest,
): AccessibilityCommand | undefined {
  if (request.platform === "win32") {
    const powershell = request.env.ORBIT_POWERSHELL_PATH ?? "powershell.exe";
    return {
      backend: "windows-uiautomation",
      file: powershell,
      args: [
        "-NoProfile",
        "-NonInteractive",
        "-Command",
        windowsScript(),
        request.windowTitle ?? "",
        String(request.maxNodes),
      ],
    };
  }
  if (request.platform === "darwin") {
    const osascript = request.env.ORBIT_OSASCRIPT_PATH ?? "/usr/bin/osascript";
    return {
      backend: "macos-accessibility",
      file: osascript,
      args: [
        "-l",
        "JavaScript",
        "-e",
        macosScript(),
        request.windowTitle ?? "",
        String(request.maxNodes),
      ],
    };
  }
  if (request.platform === "linux") {
    const python = request.env.ORBIT_PYTHON_PATH ?? "python3";
    return {
      backend: "linux-atspi",
      file: python,
      args: [
        "-c",
        linuxScript(),
        request.windowTitle ?? "",
        String(request.maxNodes),
      ],
    };
  }
  return undefined;
}

function windowsScript(): string {
  return [
    "param([string]$Title,[int]$Limit)",
    "Add-Type -AssemblyName UIAutomationClient",
    "Add-Type -AssemblyName UIAutomationTypes",
    "$root=[System.Windows.Automation.AutomationElement]::RootElement",
    "$walker=[System.Windows.Automation.TreeWalker]::RawViewWalker",
    "$count=0",
    "function Walk($e) { if ($script:count -ge $Limit) { return $null }; $script:count++; $name=[string]$e.Current.Name; $role=[string]$e.Current.ControlType.ProgrammaticName; $password=$false; try { $password=[bool]$e.Current.IsPassword } catch {}; $n=[ordered]@{role=$role;name=$name;enabled=[bool]$e.Current.IsEnabled;focused=[bool]$e.Current.HasKeyboardFocus;children=@()}; if (-not $password) { try { $valuePattern=$e.GetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern); $n.value=[string]$valuePattern.Current.Value } catch {} }; $child=$walker.GetFirstChild($e); while ($child) { $c=Walk $child; if ($c) { $n.children += $c }; $child=$walker.GetNextSibling($child) }; return $n }",
    "$target=$root; if ($Title) { $condition=New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::NameProperty,$Title); $target=$root.FindFirst([System.Windows.Automation.TreeScope]::Children,$condition) }; if (-not $target) { throw 'Window not found.' }; (Walk $target) | ConvertTo-Json -Depth 64 -Compress",
  ].join(";");
}

function macosScript(): string {
  return "ObjC.import('Foundation'); const app=Application('System Events'); const title=String($.NSProcessInfo.processInfo.arguments.objectAtIndex(4)); const limit=Number($.NSProcessInfo.processInfo.arguments.objectAtIndex(5)); let count=0; function walk(e){if(count++>=limit)return null; const n={role:String(e.role()),name:String(e.name()),children:[]}; try{if(e.value()!==undefined)n.value=String(e.value())}catch(_){}; for(const c of e.uiElements()) {const v=walk(c);if(v)n.children.push(v)} return n}; JSON.stringify(walk(title ? app.processes.whose({name:title})[0] : app.processes()[0]));";
}

function linuxScript(): string {
  return "import json,sys\ntry:\n import pyatspi\nexcept Exception as e:\n raise SystemExit('pyatspi is required: '+str(e))\nlimit=int(sys.argv[2]); count=0\ndef walk(o):\n global count\n if count>=limit:return None\n count+=1\n role=o.getRoleName() or ''\n name=o.name or ''\n n={'role':role,'name':name,'children':[]}\n try:\n  if getattr(o,'getState',lambda:None)(): n['enabled']=not o.getState().contains(pyatspi.STATE_SENSITIVE)\n except Exception: pass\n for i in range(o.childCount):\n  c=walk(o.getChildAtIndex(i))\n  if c:n['children'].append(c)\n return n\nprint(json.dumps(walk(pyatspi.Registry.getDesktop(0)),ensure_ascii=False))";
}

function countNodes(root: AccessibilityNode): number {
  return (
    1 + root.children.reduce((total, child) => total + countNodes(child), 0)
  );
}

function sanitizedAccessibilityEnvironment(
  source: NodeJS.ProcessEnv,
): NodeJS.ProcessEnv {
  return Object.fromEntries(
    Object.entries({
      PATH: source.PATH,
      PATHEXT: source.PATHEXT,
      TEMP: source.TEMP,
      TMP: source.TMP,
      TMPDIR: source.TMPDIR,
      DISPLAY: source.DISPLAY,
      WAYLAND_DISPLAY: source.WAYLAND_DISPLAY,
      DBUS_SESSION_BUS_ADDRESS: source.DBUS_SESSION_BUS_ADDRESS,
      XDG_RUNTIME_DIR: source.XDG_RUNTIME_DIR,
      LANG: source.LANG,
      LC_ALL: source.LC_ALL,
      ORBIT_CHILD_PROCESS: "1",
    }).filter((entry): entry is [string, string] => entry[1] !== undefined),
  );
}
