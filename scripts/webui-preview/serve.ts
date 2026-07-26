/**
 * Design-review harness: serves the real Orbit WebUI with rich demo data so
 * every surface can be inspected or screenshotted without a provider key.
 *
 * Run with `pnpm webui:preview` (bundles this file via esbuild, then runs
 * it). Pair with `pnpm webui:shots <url>` to capture the standard set of
 * light/dark/mobile screenshots for design review.
 */
import { DEFAULT_CONFIG } from "../../packages/config/src/defaults.js";
import { startOrbitWebUi } from "../../packages/cli/src/runtime/webui/WebUiServer.js";

const now = Date.parse("2026-07-26T09:00:00.000Z");
const at = (minutes: number) => new Date(now + minutes * 60_000).toISOString();

const DIFF = [
  "--- a/src/routes/user.ts",
  "+++ b/src/routes/user.ts",
  "@@ -12,7 +12,9 @@",
  " export async function getUser(req: Request) {",
  "   const id = req.params.id;",
  "-  const user = await db.users.find(id);",
  "-  return json(user);",
  "+  const user = await db.users.findOrFail(id);",
  "+  if (!user.active) throw new HttpError(404);",
  "+  return json(serializeUser(user));",
  " }",
].join("\n");

const MARKDOWN_REPLY = [
  "## Auth route hardening",
  "",
  "I reviewed the login flow and applied three changes:",
  "",
  "1. **Input validation** — `email` and `password` now run through `zod` before hitting the handler.",
  "2. *Rate limiting* — sliding window of 10 attempts per minute keyed by IP.",
  "3. ~~Session fixation~~ fixed by rotating the session id on privilege change.",
  "",
  "| Check | Before | After |",
  "| --- | --- | --- |",
  "| Validation | none | `zod` schema |",
  "| Rate limit | none | 10/min |",
  "| Session rotation | no | yes |",
  "",
  "> Note: the rate limiter stores counters in memory; use Redis in multi-node deployments.",
  "",
  "```ts",
  "export const LoginSchema = z.object({",
  "  email: z.string().email(),",
  "  password: z.string().min(12),",
  "});",
  "",
  "export async function login(input: unknown) {",
  "  const { email, password } = LoginSchema.parse(input);",
  "  return authenticate(email, password);",
  "}",
  "```",
  "",
  "Here is the exact change applied to the user route:",
  "",
  "```diff",
  DIFF,
  "```",
  "",
  "Next I suggest wiring the audit log sink — say `continue` and I'll take it.",
].join("\n");

const history = [
  {
    id: "m1",
    role: "user" as const,
    createdAt: at(0),
    content: [
      {
        type: "text" as const,
        text: "Harden the auth routes: validation, rate limiting, and fix the session fixation issue.",
      },
    ],
  },
  {
    id: "m2",
    role: "assistant" as const,
    createdAt: at(2),
    metadata: { model: "deepseek-v4-pro" },
    content: [{ type: "text" as const, text: MARKDOWN_REPLY }],
  },
  {
    id: "m3",
    role: "user" as const,
    createdAt: at(4),
    content: [
      { type: "text" as const, text: "Looks good. What about the tests?" },
    ],
  },
  {
    id: "m4",
    role: "assistant" as const,
    createdAt: at(5),
    metadata: { model: "deepseek-v4-flash" },
    content: [
      {
        type: "text" as const,
        text: "Added `auth.routes.test.ts` covering invalid email, short password, rate-limit lockout, and session-id rotation — 14 cases, all green in 1.8s.",
      },
    ],
  },
];

