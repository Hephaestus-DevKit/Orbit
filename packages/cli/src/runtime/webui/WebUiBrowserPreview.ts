import { supportsOrbitBrowser } from "./WebUiBrowserLauncher.js";
import { renderUiIcon, type UiIcon } from "./WebUiIcon.js";
import type { WebUiLanguage } from "./WebUiPage.js";

/** Render an idle address bar. The first website request requires a user navigation. */
export function renderBrowserPreview(language: WebUiLanguage): string {
  const t = (en: string, zh: string, tw: string) =>
    language === "en" ? en : language === "zh-TW" ? tw : zh;
  const tool = (id: string, icon: UiIcon, label: string) =>
    `<button type="button" class="browser-tool" id="${id}" aria-label="${label}" title="${label}" disabled>${
      renderUiIcon(icon)
    }</button>`;
  const address = t("Website address", "网页地址", "網頁位址");
  return `<section class="safari-workspace" id="browserPreviewPanel" role="tabpanel" aria-labelledby="browserTab" hidden>
    <div class="browser-navigation">
      <div class="browser-history">
        ${
          tool(
            "browserBack",
            "back",
            t("Previous entered address", "上一个输入的地址", "上一個輸入的位址"),
          )
        }
        ${
          tool(
            "browserForward",
            "forward",
            t("Next entered address", "下一个输入的地址", "下一個輸入的位址"),
          )
        }
        ${
          tool(
            "browserReload",
            "restore",
            t("Reload entered address", "重新载入输入的地址", "重新載入輸入的位址"),
          )
        }
      </div>
      <form class="browser-address" id="browserAddressForm" aria-label="${address}">
        <input id="browserAddress" type="text" inputmode="url" enterkeyhint="go" autocomplete="off" autocapitalize="off" spellcheck="false" maxlength="8192" aria-label="${address}" placeholder="${
          t("Enter a website address", "输入网页地址", "輸入網頁位址")
        }">
        <button type="submit">${t("Go", "前往", "前往")}</button>
      </form>
    </div>
    <div id="orbitBrowserLaunchRow" class="browser-launch" data-local="${supportsOrbitBrowser()}" hidden><button class="secondary-button" id="orbitBrowserLaunch" type="button" data-error="${
      t(
        "Orbit Browser could not open. Check that the macOS browser is included in your Orbit installation.",
        "无法打开 Orbit 浏览器，请检查安装包是否包含 macOS 浏览器。",
        "無法開啟 Orbit 瀏覽器，請檢查安裝套件是否包含 macOS 瀏覽器。",
      )
    }">${renderUiIcon("compass")} ${
      t("Open Orbit Browser", "打开 Orbit 浏览器", "開啟 Orbit 瀏覽器")
    }</button></div>
    <p id="browserAddressError" class="browser-error" role="alert" hidden data-invalid="${
      t(
        "Enter an HTTPS website or a local development address.",
        "请输入 HTTPS 网址或本地开发地址。",
        "請輸入 HTTPS 網址或本機開發位址。",
      )
    }" data-private="${
      t(
        "Choose a website without sign-in credentials or an Orbit access link.",
        "请选择普通网页地址，并移除登录凭据或 Orbit 访问链接。",
        "請選擇一般網頁位址，並移除登入憑證或 Orbit 存取連結。",
      )
    }" data-local="${
      t(
        "For a local preview, open Orbit using its 127.0.0.1 link and choose a different port.",
        "预览本地网页时，请用 127.0.0.1 链接打开 Orbit，并为网页选择其他端口。",
        "預覽本機網頁時，請用 127.0.0.1 連結開啟 Orbit，並為網頁選擇其他連接埠。",
      )
    }" data-chat="${
      t(
        "Wait for the current chat to connect, then try again.",
        "请等当前对话连接后重试。",
        "請等目前對話連線後重試。",
      )
    }"></p>
    <div class="browser-start" id="browserStart">
      <div class="browser-intro">
        <span class="browser-mark">${renderUiIcon("compass")}</span>
        <h2>${t("Open a webpage", "打开网页", "開啟網頁")}</h2>
        <p>${
          t(
            "Enter a website or localhost address above to browse alongside your chat.",
            "在上方输入网址或 localhost 地址，即可边看网页边聊天。",
            "在上方輸入網址或 localhost 位址，即可邊看網頁邊聊天。",
          )
        }</p>
        <details><summary>${
          t("Use the Safari extension", "使用 Safari 扩展", "使用 Safari 延伸功能")
        }</summary>
          <p>${
            t(
              "Orbit for Safari lets you share selected text and review form drafts on the original website. Find the extension with this command, add it in Safari Settings → Developer, then connect this workspace from the toolbar.",
              "Orbit for Safari 可以分享选中文字和核对表单草稿。运行下方命令找到扩展，在 Safari 设置 → 开发者中添加临时扩展，再从工具栏连接这个工作区。",
              "Orbit for Safari 可分享選取文字並核對表單草稿。執行下方指令找到延伸功能，在 Safari 設定 → 開發者中加入暫用延伸功能，再從工具列連接此工作區。",
            )
          }</p>
          <code>orbit webui --safari-extension-path</code>
        </details>
      </div>
    </div>
    <div id="browserViewport" class="browser-viewport" data-title="${
      t("Website preview", "网页预览", "網頁預覽")
    }" hidden></div>
    <footer class="browser-footer" id="browserPageActions" hidden>
      <p>${
        t("Page blank or sign-in required?", "页面空白或需要登录？", "頁面空白或需要登入？")
      } <a id="browserExternal" target="_blank" rel="noopener noreferrer" referrerpolicy="no-referrer">${
        t("Open in Safari", "在 Safari 中打开", "在 Safari 中開啟")
      }${renderUiIcon("external")}</a></p>
      <div><button type="button" id="browserShare">${renderUiIcon("chat")}${
        t("Add address to draft", "追加地址到草稿", "附加位址至草稿")
      }</button>
      <button type="button" id="browserClear">${
        t("Close page", "关闭网页", "關閉網頁")
      }</button></div>
    </footer>
  </section>`;
}
