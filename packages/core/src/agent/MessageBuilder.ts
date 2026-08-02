import { OrbitMessage } from "@orbit-build/model-providers";
import { ContextPack } from "@orbit-build/context-engine";
import { AgentState } from "./AgentState.js";

export interface MessageBuilderOptions {
  now?: Date;
  repoMapText?: string;
}

export const VOLATILE_CONTEXT_MESSAGE_KIND = "orbit_volatile_context";

export interface BuiltModelMessages {
  system: string;
  messages: OrbitMessage[];
  contextMessageAdded: boolean;
}

export class MessageBuilder {
  public static build(
    systemPrompt: string,
    state: AgentState,
    contextPack: ContextPack,
    options: MessageBuilderOptions = {},
  ): BuiltModelMessages {
    const dynamicContextStr = this.buildVolatileContext(contextPack, {
      ...options,
      task: state.task,
    });

    const messages = [...state.history];
    let targetUserIndex = -1;
    for (let index = messages.length - 1; index >= 0; index--) {
      const message = messages[index];
      if (
        message.role === "user" &&
        message.metadata?.kind !== VOLATILE_CONTEXT_MESSAGE_KIND
      ) {
        targetUserIndex = index;
        break;
      }
    }
    const targetUser = messages[targetUserIndex];
    const contextAlreadyPresent = targetUser
      ? messages.some(
          (message) =>
            message.metadata?.kind === VOLATILE_CONTEXT_MESSAGE_KIND &&
            message.metadata?.forMessageId === targetUser.id,
        )
      : true;
    const contextMessageAdded = Boolean(targetUser && !contextAlreadyPresent);

    if (targetUser && !contextAlreadyPresent) {
      messages.splice(targetUserIndex, 0, {
        id: `msg_context_${targetUser.id}`,
        role: "user",
        createdAt: options.now?.toISOString() || new Date().toISOString(),
        content: [{ type: "text", text: dynamicContextStr }],
        metadata: {
          kind: VOLATILE_CONTEXT_MESSAGE_KIND,
          forMessageId: targetUser.id,
        },
      });
    }

    return {
      system: systemPrompt,
      messages,
      contextMessageAdded,
    };
  }

  public static buildVolatileContext(
    contextPack: ContextPack,
    options: MessageBuilderOptions & { task?: string } = {},
  ): string {
    const filesByPath = new Map<
      string,
      {
        path: string;
        reasons: Set<string>;
        summary?: string;
        excerpt?: string;
        readOnly?: boolean;
      }
    >();

    for (const file of contextPack.relevantFiles) {
      const existing = filesByPath.get(file.path);
      if (existing) {
        existing.reasons.add(file.reason);
        existing.readOnly ||= file.readOnly;
        existing.summary ||= file.summary;
        existing.excerpt ||= file.excerpt;
      } else {
        filesByPath.set(file.path, {
          path: file.path,
          reasons: new Set([file.reason]),
          summary: file.summary,
          excerpt: file.excerpt,
          readOnly: file.readOnly,
        });
      }
    }

    const sortedFiles = [...filesByPath.values()].sort((a, b) => {
      if (a.readOnly !== b.readOnly) return a.readOnly ? -1 : 1;
      return a.path.localeCompare(b.path);
    });
    const filesContent = sortedFiles
      .map((f) => {
        const readOnlySuffix = f.readOnly
          ? " (READ-ONLY REFERENCE - DO NOT EDIT OR CALL WRITE TOOLS ON THIS FILE)"
          : "";
        const reason = [...f.reasons].sort().join("; ");
        return [
          `File: ${this.normalizeContextText(f.path)}${readOnlySuffix}`,
          `Reason: ${this.normalizeContextText(reason)}`,
          `Summary: ${this.normalizeContextText(f.summary || "")}`,
          "```",
          this.normalizeContextText(f.excerpt || ""),
          "```",
        ].join("\n");
      })
      .join("\n\n");
    const activeSkillsContent = (contextPack.activeSkills || [])
      .map((skill) => {
        return [
          `Skill: ${this.normalizeContextText(skill.name)}`,
          `Path: ${this.normalizeContextText(skill.path)}`,
          `Resources: skill://${this.normalizeContextText(skill.name)}/`,
          `Activation: ${skill.activation || "auto"}; loadedBytes: ${skill.loadedBytes || this.normalizeContextText(skill.content).length}; truncated: ${skill.truncated ? "yes" : "no"}`,
          skill.description
            ? `Description: ${this.normalizeContextText(skill.description)}`
            : "",
          "```markdown",
          this.normalizeContextText(skill.content),
          "```",
        ]
          .filter(Boolean)
          .join("\n");
      })
      .join("\n\n");

    const dynamicContextParts = [
      "### Volatile Context",
      `\n### Context Instructions:\n- You are strictly prohibited from calling any tools (like write_file, edit_file) to modify any files marked as "READ-ONLY REFERENCE". Those files are for your reference only.`,
      activeSkillsContent
        ? `\n### Active Skills\nUse these skill instructions only when they apply to this turn. Follow progressive-loading instructions and address bundled files with the displayed skill:// resource root.\n\n${activeSkillsContent}`
        : "",
      `\n### Relevant Files Excerpts:\n\n${filesContent || "No files indexed yet."}`,
      contextPack.codebaseContext
        ? `\n### Codebase Context:\n\n${this.normalizeContextText(contextPack.codebaseContext)}`
        : "",
      options.repoMapText
        ? `\n### Repository Map:\n\n${this.normalizeContextText(options.repoMapText)}`
        : "",
      this.buildRuntimeContext(options.now || new Date(), {
        precise: this.isTimeSensitiveTask(options.task || ""),
      }),
    ];

    return dynamicContextParts.filter(Boolean).join("\n");
  }

