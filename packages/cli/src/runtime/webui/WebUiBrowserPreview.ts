import type { WebUiLanguage } from "./WebUiPage.js";

/** Guide the user through the Safari extension without requesting website access. */
export function renderBrowserPreview(language: WebUiLanguage): string {
  const t = (en: string, zh: string, tw: string) =>
    language === "en" ? en : language === "zh-TW" ? tw : zh;
  return `<section class="safari-workspace" id="browserPreviewPanel" role="tabpanel" aria-labelledby="browserTab" hidden>
    <h2>Orbit for Safari</h2>
    <p>${
      t(
        "Open Orbit in the Safari toolbar and connect this workspace.",
        "在 Safari 工具栏打开 Orbit，连接这个工作区。",
        "在 Safari 工具列開啟 Orbit，連接這個工作區。",
      )
    }</p>
    <p>${
      t(
        "On a website, use the toolbar to ask about a page or selected text, or review a form draft before filling it.",
        "在网页上点工具栏里的 Orbit，可以把网页或选中文字带到聊天，也可以核对草稿后回填表单。",
        "在網頁上點工具列裡的 Orbit，可以把網頁或選取文字帶到聊天，也可以核對草稿後回填表單。",
      )
    }</p>
    <details><summary>${
      t("Set up the extension on macOS", "在 macOS 上设置扩展", "在 macOS 上設定延伸功能")
    }</summary>
    <p>${
      t(
        "Find the extension folder with this command, then choose Add Temporary Extension in Safari Settings → Developer.",
        "用下面的命令找到扩展文件夹，再到 Safari 设置 → 开发者中选取「添加临时扩展」。",
        "用下面的指令找到延伸功能資料夾，再到 Safari 設定 → 開發者中選取「加入暫用延伸功能」。",
      )
    }</p>
    <code>orbit webui --safari-extension-path</code></details></section>`;
}