const handle = await startOrbitWebUi({
  cwd: process.cwd(),
  config: {
    ...DEFAULT_CONFIG,
    language: "en",
  },
  port: 4599,
  open: false,
  loop: {
    getSessionId: () => "design-review",
    getGoal: () => "Harden authentication routes end to end",
    getHistory: () => history,
    getSessions: () => [
      {
        id: "design-review",
        title: "Auth route hardening",
        updatedAt: at(5),
        status: "active",
      },
      {
        id: "sess-2",
        title: "Vector store compaction",
        updatedAt: at(-320),
        status: "active",
      },
      {
        id: "sess-3",
        title: "Release 3.4.0 checklist",
        updatedAt: at(-1440),
        status: "archived",
      },
    ],
    getRelevantFiles: () => [
      { path: "src/routes/user.ts", reason: "edited" },
      { path: "src/auth/login.ts", reason: "edited" },
      { path: "src/auth/session.ts", reason: "context", readOnly: true },
    ],
    getTaskPlan: () => ({
      items: [
        { id: "p1", text: "Add zod validation to auth inputs", status: "completed" },
        { id: "p2", text: "Rate-limit login attempts", status: "completed" },
        { id: "p3", text: "Rotate session ids on privilege change", status: "in_progress" },
        { id: "p4", text: "Wire audit log sink", status: "pending" },
      ],
    }),
    getProjectMemory: () => ({
      enabled: true,
      entries: [
        { id: "mem1", text: "Auth service deploys behind nginx; real IP is in X-Forwarded-For." },
        { id: "mem2", text: "Use Redis for shared counters in production." },
      ],
    }),
    getSessionMetrics: () => ({
      eventCount: 182,
      toolRuns: 24,
      toolFailures: 1,
      deniedTools: 0,
      filesChanged: 5,
      modelSwitches: 3,
      routingDecisions: 12,
      fastRoutes: 7,
      qualityRoutes: 5,
      compactions: 1,
      resumedCount: 0,
    }),
    getSessionCost: () => 0.42,
    getTotalInputTokens: () => 184_320,
    getTotalCacheReadTokens: () => 96_000,
    getTotalOutputTokens: () => 23_512,
    getContextWindowStatus: () => ({
      model: "deepseek-v4-pro",
      maxContextTokens: 128_000,
      compactAtTokens: 96_000,
      estimatedHistoryTokens: 41_500,
    }),
    getSessionReview: () => ({
      fileChanges: [
        {
          id: "chg1",
          path: "src/routes/user.ts",
          diff: DIFF,
          createdAt: at(3),
        },
        {
          id: "chg2",
          path: "src/auth/login.ts",
          diff: [
            "--- a/src/auth/login.ts",
            "+++ b/src/auth/login.ts",
            "@@ -1,4 +1,6 @@",
            "+import { LoginSchema } from './schema.js';",
            "+import { rateLimit } from './rateLimit.js';",
            " import { authenticate } from './core.js';",
            " ",
            " export async function login(input: unknown) {",
          ].join("\n"),
          createdAt: at(2),
        },
      ],
      checkpoints: [
        { id: "cp_1", timestamp: at(1), message: "before login.ts edit" },
        { id: "cp_2", timestamp: at(3), message: "before user.ts edit" },
      ],
      verification: [
        { id: "v1", type: "tests", success: true, detail: "14 passed" },
        { id: "v2", type: "lint", success: true, detail: "clean" },
      ],
    }),
  },
  getProjects: () => [
    {
      id: "proj_a",
      path: "C:/work/orbit-demo",
      name: "orbit-demo",
      lastOpenedAt: at(0),
      available: true,
    },
    {
      id: "proj_b",
      path: "C:/work/billing-service",
      name: "billing-service",
      lastOpenedAt: at(-2000),
      available: true,
    },
  ],
  getAgentRuns: () => [],
  submitPrompt: async () => ({ ok: true }),
  cancelPrompt: () => ({ ok: true }),
  updateSettings: async () => ({ ok: true }),
  updateSession: async () => ({ ok: true }),
  updateReview: async () => ({ ok: true }),
  getPendingApproval: () => ({
    id: "b2a4c5ce-0000-4000-8000-000000000001",
    kind: "change",
    title: "Accept changes to src/routes/user.ts?",
    reason: "Review the diff before keeping or rolling back this change.",
    preview: DIFF,
    requestedAt: at(5),
  }),
  respondToApproval: () => ({ ok: true }),
});

console.log(`PREVIEW_URL=${handle.url}`);