  private static buildRuntimeContext(
    now: Date,
    options: { precise: boolean },
  ): string {
    const timezone =
      Intl.DateTimeFormat().resolvedOptions().timeZone || "local";
    const offsetMinutes = -now.getTimezoneOffset();
    const offsetSign = offsetMinutes >= 0 ? "+" : "-";
    const absOffset = Math.abs(offsetMinutes);
    const offset = `UTC${offsetSign}${this.pad(Math.floor(absOffset / 60))}:${this.pad(absOffset % 60)}`;
    const localDate = [
      now.getFullYear(),
      this.pad(now.getMonth() + 1),
      this.pad(now.getDate()),
    ].join("-");
    const lines = [
      "\n### Runtime Context:",
      `- Current local date: ${localDate}`,
      `- Time zone: ${timezone} (${offset})`,
      "- Resolve relative dates such as today, tomorrow, yesterday, latest, current, and now against this runtime date.",
      "- For weather, news, prices, laws, model/API docs, schedules, or other time-sensitive facts, use web_search and trust live results over model training memory.",
      "- Treat only successful, relevant live-tool results as evidence. If every lookup fails or reports low confidence, say that the information could not be verified; never infer that nothing happened, that sources have not updated, or another factual explanation for the failure.",
      "- For verified time-sensitive claims, identify the supporting source and preserve its URL when the tool provides one.",
    ];
    if (options.precise) {
      const localTime = [
        this.pad(now.getHours()),
        this.pad(now.getMinutes()),
        this.pad(now.getSeconds()),
      ].join(":");
      lines.splice(
        3,
        0,
        `- Current local time: ${localTime}`,
        `- Current ISO time: ${now.toISOString()}`,
      );
    }
    return lines.join("\n");
  }

  private static pad(value: number): string {
    return value.toString().padStart(2, "0");
  }

  private static normalizeContextText(text: string): string {
    return text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  }

  private static isTimeSensitiveTask(task: string): boolean {
    return /(?:today|tomorrow|yesterday|latest|current|now|weather|forecast|news|price|schedule|law|api docs|version|release|date|time|今天|今日|明天|昨天|最新|当前|现在|实时|天气|预报|新闻|价格|日程|法律|法规|日期|时间)/i.test(
      task,
    );
  }
}
