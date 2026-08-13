import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";

const repositoryRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const cliRoot = join(repositoryRoot, "packages", "cli");
const cliEntry = join(cliRoot, "dist", "index.js");
const manifest = z
  .object({ version: z.string().regex(/^\d+\.\d+\.\d+(?:-[\w.-]+)?$/) })
  .parse(JSON.parse(readFileSync(join(cliRoot, "package.json"), "utf8")));

const DoctorSmokeSchema = z.object({
  schemaVersion: z.literal(1),
  status: z.enum(["ok", "warning", "error"]),
  orbit: z.object({ version: z.string(), configSchemaVersion: z.number() }),
  runtime: z.object({ nodeSupported: z.boolean() }).passthrough(),
  workspace: z.object({ pathRedacted: z.literal(true) }).passthrough(),
  provider: z.object({ apiKeyLoaded: z.boolean() }).passthrough(),
});

const JsonRpcResponseSchema = z.object({
  jsonrpc: z.literal("2.0"),
  id: z.union([z.string(), z.number(), z.null()]),
  result: z.unknown().optional(),
  error: z.unknown().optional(),
});

function fail(message) {
  throw new Error(`CLI smoke test failed: ${message}`);
}

function runCli(args, options = {}) {
  const result = spawnSync(process.execPath, [cliEntry, ...args], {
    cwd: options.cwd || repositoryRoot,
    input: options.input,
    encoding: "utf8",
    stdio: [options.input === undefined ? "ignore" : "pipe", "pipe", "pipe"],
    timeout: options.timeout || 20_000,
    windowsHide: true,
  });
  if (result.error) throw result.error;
  const expectedStatus = options.expectedStatus ?? 0;
  if (result.status !== expectedStatus) {
    fail(
      `${JSON.stringify(args)} exited with ${result.status}, expected ${expectedStatus}: ${(result.stderr || result.stdout).trim()}`,
    );
  }
  return {
    status: result.status,
    stdout: result.stdout.trim(),
    stderr: result.stderr.trim(),
  };
}

function jsonAfterFirstBrace(output) {
  const start = output.indexOf("{");
  if (start < 0) fail("expected JSON output");
  return JSON.parse(output.slice(start));
}

function writeRpc(child, message) {
  const body = JSON.stringify(message);
  child.stdin.write(
    `Content-Length: ${Buffer.byteLength(body, "utf8")}\r\n\r\n${body}`,
  );
}

async function smokeLsp() {
  await new Promise((resolveSmoke, rejectSmoke) => {
    const child = spawn(process.execPath, [cliEntry, "lsp"], {
      cwd: repositoryRoot,
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    });
    let buffer = Buffer.alloc(0);
    let expectedBodyBytes;
    let stage = "initialize";
    let stderr = "";
    const timeout = setTimeout(() => {
      child.kill();
      rejectSmoke(new Error("LSP smoke test timed out."));
    }, 10_000);

    const finish = (error) => {
      clearTimeout(timeout);
      if (error) rejectSmoke(error);
      else resolveSmoke();
    };
    child.stderr.on("data", (chunk) => {
      stderr = `${stderr}${chunk.toString("utf8")}`.slice(-4_000);
    });
    child.on("error", finish);
    child.on("exit", (code) => {
      if (stage === "exit" && code === 0) finish();
      else finish(new Error(`LSP exited unexpectedly (${code}): ${stderr}`));
    });
    child.stdout.on("data", (chunk) => {
      buffer = Buffer.concat([buffer, chunk]);
      while (true) {
        if (expectedBodyBytes === undefined) {
          const headerEnd = buffer.indexOf("\r\n\r\n");
          if (headerEnd < 0) return;
          const header = buffer.subarray(0, headerEnd).toString("ascii");
          const match = header.match(/^Content-Length:\s*(\d+)\s*$/im);
          if (!match) return finish(new Error("Invalid LSP response frame."));
          expectedBodyBytes = Number(match[1]);
          buffer = buffer.subarray(headerEnd + 4);
        }
        if (buffer.length < expectedBodyBytes) return;
        const body = buffer.subarray(0, expectedBodyBytes).toString("utf8");
        buffer = buffer.subarray(expectedBodyBytes);
        expectedBodyBytes = undefined;
        const response = JsonRpcResponseSchema.parse(JSON.parse(body));
        if (stage === "initialize") {
          if (response.id !== 1 || response.error) {
            return finish(new Error("LSP initialize failed."));
          }
          stage = "shutdown";
          writeRpc(child, { jsonrpc: "2.0", id: 2, method: "shutdown" });
        } else if (stage === "shutdown") {
          if (response.id !== 2 || response.error) {
            return finish(new Error("LSP shutdown failed."));
          }
          stage = "exit";
          writeRpc(child, { jsonrpc: "2.0", method: "exit" });
          child.stdin.end();
        }
      }
    });
    writeRpc(child, {
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: { processId: null, rootUri: null, capabilities: {} },
    });
  });
}

