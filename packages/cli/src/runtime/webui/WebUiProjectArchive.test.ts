import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ProjectRegistry, SessionStore } from "@orbit-build/session";
import { DEFAULT_CONFIG } from "@orbit-build/config";
import { describe, expect, it } from "../../../../../scripts/testing/support.mjs";
import { handleWebUiProjectAction } from "../ProjectLauncher.js";
import { RunCoordinator } from "../RunCoordinator.js";
import { collectWebUiStatus } from "./WebUiData.js";
import { archiveBlocksRequest } from "./WebUiProjectState.js";
import { projectArchiveMarkup } from "./WebUiProjectArchive.js";

describe("project and chat archive", () => {
  it("keeps the archive across re-registration, preserves source and restores individual chat states", async () => {
    const root = mkdtempSync(join(tmpdir(), "orbit-project-archive-"));
    try {
      const cwd = join(root, "fixture");
      mkdirSync(cwd);
      writeFileSync(join(cwd, "source.js"), "example");
      const registryRoot = join(root, "registry");
      const registry = new ProjectRegistry(registryRoot);
      const { id } = registry.register(cwd);
      const store = new SessionStore(cwd, ".custom-chats");
      const active = store.createSession("test", "test");
      const older = store.createSession("test", "test");
      store.updateSession({ ...older, archivedAt: older.createdAt });
      const options = {
        cwd,
        port: 0,
        config: DEFAULT_CONFIG,
        getProjects: () => new ProjectRegistry(registryRoot).list({ includeArchived: true }),
        loop: { getSessionId: () => active.id, getSessions: () => store.listSessions() },
      };
      const status = () => collectWebUiStatus(options, undefined);
      const coordinator = new RunCoordinator();
      const change = (action: "remove" | "restore") =>
        handleWebUiProjectAction({ action, projectId: id }, coordinator, registry);
      expect((await change("remove")).ok).toBe(true);
      new ProjectRegistry(registryRoot).register(cwd);
      expect(status().session.recent).toHaveLength(0);
      expect(status().session.archived.map(s => s.id).sort()).toEqual([active.id, older.id].sort());
      expect(archiveBlocksRequest("POST", "/api/chat", options)).toBe(true);
      expect(archiveBlocksRequest("POST", "/api/project", options)).toBe(false);
      expect((await change("restore")).ok).toBe(true);
      expect(status().session.recent[0].id).toBe(active.id);
      expect(status().session.archived[0].id).toBe(older.id);
      expect(archiveBlocksRequest("POST", "/api/chat", options)).toBe(false);
      expect(readFileSync(join(cwd, "source.js"), "utf8")).toBe("example");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("provides a cancel-first, named confirmation in each interface language", () => {
    for (const language of ["en", "zh", "zh-TW"] as const) {
      const { dialog } = projectArchiveMarkup(language);
      expect(dialog).toContain('value="cancel" autofocus');
      expect(dialog).toContain('id="projectArchivePath"');
      expect(dialog).toContain('id="projectArchiveScope"');
    }
  });
});
