import picocolors from "picocolors";

export class StatusBar {
  private timer: NodeJS.Timeout | null = null;
  private message = "";
  private startTime = 0;
  private isActive = false;
  private spinnerFrame = 0;
  private readonly spinnerFrames = [
    "⠋",
    "⠙",
    "⠹",
    "⠸",
    "⠼",
    "⠴",
    "⠦",
    "⠧",
    "⠇",
    "⠏",
  ];
  private originalWrite: typeof process.stdout.write | null = null;
  private originalErrWrite: typeof process.stderr.write | null = null;
  private stdoutInterceptor: typeof process.stdout.write | null = null;
  private stderrInterceptor: typeof process.stderr.write | null = null;

  constructor(private disabled = false) {}

  public start(message: string): void {
    if (this.disabled || process.stdout.isTTY !== true) return;
    if (this.isActive) {
      this.update(message);
      return;
    }
    this.isActive = true;
    this.message = message;
    this.startTime = Date.now();
    this.spinnerFrame = 0;

    this.originalWrite = process.stdout.write;
    this.originalErrWrite = process.stderr.write;
    this.stdoutInterceptor = ((...args: unknown[]) => {
      this.clearStatus();
      const result = Reflect.apply(this.originalWrite!, process.stdout, args);
      this.drawStatus();
      return result;
    }) as typeof process.stdout.write;

    this.stderrInterceptor = ((...args: unknown[]) => {
      this.clearStatus();
      const result = Reflect.apply(
        this.originalErrWrite!,
        process.stderr,
        args,
      );
      this.drawStatus();
      return result;
    }) as typeof process.stderr.write;
    process.stdout.write = this.stdoutInterceptor;
    process.stderr.write = this.stderrInterceptor;

    this.timer = setInterval(() => {
      this.spinnerFrame = (this.spinnerFrame + 1) % this.spinnerFrames.length;
      this.drawStatus();
    }, 100);
    this.timer.unref?.();
  }

  public update(message: string): void {
    if (this.disabled) return;
    this.message = message;
    this.drawStatus();
  }

  public stop(): void {
    if (this.disabled) return;
    if (!this.isActive) return;
    this.isActive = false;

    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }

    this.clearStatus();

    if (this.originalWrite && process.stdout.write === this.stdoutInterceptor) {
      process.stdout.write = this.originalWrite;
    }
    if (
      this.originalErrWrite
      && process.stderr.write === this.stderrInterceptor
    ) {
      process.stderr.write = this.originalErrWrite;
    }
    this.originalWrite = null;
    this.originalErrWrite = null;
    this.stdoutInterceptor = null;
    this.stderrInterceptor = null;
  }

  private drawStatus(): void {
    if (!this.isActive) return;
    const elapsed = ((Date.now() - this.startTime) / 1000).toFixed(1);
    const spinner = this.spinnerFrames[this.spinnerFrame];
    const statusLine = `\r\x1b[K${picocolors.cyan(spinner)} ${this.message} (${elapsed}s)`;
    if (this.originalWrite) {
      Reflect.apply(this.originalWrite, process.stdout, [statusLine]);
    }
  }

  private clearStatus(): void {
    if (this.originalWrite) {
      Reflect.apply(this.originalWrite, process.stdout, ["\r\x1b[K"]);
    }
  }
}