if (!existsSync(cliEntry)) fail("built CLI entry is missing; run pnpm build");

const version = runCli(["--version"]).stdout;
if (version !== manifest.version) fail(`version mismatch: ${version}`);

const help = runCli(["--help"]).stdout;
for (const command of ["doctor", "bench", "lsp", "exec", "login"]) {
  if (!help.includes(command)) fail(`help is missing ${command}`);
}

const displayedConfig = jsonAfterFirstBrace(runCli(["config"]).stdout);
if (displayedConfig.schemaVersion !== 1)
  fail("config schema version is missing");
if (
  /sk-[A-Za-z0-9_-]{16,}|Bearer\s+[A-Za-z0-9_-]{16,}/.test(
    JSON.stringify(displayedConfig),
  )
) {
  fail("config output appears to contain a credential");
}

const doctor = DoctorSmokeSchema.parse(
  JSON.parse(runCli(["doctor", "--json"]).stdout),
);
if (
  doctor.orbit.version !== manifest.version ||
  !doctor.runtime.nodeSupported
) {
  fail("doctor reported an unsupported runtime or wrong Orbit version");
}

const tempWorkspace = mkdtempSync(join(tmpdir(), "orbit-cli-smoke-"));
try {
  const initResult = JSON.parse(
    runCli(["init", "--json"], { cwd: tempWorkspace }).stdout,
  );
  if (
    initResult.schemaVersion !== 1 ||
    !initResult.files?.some(
      (file) => file.path === "ORBIT.md" && file.status === "created",
    )
  ) {
    fail("orbit init did not report its Agent scaffold");
  }
  const instructionsPath = join(tempWorkspace, "ORBIT.md");
  if (!existsSync(instructionsPath)) fail("orbit init did not create ORBIT.md");
  const instructions = readFileSync(instructionsPath, "utf8");
  if (!instructions.includes("Orbit Agent Contract")) {
    fail("ORBIT.md does not contain the expected Agent contract");
  }
  for (const workflow of ["implement.md", "review.md"]) {
    if (!existsSync(join(tempWorkspace, ".orbit", "commands", workflow))) {
      fail(`orbit init did not create the ${workflow} starter workflow`);
    }
  }
  const repeatInit = JSON.parse(
    runCli(["init", "--json"], { cwd: tempWorkspace }).stdout,
  );
  if (
    !repeatInit.files?.every((file) => file.status === "existing") ||
    readFileSync(instructionsPath, "utf8") !== instructions
  ) {
    fail("orbit init is not idempotent or changed an existing contract");
  }
  const repl = runCli([], {
    cwd: tempWorkspace,
    input: "/exit\n",
    timeout: 30_000,
  });
  if (!repl.stdout.includes("Exiting Orbit Interactive Shell")) {
    fail("non-TTY interactive fallback did not exit cleanly");
  }
  const failedExec = runCli(
    [
      "exec",
      "provider failure smoke",
      "--provider",
      "orbit-missing-provider",
      "--jsonl",
    ],
    { cwd: tempWorkspace, expectedStatus: 4 },
  );
  const terminalEvent = failedExec.stdout
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => JSON.parse(line))
    .find((event) => event.type === "agent_completed");
  if (
    terminalEvent?.payload?.success !== false ||
    terminalEvent?.payload?.result?.error?.code !== "provider_error"
  ) {
    fail("orbit exec did not emit a structured provider failure outcome");
  }
} finally {
  rmSync(tempWorkspace, { recursive: true, force: true });
}

await smokeLsp();

console.log(
  `✔ CLI smoke passed: version, help, redacted config, doctor JSON, init, text REPL, exec exit codes/JSONL, and LSP lifecycle (${manifest.version}).`,
);
