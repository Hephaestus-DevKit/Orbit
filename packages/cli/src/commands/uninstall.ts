import { lstatSync, readdirSync, realpathSync } from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, join, parse, relative, resolve } from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import picocolors from "picocolors";
import { z } from "zod";
import {
  ConfigLoader,
  CredentialsManager,
  localizeOrbit,
  type OrbitLanguage,
  parseOrbitLanguage,
} from "@orbit-build/config";
import { ORCHESTRATED_AGENT_SESSION_PATH } from "@orbit-build/core";
import { checkWorkspaceBoundary, resolveSafePath } from "@orbit-build/shared";
import { ProjectRegistry, type ProjectRegistryEntry, SessionStore } from "@orbit-build/session";
import { buildCleanupPlan, executeCleanupPlan } from "../runtime/CleanupManager.js";
import { clearWebUiStorage } from "../runtime/webui/WebUiStorageCleanup.js";
import { readLocalRuntimeState } from "../runtime/LocalRuntimeState.js";
import { UpdateManager } from "../runtime/UpdateManager.js";
import { pageText } from "../tui/TextPager.js";
import { hasLiveLocalDaemon } from "./daemon.js";

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

function verifyDataRoot(path: string): void {
  verifyProject(path);
  const data = join(path, ".orbit");
  if (lstatSync(data, { throwIfNoEntry: false })?.isSymbolicLink()) {
    throw new Error(
      `Orbit data directory is a symbolic link. Check its destination before uninstalling: ${data}`,
    );
  }
  const daemon = join(data, "daemon");
  if (lstatSync(daemon, { throwIfNoEntry: false })?.isDirectory() && hasLiveLocalDaemon(daemon)) {
    throw new Error(`Stop the running Orbit daemon before clearing its data: ${daemon}`);
  }
  const worktrees = join(data, "worktrees");
  if (lstatSync(worktrees, { throwIfNoEntry: false })?.isDirectory()) {
    for (const child of readdirSync(worktrees, { withFileTypes: true })) {
      const tree = join(worktrees, child.name);
      if (child.isDirectory() && lstatSync(join(tree, ".git"), { throwIfNoEntry: false }))
        throw new Error(`Finish or move the Git worktree before removing Orbit data: ${tree}`);
    }
  }
}

function browserPorts(path: string): number[] {
  const state = readLocalRuntimeState(path);
  return [...new Set([...(state.webUiPorts ?? []), ...(state.webUiPort ? [state.webUiPort] : [])])]
    .sort((a, b) => a - b);
}

function inspectData(path: string, home: string, registered: boolean) {
  verifyDataRoot(path);
  const directory = join(path, ".orbit");
  const cleanup = buildCleanupPlan({
    cwd: path,
    homeDirectory: home,
    scopes: [path === home ? "user" : "project"],
  });
  const warning = cleanup.targets[0]?.warnings[0];
  if (warning) throw new Error(`Cannot inventory Orbit data: ${warning}`);
  const ports = browserPorts(path);
  const configured = registered
    ? resolve(path, ConfigLoader.loadSync(path, undefined, { homeDir: home }).session.path)
    : directory;
  let custom;
  if (!checkWorkspaceBoundary(directory, configured)) {
    verifyStorage(path, configured);
    const store = new SessionStore(path, configured);
    custom = {
      directory: configured,
      store,
      ids: store.listSessions({ strict: true }).map(chat => chat.id).sort(),
    };
  }
  const managedStores = new Map<string, string | undefined>();
  for (const storePath of new Set([
    join(directory, "sessions"),
    join(path, ORCHESTRATED_AGENT_SESSION_PATH),
    ...(registered && !custom ? [configured] : []),
  ])) {
    managedStores.set(storePath, directoryStamp(storePath));
  }
  return { path, cleanup, ports, custom, managedStores };
}

function directoryStamp(path: string): string | undefined {
  const stat = lstatSync(path, { throwIfNoEntry: false, bigint: true });
  return stat && `${stat.dev}/${stat.ino}/${stat.mtimeNs}`;
}

