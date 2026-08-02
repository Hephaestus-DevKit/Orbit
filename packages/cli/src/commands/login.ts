import readline from "readline";
import picocolors from "picocolors";
import {
  CredentialsManager,
  ProviderProfileStore,
  type ProviderProfile,
} from "@orbit-build/config";
import { discoverProviderModels } from "../runtime/ModelDiscovery.js";

interface ProviderTemplate {
  id: string;
  name: string;
  envVar: string;
  type:
    | "openai"
    | "anthropic"
    | "openai-compatible"
    | "anthropic-compatible"
    | "ollama";
  baseUrl: string;
  discoverModels: boolean;
  requiresApiKey?: boolean;
  deepSeekApiFormat?: "auto" | "chat-completions" | "responses";
}

export interface LoginOptions {
  list?: boolean;
  deleteProvider?: string;
  provider?: string;
  baseUrl?: string;
  name?: string;
  activate?: boolean;
}

const PROVIDER_TEMPLATES: ProviderTemplate[] = [
  {
    id: "ollama",
    name: "Ollama (local)",
    envVar: "",
    type: "ollama",
    baseUrl: "http://localhost:11434",
    discoverModels: true,
    requiresApiKey: false,
  },
  {
    id: "tokendance",
    name: "TokenDance",
    envVar: "TOKENDANCE_API_KEY",
    type: "openai-compatible",
    baseUrl: "https://tokendance.space/gateway/v1",
    discoverModels: true,
    deepSeekApiFormat: "chat-completions",
  },
  {
    id: "deepseek-openai",
    name: "DeepSeek (OpenAI compatible)",
    envVar: "DEEPSEEK_API_KEY",
    type: "openai-compatible",
    baseUrl: "https://api.deepseek.com",
    discoverModels: false,
    deepSeekApiFormat: "auto",
  },
  {
    id: "openai",
    name: "OpenAI",
    envVar: "OPENAI_API_KEY",
    type: "openai",
    baseUrl: "https://api.openai.com/v1",
    discoverModels: true,
  },
  {
    id: "anthropic",
    name: "Anthropic",
    envVar: "ANTHROPIC_API_KEY",
    type: "anthropic",
    baseUrl: "https://api.anthropic.com",
    discoverModels: false,
  },
  {
    id: "deepseek-anthropic",
    name: "DeepSeek (Anthropic compatible)",
    envVar: "ANTHROPIC_AUTH_TOKEN",
    type: "anthropic-compatible",
    baseUrl: "https://api.deepseek.com/anthropic",
    discoverModels: false,
  },
];

function askQuestion(query: string, defaultValue = ""): Promise<string> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  return new Promise((resolve) => {
    rl.question(query, (answer) => {
      rl.close();
      resolve(answer.trim() || defaultValue);
    });
  });
}

function askSecret(query: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const stdin = process.stdin;
    const stdout = process.stdout;
    if (
      !stdin.isTTY ||
      !stdout.isTTY ||
      typeof stdin.setRawMode !== "function"
    ) {
      reject(
        new Error(
          "Secure API-key input requires an interactive terminal. Open Command Prompt or PowerShell and run orbit login again.",
        ),
      );
      return;
    }

    stdout.write(query);
    const wasRaw = stdin.isRaw;
    stdin.setRawMode(true);
    stdin.resume();
    let input = "";

    const cleanup = () => {
      stdin.removeListener("data", onData);
      stdin.removeListener("end", onEnd);
      stdin.setRawMode(Boolean(wasRaw));
      if (!wasRaw) stdin.pause();
    };
    const onEnd = () => {
      cleanup();
      reject(new Error("Secure API-key input ended before a value was read."));
    };
    const onData = (char: Buffer) => {
      const charStr = char.toString("utf8");
      switch (charStr) {
        case "\n":
        case "\r":
        case "\u0004":
          cleanup();
          stdout.write("\n");
          resolve(input.trim());
          break;
        case "\u0003":
          cleanup();
          stdout.write("\n");
          process.exitCode = 130;
          resolve("");
          break;
        case "\u0008":
        case "\x7f":
          if (input.length > 0) {
            input = input.slice(0, -1);
            stdout.write(`\r${query}${"*".repeat(input.length)} `);
            stdout.write(`\r${query}${"*".repeat(input.length)}`);
          }
          break;
        default:
          if (charStr.charCodeAt(0) >= 32) {
            input += charStr;
            stdout.write("*");
          }
      }
    };

    stdin.on("data", onData);
    stdin.once("end", onEnd);
  });
}

