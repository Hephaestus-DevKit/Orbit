/** A provider-neutral option shown by an agent interaction surface. */
export interface AgentPromptOption {
  value: string;
  label: string;
  hint?: string;
  deleteDisabled?: boolean;
}

/** The small prompt surface the core agent may need during a turn. */
export interface AgentPromptPort {
  askSelect(
    message: string,
    options: AgentPromptOption[],
  ): Promise<string | null>;
  askText(message: string, initialValue?: string): Promise<string | null>;
  askMultiSelect(
    message: string,
    options: AgentPromptOption[],
  ): Promise<string[] | null>;
}

/** Progress is deliberately a port so the core never imports a TUI. */
export interface AgentProgressPort {
  start(message: string): void;
  stop(): void;
}

/** The only user-facing surface required by the core agent. */
export interface UserInteraction {
  askApproval(reason: string, preview?: string): Promise<boolean>;
  askToolApproval?(request: {
    toolCallId: string;
    toolName: string;
    reason: string;
    preview?: string;
  }): Promise<boolean>;
  reviewFileChange?(request: {
    filePath: string;
    before: string | null;
    after: string;
  }): Promise<boolean>;
  prompt?: AgentPromptPort;
  progress?: AgentProgressPort;
  formatThought?(text: string): string;
  formatMarkdown?(text: string): string;
  showText(text: string): void;
  showDiff(
    filePath: string,
    before: string | null,
    after: string,
  ): void | Promise<void>;
}