function registeredPaths(projects: ProjectRegistryEntry[]): string {
  return JSON.stringify(
    projects.map(({ path, available }) => JSON.stringify([path, available])).sort(),
  );
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
  purgeUserCredentials?: (directory: string) => void;
  clearBrowserStorage?: (ports: number[]) => Promise<void>;
  manager?: Pick<UpdateManager, "prepareUninstall">;
  home?: string;
  interactive?: boolean;
  language?: OrbitLanguage;
  confirm?: (prompt: string) => Promise<boolean>;
  write?: (text: string) => void;
}

/** Uninstall the running global CLI with optional erasure of all managed local data. */
export async function runUninstall(
  rawOptions: { yes?: boolean },
  dependencies: UninstallDependencies = {},
): Promise<void> {
  const { yes } = z.object({ yes: z.boolean().optional() }).strict().parse(rawOptions);
  const home = realpathSync.native(dependencies.home ?? homedir());
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
  let plans: ReturnType<typeof inspectData>[] = [];
  let projects: ProjectRegistryEntry[] = [];
  let ports: number[] = [];
  if (!yes) {
    if (
      await confirm(t(
        "Permanently erase your Orbit settings, credentials, and all registered projects’ Orbit data and chats? [y/N] ",
        "是否彻底清除 Orbit 的设置、凭据及所有已登记项目的 Orbit 数据和聊天记录？[y/N] ",
        "是否徹底清除 Orbit 的設定、憑證及所有已登記專案的 Orbit 資料與對話記錄？[y/N] ",
      ))
    ) {
      verifyDataRoot(home);
      projects = registry.list({ includeArchived: true, strict: true });
      const available = new Set(projects.filter(item => item.available).map(item => item.path));
      const roots = [...available].filter(path => path !== home);
      plans = [...roots, home].map(path => inspectData(path, home, available.has(path)));
      for (const { path, custom } of plans) {
        const directories = [
          join(path, ".orbit"),
          ...(custom?.ids.map(id => join(custom.directory, id)) ?? []),
        ];
        for (const directory of directories) {
          const nested = projects.find(project => checkWorkspaceBoundary(directory, project.path));
          if (nested)
            throw new Error(
              `Move the registered project out of the Orbit cleanup directory before uninstalling: ${nested.path}`,
            );
        }
      }
      write(
        t(
          "Orbit will permanently remove the contents of these folders, including backups and custom skills:",
          "以下目录的全部内容将永久删除，包括备份和自定义技能：",
          "以下目錄的全部內容將永久刪除，包括備份和自訂技能：",
        ),
      );
      const paths: string[] = [];
      for (const { cleanup, custom } of plans) {
        paths.push(`  ${cleanup.targets[0]!.path}`);
        if (custom)
          paths.push(
            `  ${custom.directory} · ${custom.ids.length} ${
              t("Orbit chats", "条 Orbit 聊天", "則 Orbit 對話")
            }`,
          );
      }
      for (const project of projects.filter(item => !item.available)) {
        paths.push(
          picocolors.yellow(
            `  ${project.path} · ${
              t(
                "folder unavailable; only its registration can be removed",
                "目录不可访问，只能清除登记记录",
                "目錄無法存取，只能清除登記記錄",
              )
            }`,
          ),
        );
      }
      if (dependencies.write) write(paths.join("\n"));
      else if (await pageText(paths.join("\n")) !== "completed") {
        write(t("Uninstall cancelled.", "已取消卸载。", "已取消解除安裝。"));
        return;
      }
      ports = [...new Set(plans.flatMap(plan => plan.ports))];
      write(
        t(
          "The Orbit credential key will also be deleted. Project source files are kept.",
          "同时删除 Orbit 的凭据密钥。项目源文件会保留。",
          "同時刪除 Orbit 的憑證金鑰。專案原始檔會保留。",
        ),
      );
      if (ports.length)
        write(
          t(
            process.platform === "darwin"
              ? "Close running Orbit Web UIs and their tabs. Safari will open to clear Orbit drafts and preferences on the listed ports."
              : "Close Orbit tabs and remove Orbit drafts and preferences in the browser for these ports.",
            process.platform === "darwin"
              ? "请关闭正在运行的 Orbit 网页服务和标签页。Safari 将打开清理页，清除以下端口的 Orbit 草稿和偏好。"
              : "请关闭 Orbit 标签页，在浏览器中清除以下端口的 Orbit 草稿和偏好。",
            process.platform === "darwin"
              ? "請關閉執行中的 Orbit 網頁服務與分頁。Safari 將開啟清理頁，清除以下連接埠的 Orbit 草稿與偏好。"
              : "請關閉 Orbit 分頁，在瀏覽器中清除以下連接埠的 Orbit 草稿與偏好。",
          ) + " " + ports.join(", "),
        );
    } else {
      write(
        t("All Orbit data will be kept.", "将保留全部 Orbit 数据。", "將保留全部 Orbit 資料。"),
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
  const verifyInventory = () => {
    verifyDataRoot(home);
    if (
      registeredPaths(projects)
      !== registeredPaths(registry.list({ includeArchived: true, strict: true }))
    )
      throw new Error(
        "Registered projects changed during uninstall. Review the new scope before retrying.",
      );
    for (const { path, custom, managedStores, ports: approvedPorts } of plans) {
      verifyDataRoot(path);
      if (JSON.stringify(browserPorts(path)) !== JSON.stringify(approvedPorts))
        throw new Error(`Web UI addresses changed during uninstall: ${path}`);
      for (const [directory, stamp] of managedStores) {
        if (directoryStamp(directory) !== stamp)
          throw new Error(`Chats changed during uninstall: ${directory}`);
      }
      if (custom) {
        verifyStorage(path, custom.directory);
        const ids = custom.store.listSessions({ strict: true }).map(chat => chat.id).sort();
        if (JSON.stringify(ids) !== JSON.stringify(custom.ids))
          throw new Error(`Chats changed during uninstall: ${custom.directory}`);
      }
    }
  };
  if (plans.length) {
    verifyInventory();
    if (ports.length && process.platform === "darwin") {
      await (dependencies.clearBrowserStorage ?? clearWebUiStorage)(ports);
      verifyInventory();
    }
  }
  install.remove();
  write(picocolors.green(t("✔ Orbit uninstalled.", "✔ Orbit 已卸载。", "✔ Orbit 已解除安裝。")));
  if (!plans.length) return;
  try {
    verifyInventory();
    const purge = dependencies.purgeUserCredentials
      ?? (orbitDir => new CredentialsManager({ orbitDir }).purge());
    purge(join(home, ".orbit"));
    const processedStores = new Set<string>();
    for (const { path, custom } of plans) {
      verifyDataRoot(path);
      if (custom && !processedStores.has(custom.directory)) {
        processedStores.add(custom.directory);
        verifyStorage(path, custom.directory);
        for (const id of custom.ids) {
          if (!custom.store.getSession(id))
            throw new Error(`Chat changed during uninstall: ${join(custom.directory, id)}`);
          custom.store.deleteSession(id);
        }
        if (custom.store.listSessions({ strict: true }).length)
          throw new Error(`Chats changed during uninstall: ${custom.directory}`);
      }
    }
    for (const { path, cleanup } of plans) {
      verifyDataRoot(path);
      if (
        path === home
        && registeredPaths(projects)
          !== registeredPaths(registry.list({ includeArchived: true, strict: true }))
      )
        throw new Error("The project registry changed before it could be cleared.");
      executeCleanupPlan(cleanup);
    }
    for (const { path } of plans) {
      if (lstatSync(join(path, ".orbit"), { throwIfNoEntry: false }))
        throw new Error(`Orbit data was recreated: ${path}`);
    }
  } catch (error) {
    throw new Error(
      t(
        "Orbit was uninstalled. Local data cleanup is incomplete. Reinstall Orbit and retry after resolving the error below. ",
        "程序已卸载，本地数据尚未全部清除。解决以下问题后，可重新安装 Orbit 并再次运行卸载命令。",
        "程式已解除安裝，本機資料尚未全部清除。解決以下問題後，可重新安裝 Orbit 並再次執行解除安裝指令。",
      )
        + (error instanceof Error ? error.message : String(error)),
      { cause: error },
    );
  }
  write(
    picocolors.green(
      t(
        "✔ Cleared the listed local Orbit data and credentials.",
        "✔ 已清除列出的可访问目录中的 Orbit 数据及本机凭据。",
        "✔ 已清除所列可存取目錄中的 Orbit 資料及本機憑證。",
      ),
    ),
  );
}
