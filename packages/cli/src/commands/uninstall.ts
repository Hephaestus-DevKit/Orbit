import { lstatSync, realpathSync } from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, join, parse, relative } from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import picocolors from "picocolors";
import { z } from "zod";
import {
  ConfigLoader,
  localizeOrbit,
  type OrbitLanguage,
  parseOrbitLanguage,
} from "@orbit-build/config";
import { ORCHESTRATED_AGENT_SESSION_PATH } from "@orbit-build/core";
import { resolveSafePath } from "@orbit-build/shared";
import { ProjectRegistry, type ProjectRegistryEntry, SessionStore } from "@orbit-build/session";
import { readLocalRuntimeState, writeLocalRuntimeState } from "../runtime/LocalRuntimeState.js";
import { UpdateManager } from "../runtime/UpdateManager.js";

function verifyProject(path: string): void {
  if (
    !isAbsolute(path) || path === parse(path).root
    || relative(path, realpathSync.native(path)) !== ""
  ) {
    throw new Error(`Project folder no longer matches its registered path: ${path}`);
  }
}

function verifyStorage(project: string, root: string): string {
  const path = resolveSafePath(project, root);
  if (
    lstatSync(path, { throwIfNoEntry: false }) && relative(path, realpathSync.native(path)) !== ""
  ) {
    throw new Error(`Cannot clear chats through a linked storage directory: ${path}`);
  }
  return path;
}

function inspectProject(project: ProjectRegistryEntry, home: string) {
  const { path } = project;
  if (!project.available) return { project, stores: [] };
  verifyProject(path);
  const config = ConfigLoader.loadSync(path, undefined, { homeDir: home });
  const roots = new Set(
    [".orbit/sessions", config.session.path, ORCHESTRATED_AGENT_SESSION_PATH].map(root =>
      verifyStorage(path, root)
    ),
  );
  const stores = Array.from(roots, directory => {
    const store = new SessionStore(path, directory);
    return {
      directory,
      store,
      ids: store.listSessions({ strict: true }).map(session => session.id),
    };
  });
  return { project, stores };
}

async function askYesNo(prompt: string): Promise<boolean> {
  const terminal = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const answer = await new Promise<string>((resolve, reject) => {
      terminal.once("close", () => reject(new Error("Uninstall cancelled.")));
      terminal.once("SIGINT", () => terminal.close());
      terminal.question(prompt, resolve);
    });
    return /^(?:y|yes|是)$/i.test(answer.trim());
  } finally {
    terminal.close();
  }
}

interface UninstallDependencies {
  manager?: Pick<UpdateManager, "prepareUninstall">;
  home?: string;
  interactive?: boolean;
  language?: OrbitLanguage;
  confirm?: (prompt: string) => Promise<boolean>;
  write?: (text: string) => void;
}

/** Uninstall the running global CLI with optional cleanup of registered project chats. */
export async function runUninstall(
  rawOptions: { yes?: boolean },
  dependencies: UninstallDependencies = {},
): Promise<void> {
  const { yes } = z.object({ yes: z.boolean().optional() }).strict().parse(rawOptions);
  const home = dependencies.home ?? homedir();
  const language = dependencies.language ?? readLocalRuntimeState(process.cwd()).language
    ?? parseOrbitLanguage(process.env.ORBIT_LANGUAGE || process.env.ORBIT_LANG)
    ?? ConfigLoader.loadSync(process.cwd(), undefined, { homeDir: home }).language;
  const t = (en: string, zh: string, tw: string) => localizeOrbit(language, en, zh, tw);
  const write = dependencies.write ?? console.log;
  const confirm = dependencies.confirm ?? askYesNo;
  if (!yes && !(dependencies.interactive ?? Boolean(process.stdin.isTTY))) {
    throw new Error(
      t(
        "Run interactively to choose what to remove, or use --yes to keep all data.",
        "请在终端选择卸载范围，或使用 --yes 卸载程序并保留数据。",
        "請在終端選擇解除安裝範圍，或使用 --yes 移除程式並保留資料。",
      ),
    );
  }
  const install = (dependencies.manager ?? new UpdateManager()).prepareUninstall(
    fileURLToPath(import.meta.url),
  );
  write(t("Uninstall Orbit", "卸载 Orbit", "解除安裝 Orbit") + " · " + install.directory);
  const registry = new ProjectRegistry(join(home, ".orbit"));
  let plans: ReturnType<typeof inspectProject>[] = [];
  if (!yes) {
    const projects = registry.list({ includeArchived: true });
    if (
      projects.length && await confirm(t(
        `Also remove all ${projects.length} registered project entries and their saved chats? [y/N] `,
        `是否同时清除全部 ${projects.length} 个已登记项目的记录和聊天？[y/N] `,
        `是否一併清除全部 ${projects.length} 個已登記專案的記錄與對話？[y/N] `,
      ))
    ) {
      plans = projects.map(project => inspectProject(project, home));
      for (const { project, stores } of plans) {
        const count = stores.reduce((sum, item) => sum + item.ids.length, 0);
        const detail = project.available
          ? t(`${count} chats`, `${count} 条聊天`, `${count} 則對話`)
          : t(
            "folder unavailable; remove entry only",
            "目录不可访问，仅移除登记记录",
            "目錄無法存取，僅移除登記記錄",
          );
        write(`  ${project.path} · ${detail}`);
      }
      write(
        t(
          "Saved chats will be permanently deleted. Project files, settings and credentials are kept.",
          "聊天记录将永久删除。项目源文件、设置和凭据会保留。",
          "對話記錄將永久刪除。專案原始檔、設定和憑證會保留。",
        ),
      );
    } else {
      write(
        t(
          "Project entries and chats will be kept.",
          "将保留项目记录和聊天。",
          "將保留專案記錄與對話。",
        ),
      );
    }
    if (
      !await confirm(
        t("Proceed with uninstall? [y/N] ", "确认卸载？[y/N] ", "確認解除安裝？[y/N] "),
      )
    ) {
      write(t("Uninstall cancelled.", "已取消卸载。", "已取消解除安裝。"));
      return;
    }
  }
  install.remove();
  write(picocolors.green(t("✔ Orbit uninstalled.", "✔ Orbit 已卸载。", "✔ Orbit 已解除安裝。")));
  try {
    for (const { project, stores } of plans) {
      if (!project.available) continue;
      verifyProject(project.path);
      for (const { directory, store, ids } of stores) {
        verifyStorage(project.path, directory);
        for (const id of ids) {
          if (!store.getSession(id))
            throw new Error(`Chat changed during uninstall: ${join(directory, id)}`);
          store.deleteSession(id);
        }
        if (store.listSessions({ strict: true }).length) {
          throw new Error(`Chats changed during uninstall: ${project.path}`);
        }
      }
      const last = readLocalRuntimeState(project.path).lastSessionId;
      if (last && stores.some(({ ids }) => ids.includes(last))) {
        verifyStorage(project.path, ".orbit");
        writeLocalRuntimeState(project.path, { lastSessionId: undefined });
      }
    }
    registry.forget(plans.map(({ project }) => project.id));
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(
      t(
        "Orbit was uninstalled. Project cleanup is incomplete. ",
        "程序已卸载，项目数据尚未全部清除。",
        "程式已解除安裝，專案資料尚未全部清除。",
      ) + detail,
      { cause: error },
    );
  }
  if (plans.length)
    write(
      t(
        "✔ Removed the listed project entries and chats.",
        "✔ 已清除列出的项目记录和聊天。",
        "✔ 已清除列出的專案記錄與對話。",
      ),
    );
}