function profileEnvVar(id: string): string {
  return `ORBIT_PROVIDER_${id.replace(/[^a-z0-9]/gi, "_").toUpperCase()}_API_KEY`;
}

function slugifyProviderId(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^[^a-z0-9]+|[^a-z0-9]+$/g, "")
    .slice(0, 64);
}

function printProfiles(
  store: ProviderProfileStore,
  credentials: CredentialsManager,
): void {
  const snapshot = store.read();
  console.log(picocolors.bold("\nSaved provider logins\n"));
  if (snapshot.profiles.length === 0) {
    console.log(picocolors.gray("  No saved provider profiles."));
    return;
  }
  for (const profile of snapshot.profiles) {
    const active = snapshot.activeProvider === profile.id ? "●" : "○";
    const credential = profile.config.apiKeyEnv
      ? credentials.hasSecret(profile.config.apiKeyEnv)
      : false;
    const credentialStatus =
      profile.config.type === "ollama"
        ? picocolors.cyan("local · no credential")
        : credential
          ? picocolors.green("credential saved")
          : picocolors.yellow("credential missing");
    console.log(
      `  ${active} ${picocolors.bold(profile.name)} ${picocolors.gray(`(${profile.id})`)}  ${credentialStatus}`,
    );
    console.log(
      `    ${picocolors.gray(profile.config.baseUrl || "default endpoint")} · ${profile.config.models?.length || 0} models`,
    );
  }
}

async function configureProvider(
  template: ProviderTemplate,
  options: LoginOptions,
  store: ProviderProfileStore,
  credentials: CredentialsManager,
): Promise<void> {
  const existing = store.get(template.id);
  const requestedName =
    options.name ||
    (await askQuestion(
      `Profile name [${existing?.name || template.name}]: `,
      existing?.name || template.name,
    ));
  const requestedBaseUrl =
    options.baseUrl ||
    (await askQuestion(
      `API Base URL (include /v1 when required) [${existing?.config.baseUrl || template.baseUrl}]: `,
      existing?.config.baseUrl || template.baseUrl,
    ));
  const requiresApiKey = template.requiresApiKey !== false;
  const apiKey = requiresApiKey
    ? await askSecret("API key (input hidden): ")
    : undefined;
  if (requiresApiKey && !apiKey) {
    console.log(picocolors.yellow("⚠ Provider login cancelled."));
    return;
  }

  const baseUrl = requestedBaseUrl.replace(/\/$/, "");
  let models = existing?.config.models;
  let modelCapabilities = existing?.config.modelCapabilities;
  if (template.discoverModels || template.type.includes("openai")) {
    console.log(picocolors.cyan("● Scanning the provider model catalog…"));
    const discovered = await discoverProviderModels({
      baseUrl: requestedBaseUrl,
      apiKey,
      ...(template.type === "ollama" ? { providerType: "ollama" } : {}),
    });
    models = discovered.models;
    modelCapabilities = discovered.modelCapabilities;
    console.log(
      picocolors.green(
        `✔ Found ${discovered.models.length} models at ${discovered.modelsEndpoint}`,
      ),
    );
  }

  if (requiresApiKey && apiKey)
    credentials.storeSecret(template.envVar, apiKey);
  store.upsert({
    id: template.id,
    name: requestedName,
    config: {
      type: template.type,
      baseUrl,
      ...(requiresApiKey ? { apiKeyEnv: template.envVar } : {}),
      ...(template.deepSeekApiFormat
        ? { deepSeekApiFormat: template.deepSeekApiFormat }
        : {}),
      ...(models ? { models } : {}),
      ...(modelCapabilities ? { modelCapabilities } : {}),
    },
  });
  if (options.activate !== false) store.setActive(template.id);
  console.log(
    picocolors.green(
      `✔ ${requestedName} ${requiresApiKey ? "saved securely" : "saved"}${options.activate === false ? "." : " and selected as the active provider."}`,
    ),
  );
}

