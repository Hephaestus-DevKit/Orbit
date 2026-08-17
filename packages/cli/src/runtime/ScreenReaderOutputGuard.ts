import { stripAnsiCodes } from "../tui/TerminalText.js";

type StreamWrite = typeof process.stdout.write;

/** Removes terminal control sequences while preserving readable line breaks. */
export function stripScreenReaderControls(value: string): string {
  return stripAnsiCodes(
    value
      .replace(/\u001b\][^\u0007]*(?:\u0007|\u001b\\)/g, "")
      .replace(/\u001b(?:P|X|\^|_)[\s\S]*?\u001b\\/g, ""),
  )
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "");
}

/**
 * Explicitly guards process output for screen-reader mode. Constructors stay
 * side-effect free; start/stop own and restore both stream interceptors.
 */
export class ScreenReaderOutputGuard {
  private stdoutOriginal: StreamWrite | null = null;
  private stderrOriginal: StreamWrite | null = null;
  private stdoutGuard: StreamWrite | null = null;
  private stderrGuard: StreamWrite | null = null;

  public start(): void {
    if (this.stdoutOriginal || this.stderrOriginal) return;
    this.stdoutOriginal = process.stdout.write;
    this.stderrOriginal = process.stderr.write;
    this.stdoutGuard = this.createGuard(process.stdout, this.stdoutOriginal);
    this.stderrGuard = this.createGuard(process.stderr, this.stderrOriginal);
    process.stdout.write = this.stdoutGuard;
    process.stderr.write = this.stderrGuard;
  }

  public stop(): void {
    if (this.stdoutOriginal && process.stdout.write === this.stdoutGuard) {
      process.stdout.write = this.stdoutOriginal;
    }
    if (this.stderrOriginal && process.stderr.write === this.stderrGuard) {
      process.stderr.write = this.stderrOriginal;
    }
    this.stdoutOriginal = null;
    this.stderrOriginal = null;
    this.stdoutGuard = null;
    this.stderrGuard = null;
  }

  private createGuard(
    stream: NodeJS.WriteStream,
    original: StreamWrite,
  ): StreamWrite {
    let pending = "";
    return ((chunk: string | Uint8Array, ...args: unknown[]) => {
      const source =
        typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf8");
      const combined = pending + source;
      const lastEscape = combined.lastIndexOf("\u001b");
      const tail = lastEscape >= 0 ? combined.slice(lastEscape) : "";
      const incompleteCsi =
        tail.startsWith("\u001b[") && !/[@-~]/.test(tail.slice(2));
      const incompleteOsc =
        tail.startsWith("\u001b]") &&
        !tail.includes("\u0007") &&
        !tail.includes("\u001b\\");
      const incompleteEscape =
        tail === "\u001b" || incompleteCsi || incompleteOsc;
      const ready = incompleteEscape ? combined.slice(0, lastEscape) : combined;
      pending = incompleteEscape ? tail : "";
      const clean = stripScreenReaderControls(ready);
      return Reflect.apply(original, stream, [clean, ...args]) as boolean;
    }) as StreamWrite;
  }
}
