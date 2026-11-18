export interface ProviderSseFrame {
  data: string;
  event?: string;
}

/** Incrementally frame bounded SSE data; an unterminated EOF tail is never an event. */
export class ProviderSseParser {
  private line = "";
  private data: string[] = [];
  private event = "";
  private skipLf = false;
  private atStart = true;
  private frameChars = 0;
  private totalChars = 0;

  constructor(
    private readonly maxFrameChars = 4 * 1024 * 1024,
    private readonly maxTotalChars = 8 * 1024 * 1024,
  ) {}

  /** Accept decoded bytes, including comments and CRLF boundaries split across reads. */
  feed(chunk: string): ProviderSseFrame[] {
    this.totalChars += chunk.length;
    if (this.totalChars > this.maxTotalChars) {
      throw new Error("Provider SSE exceeded the safe total response limit.");
    }
    if (this.atStart && chunk.length > 0) {
      this.atStart = false;
      if (chunk.charCodeAt(0) === 0xfeff) chunk = chunk.slice(1);
    }
    const frames: ProviderSseFrame[] = [];
    let start = 0;
    for (let index = 0; index < chunk.length; index++) {
      const character = chunk[index];
      if (this.skipLf) {
        this.skipLf = false;
        if (character === "\n") {
          start = index + 1;
          continue;
        }
      }
      if (character !== "\n" && character !== "\r") continue;
      this.appendLine(chunk.slice(start, index));
      this.consumeLine(frames);
      this.skipLf = character === "\r";
      start = index + 1;
    }
    this.appendLine(chunk.slice(start));
    return frames;
  }

  private appendLine(value: string): void {
    if (
      this.frameChars + this.line.length + value.length
      > this.maxFrameChars
    ) {
      throw new Error("Provider SSE frame exceeded the safe streaming limit.");
    }
    this.line += value;
  }

  private consumeLine(frames: ProviderSseFrame[]): void {
    const line = this.line;
    this.line = "";
    if (line === "") {
      if (this.data.length > 0) {
        frames.push({
          data: this.data.join("\n"),
          ...(this.event ? { event: this.event } : {}),
        });
      }
      this.data = [];
      this.event = "";
      this.frameChars = 0;
      return;
    }
    this.frameChars += line.length + 1;
    if (this.frameChars > this.maxFrameChars) {
      throw new Error("Provider SSE frame exceeded the safe streaming limit.");
    }
    if (line.startsWith(":")) return;
    const separator = line.indexOf(":");
    const field = separator < 0 ? line : line.slice(0, separator);
    let value = separator < 0 ? "" : line.slice(separator + 1);
    if (value.startsWith(" ")) value = value.slice(1);
    if (field === "data") this.data.push(value);
    else if (field === "event") this.event = value;
  }
}
