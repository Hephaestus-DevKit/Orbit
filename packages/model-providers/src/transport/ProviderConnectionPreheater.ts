/**
 * Idempotent, best-effort DNS/TLS/connection preheater shared by HTTP model
 * transports. Construction is side-effect free; network I/O starts only from
 * the explicit `initialize` lifecycle method.
 */
export class ProviderConnectionPreheater {
  private initialization: Promise<void> | undefined;

  constructor(
    private readonly endpoint: string,
    private readonly disabled = false,
    private readonly timeoutMs = 1_000,
  ) {}

  public initialize(): Promise<void> {
    if (this.disabled || !this.endpoint || typeof fetch !== "function") {
      return Promise.resolve();
    }
    this.initialization ??= this.preheat();
    return this.initialization;
  }

  private async preheat(): Promise<void> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    timeout.unref?.();
    try {
      const response = await fetch(this.endpoint, {
        method: "HEAD",
        signal: controller.signal,
      });
      await response.body?.cancel().catch(() => undefined);
    } catch {
      // Connection warming is an optimization and must never block a request.
    } finally {
      clearTimeout(timeout);
    }
  }
}