async function configureCustomProvider(
  options: LoginOptions,
  store: ProviderProfileStore,
  credentials: CredentialsManager,
): Promise<void> {
  const name =
    options.name ||
    (await askQuestion("Provider name (for example My Gateway): "));
  const id = slugifyProviderId(options.provider || name);
  if (!id) throw new Error("Provider name must contain letters or numbers.");
  const template: ProviderTemplate = {
    id,
    name: name || id,
    envVar: profileEnvVar(id),
    type: "openai-compatible",
    baseUrl:
      options.baseUrl ||
      (await askQuestion(
        "OpenAI-compatible API Base URL (include /v1 when required): ",
      )),
    discoverModels: true,
  };
  await configureProvider(
    template,
    { ...options, name, baseUrl: template.baseUrl },
    store,
    credentials,
  );
}

function deleteProviderLogin(
  providerId: string,
  store: ProviderProfileStore,
  credentials: CredentialsManager,
): boolean {
  const profile = store.delete(providerId);
  const template = PROVIDER_TEMPLATES.find(
    (candidate) => candidate.id === providerId,
  );
  const envVar = profile?.config.apiKeyEnv || template?.envVar;
  const secretDeleted = envVar ? credentials.deleteSecret(envVar) : false;
  return Boolean(profile || secretDeleted);
}

async function chooseSavedProvider(
  profiles: ProviderProfile[],
  prompt: string,
): Promise<ProviderProfile | undefined> {
  if (profiles.length === 0) return undefined;
  profiles.forEach((profile, index) => {
    console.log(
      `  ${picocolors.cyan(String(index + 1))}) ${profile.name} (${profile.id})`,
    );
  });
  const selected = Number(await askQuestion(prompt));
  return Number.isInteger(selected) && selected > 0
    ? profiles[selected - 1]
    : undefined;
}

/** Manage secure provider logins and their non-secret connection profiles. */
export async function runLogin(options: LoginOptions = {}): Promise<void> {
  const credentials = new CredentialsManager();
  const store = new ProviderProfileStore();
  try {
    if (options.list) {
      printProfiles(store, credentials);
      return;
    }
    if (options.deleteProvider) {
      const deleted = deleteProviderLogin(
        options.deleteProvider,
        store,
        credentials,
      );
      console.log(
        deleted
          ? picocolors.green(
              `✔ Deleted provider login: ${options.deleteProvider}`,
            )
          : picocolors.yellow(
              `⚠ Provider login not found: ${options.deleteProvider}`,
            ),
      );
      return;
    }
    if (options.provider) {
      const template = PROVIDER_TEMPLATES.find(
        (candidate) => candidate.id === options.provider,
      );
      if (template) {
        await configureProvider(template, options, store, credentials);
      } else {
        await configureCustomProvider(options, store, credentials);
      }
      return;
    }

    console.log(picocolors.bold("\nOrbit provider logins"));
    printProfiles(store, credentials);
    console.log("\n  1) Scan or update local Ollama");
    console.log("  2) Add or update TokenDance");
    console.log("  3) Add a custom OpenAI-compatible provider");
    console.log("  4) Add or update another built-in provider");
    console.log("  5) Select the active provider");
    console.log("  6) Delete a saved provider login");
    console.log("  7) Exit\n");
    const action = await askQuestion("Choose an action (1-7): ");
    if (action === "1") {
      await configureProvider(
        PROVIDER_TEMPLATES[0]!,
        options,
        store,
        credentials,
      );
    } else if (action === "2") {
      await configureProvider(
        PROVIDER_TEMPLATES[1]!,
        options,
        store,
        credentials,
      );
    } else if (action === "3") {
      await configureCustomProvider(options, store, credentials);
    } else if (action === "4") {
      PROVIDER_TEMPLATES.slice(2).forEach((template, index) => {
        console.log(`  ${index + 1}) ${template.name}`);
      });
      const selected = Number(await askQuestion("Provider: "));
      const template = PROVIDER_TEMPLATES.slice(2)[selected - 1];
      if (template)
        await configureProvider(template, options, store, credentials);
    } else if (action === "5") {
      const selected = await chooseSavedProvider(
        store.list(),
        "Active provider: ",
      );
      if (selected) {
        store.setActive(selected.id);
        console.log(picocolors.green(`✔ Active provider: ${selected.name}`));
      }
    } else if (action === "6") {
      const selected = await chooseSavedProvider(
        store.list(),
        "Delete provider login: ",
      );
      if (selected && deleteProviderLogin(selected.id, store, credentials)) {
        console.log(
          picocolors.green(`✔ Deleted provider login: ${selected.name}`),
        );
      }
    }
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    console.log(picocolors.red(`\n✖ Provider login failed: ${message}`));
  }
}
