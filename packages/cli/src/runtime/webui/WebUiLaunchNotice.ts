import picocolors from "picocolors";

/** Prepare terminal launch feedback while keeping the token out of visible text and events. */
export function createWebUiLaunchNotice(url: string, isZh: boolean) {
  const displayUrl = new URL(url);
  displayUrl.hash = "";
  const status = isZh ? "✔ Orbit Web UI 已启动" : "✔ Orbit Web UI started";
  return {
    status: picocolors.green(status),
    actionLink: { label: displayUrl.href, url },
    terminalLine: [
      picocolors.green("✔"),
      `\u001b]8;;${url}\u0007${picocolors.cyan(displayUrl.href)}\u001b]8;;\u0007`,
      picocolors.dim("·"),
      picocolors.green(status.substring(1).trim()),
    ].join(" "),
    eventMessage: `${status}: ${displayUrl.href}`,
  };
}
