import { loadOrbitExtensionManifest, type OrbitExtensionManifest } from "@orbit-build/config";
import picocolors from "picocolors";
import { ExtensionManager } from "../runtime/ExtensionManager.js";

export function validateExtension(
  cwd: string,
  manifestPath: string,
  options: { json?: boolean } = {},
): OrbitExtensionManifest {
  const manifest = loadOrbitExtensionManifest(cwd, manifestPath);
  if (options.json) {
    console.log(JSON.stringify(manifest, null, 2));
    return manifest;
  }
  const contributionCount = Object.values(manifest.contributes).reduce(
    (total, contribution) =>
      total
      + (Array.isArray(contribution)
        ? contribution.length
        : Object.keys(contribution).length),
    0,
  );
  console.log(
    picocolors.green(
      `✔ Extension manifest is valid: ${manifest.displayName} ${manifest.version}`,
    ),
  );
  console.log(
    picocolors.gray(
      `  ${manifest.id} · ${contributionCount} contribution(s) · process=${manifest.permissions.process}`,
    ),
  );
  return manifest;
}

export function installExtension(
  cwd: string,
  manifestPath: string,
  options: { trust?: boolean } = {},
): void {
  const installed = new ExtensionManager().install(cwd, manifestPath, options);
  console.log(
    picocolors.green(
      `✔ Installed extension: ${installed.displayName} ${installed.version}`,
    ),
  );
  console.log(
    picocolors.gray(
      `  ${installed.id} · sha256:${installed.digest.slice(0, 16)}…`,
    ),
  );
}

export function listExtensions(options: { json?: boolean } = {}): void {
  const extensions = new ExtensionManager().list();
  if (options.json) {
    console.log(JSON.stringify({ schemaVersion: 1, extensions }, null, 2));
    return;
  }
  if (!extensions.length) {
    console.log(picocolors.gray("No Orbit extensions are installed."));
    return;
  }
  for (const extension of extensions) {
    console.log(
      `${picocolors.green("●")} ${extension.displayName} ${extension.version} ${
        picocolors.gray(`(${extension.id})`)
      }`,
    );
  }
}

export function removeExtension(id: string): void {
  const removed = new ExtensionManager().remove(id);
  console.log(
    removed
      ? picocolors.green(`✔ Removed extension: ${id}`)
      : picocolors.yellow(`Extension is not installed: ${id}`),
  );
}
