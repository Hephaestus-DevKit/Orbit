import { z } from "zod";
import { OrbitTool } from "./types.js";

const ToolRegistrationSchema = z.object({
  name: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/),
  description: z.string().trim().min(1).max(20_000),
  risk: z.enum(["read", "write", "execute", "network", "dangerous"]),
});

export interface ToolRegistrationOptions {
  /** Replace an existing tool deliberately; duplicates fail closed by default. */
  replace?: boolean;
}

export class ToolRegistry {
  private tools = new Map<string, OrbitTool<unknown, unknown>>();

  public register(
    tool: OrbitTool<unknown, unknown>,
    options: ToolRegistrationOptions = {},
  ): void {
    ToolRegistrationSchema.parse(tool);
    if (this.tools.has(tool.name) && !options.replace) {
      throw new Error(`Tool "${tool.name}" is already registered.`);
    }
    this.tools.set(tool.name, tool);
  }

  public unregister(
    name: string,
    expectedTool?: OrbitTool<unknown, unknown>,
  ): boolean {
    if (expectedTool && this.tools.get(name) !== expectedTool) return false;
    return this.tools.delete(name);
  }

  get(name: string): OrbitTool<unknown, unknown> | undefined {
    return this.tools.get(name);
  }

  list(): OrbitTool<unknown, unknown>[] {
    return Array.from(this.tools.values());
  }

  getDefinitions() {
    return this.list().map((t) => ({
      name: t.name,
      description: t.description,
      inputSchema: t.inputSchema,
      inputJsonSchema: t.inputJsonSchema,
    }));
  }
}

export const toolRegistry = new ToolRegistry();
