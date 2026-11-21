const locale = navigator.language.toLowerCase();
const chinese = locale.startsWith("zh");
const traditional = chinese && /(?:hant|tw|hk|mo)(?:-|$)/.test(locale);
const t = (en, cn, tw = cn) => traditional ? tw : chinese ? cn : en;
document.documentElement.lang = traditional ? "zh-TW" : chinese ? "zh-CN" : "en";
const status = document.querySelector("#status");
const fields = document.querySelector("#fields");
const actions = document.querySelector("#actions");
const store = browser.storage.session;
const reasons = {
  chooseForm: t(
    "Click a text field in the form you want, then reopen Orbit.",
    "请点一下目标表单里的文本框，再打开 Orbit。",
    "請先點選目標表單的文字欄位，再開啟 Orbit。",
  ),
  emptyDraft: t(
    "Enter at least one value in the draft.",
    "请至少填写一项草稿内容。",
    "請至少填寫一項草稿內容。",
  ),
  invalidValue: t(
    "Check field length limits and remove line breaks from single-line fields.",
    "请检查字段长度，并去掉单行文本框里的换行，再试一次。",
    "請檢查欄位長度並移除單行欄位的換行，再試一次。",
  ),
  draft: t(
    "Your Orbit draft has text. Send or save it first.",
    "Orbit 输入框里有草稿。请先发送或保存。",
    "Orbit 輸入框裡有草稿。請先傳送或儲存。",
  ),
  empty: t(
    "No empty, visible text fields are available.",
    "没有可填写的可见空文本框。",
    "沒有可填寫的可見空白文字欄位。",
  ),
  page: t(
    "Choose a normal HTTPS page or a local test page.",
    "请选择 HTTPS 网页或本地测试页。",
    "請選擇 HTTPS 網頁或本機測試頁。",
  ),
  workspace: t(
    "Connect your signed-in Orbit workspace first.",
    "请先在已连接的 Orbit 工作区打开扩展并连接。",
    "請先在 Orbit 工作區開啟延伸功能並連線。",
  ),
  reply: t(
    "Send the request in Orbit and wait for its completed JSON reply.",
    "请在 Orbit 发送请求，等它回复完整的 JSON 草稿。",
    "請在 Orbit 傳送請求，等待完整的 JSON 草稿。",
  ),
  stale: t(
    "The tab or form changed. Start a new handoff.",
    "标签页或表单已变化，请重新交给 Orbit。",
    "分頁或表單已變更，請重新交給 Orbit。",
  ),
  chatChanged: t(
    "The Orbit chat changed. Reopen Orbit here to choose the current draft.",
    "Orbit 对话已切换。请重新打开此扩展，核对草稿去向。",
    "Orbit 對話已切換。請重新開啟延伸功能，核對草稿去向。",
  ),
  access: t(
    "Safari could not access this tab. Check the extension permission and reopen it.",
    "Safari 无法访问此标签页。请检查扩展权限并重新打开。",
    "Safari 無法存取此分頁。請檢查延伸功能權限並重新開啟。",
  ),
};

function button(label, fn) {
  const el = document.createElement("button");
  el.textContent = label;
  actions.append(el);
  el.onclick = async () => {
    const buttons = Array.from(actions.querySelectorAll("button"));
    buttons.forEach(b => b.disabled = true);
    try {
      await fn();
    } catch (error) {
      status.textContent = reasons[error.message] || reasons.access;
    } finally {
      buttons.forEach(b => b.disabled = false);
    }
  };
}

async function message(target, action, extra = {}) {
  let response;
  try {
    response = await browser.tabs.sendMessage(
      target.tabId,
      { channel: "orbit-safari", action, documentId: target.documentId, ...extra },
      { frameId: 0 },
    );
  } catch {
    throw Error("stale");
  }
  if (!response?.ok) throw Error(response?.reason || "stale");
  return response.data;
}

async function focusTab(id) {
  const tab = await browser.tabs.update(id, { active: true });
  await browser.windows.update(tab.windowId, { focused: true });
  window.close();
}

async function main() {
  fields.replaceChildren();
  actions.replaceChildren();
  const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
  if (!tab || tab.incognito) throw Error("page");
  const url = new URL(tab.url);
  if (
    url.protocol !== "https:"
    && !(url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname))
  ) throw Error("page");
  await browser.scripting.executeScript({ target: { tabId: tab.id }, files: ["page.js"] });
  const info = await message({ tabId: tab.id }, "identify");
  const here = { tabId: tab.id, documentId: info.documentId };
  const route = document.querySelector("#route");
  const { workspace, task } = await store.get(["workspace", "task"]);
  let target = info;
  if (!info.workspace && workspace) {
    target = await message(workspace, "identify");
    if (!target.workspace || target.documentId !== workspace.documentId) throw Error("stale");
  }
  const targetName = target.workspaceName || workspace?.name
    || t("Orbit workspace", "Orbit 工作区", "Orbit 工作區");
  const destination = [targetName, target.chatName].filter(Boolean).join(" / ");
  route.hidden = !info.workspace && !workspace;
  route.textContent = info.workspace ? destination : url.host + " → " + destination;
  const live = task && Date.now() < task.expires;
  if (task && !live) await store.remove("task");
  if (info.workspace) {
    if (workspace?.documentId !== here.documentId || workspace.tabId !== tab.id) {
      status.textContent = t(
        "Use this Orbit workspace for Safari drafts?",
        "将 Safari 选文和表单草稿送到这个工作区？",
        "將 Safari 選文和表單草稿送到這個工作區？",
      );
      button(t("Connect this workspace", "连接这个工作区", "連線至這個工作區"), async () => {
        await store.remove("task");
        await store.set({ workspace: { ...here, name: targetName } });
        await main();
      });
    } else {
      status.textContent = t(
        "Connected. Open Orbit in the Safari toolbar on the website you want to share.",
        "已连接。在要分享的网页上点 Safari 工具栏里的 Orbit。",
        "已連線。在要分享的網頁上點選 Safari 工具列裡的 Orbit。",
      );
      if (live)
        button(t("Return to the form", "返回表单", "返回表單"), () => focusTab(task.source.tabId));
      button(t("Disconnect", "断开连接", "中斷連線"), async () => {
        await store.remove(["workspace", "task"]);
        await main();
      });
    }
    return;
  }
  if (!workspace) throw Error("workspace");
  async function openPreparedDraft() {
    // A Safari window can disappear between preparing a draft and activating its tab.
    // Offer navigation again without appending the same excerpt a second time.
    actions.replaceChildren();
    status.textContent = t(
      "Draft ready in Orbit.",
      "草稿已在 Orbit 中准备好。",
      "草稿已在 Orbit 中準備好。",
    );
    button(t("Return to Orbit", "返回 Orbit"), () => focusTab(workspace.tabId));
    await focusTab(workspace.tabId);
  }
  button(
    t(
      "Ask about this page or selection",
      "把网页或选中文字交给 Orbit",
      "將網頁或選取文字交給 Orbit",
    ),
    async () => {
      const excerpt = await message(here, "pageExcerpt");
      try {
        await message(workspace, "draftQuestion", { excerpt, draftTarget: target.draftTarget });
      } catch (error) {
        if (error.message !== "draft") throw error;
        actions.replaceChildren();
        status.textContent = t(
          "There is already a draft in Orbit. Add this page at the end?",
          "Orbit 里已有草稿。要把网页内容追加到末尾吗？",
          "Orbit 裡已有草稿。要把網頁內容附加到結尾嗎？",
        );
        button(t("Add to existing draft", "追加到现有草稿", "附加至現有草稿"), async () => {
          await message(workspace, "draftQuestion", {
            excerpt,
            append: true,
            draftTarget: target.draftTarget,
          });
          await openPreparedDraft();
        });
        button(t("Cancel", "取消"), main);
        actions.querySelector("button").focus();
        return;
      }
      await openPreparedDraft();
    },
  );
  if (live && task.source.tabId === here.tabId && task.source.documentId === here.documentId) {
    status.textContent = t(
      "Review each suggestion here. You submit the form on the website.",
      "在这里核对建议值。最后由你在网页上提交。",
      "在這裡核對建議值，最後由你在網頁上送出。",
    );
    button(t("Review Orbit’s draft", "查看 Orbit 草稿", "檢視 Orbit 草稿"), async () => {
      const values = await message(workspace, "proposal", {
        key: task.key,
        length: task.labels.length,
      });
      actions.replaceChildren();
      fields.replaceChildren();
      const inputs = task.labels.map((name, i) => {
        const label = document.createElement("label");
        label.textContent = name;
        const input = document.createElement("textarea");
        input.maxLength = 2000;
        input.value = values[i];
        label.append(input);
        fields.append(label);
        return input;
      });
      button(t("Fill reviewed values", "填入已核对的内容", "填入已核對的內容"), async () => {
        const current = (await store.get("task")).task;
        if (current?.key !== task.key) throw Error("stale");
        const result = await message(here, "apply", {
          key: task.key,
          values: inputs.map(el => el.value),
        });
        await store.remove("task");
        actions.replaceChildren();
        fields.replaceChildren();
        status.textContent = t(
          `Filled ${result.count} of ${result.total}. Review the page before submitting.`,
          `已填入 ${result.count}/${result.total} 项，请在网页上核对并提交。`,
          `已填入 ${result.count}/${result.total} 項，請在網頁上核對並送出。`,
        );
      });
      button(t("Cancel", "取消"), main);
    });
    button(t("Return to Orbit", "返回 Orbit"), () => focusTab(workspace.tabId));
    button(t("End this handoff", "结束这次协作", "結束這次交接"), async () => {
      await store.remove("task");
      await main();
    });
    return;
  }
  status.textContent = t(
    "Share this page and any selected text, or prepare a form. Review the draft in Orbit before sending.",
    "分享当前网页和选中文字，或起草表单。在 Orbit 里核对草稿后再发送。",
    "分享目前網頁與選取文字，或起草表單。在 Orbit 核對草稿後再傳送。",
  );
  if (live)
    status.textContent += t(
      " Starting another form replaces the previous form handoff.",
      " 开始新表单会替换上一次表单协作。",
      " 開始新表單會取代上一次表單交接。",
    );
  button(t("Hand to Orbit", "交给 Orbit", "交給 Orbit"), async () => {
    const key = crypto.randomUUID();
    const { site, labels } = await message(here, "start", { key });
    await message(workspace, "prepare", { key, site, labels, draftTarget: target.draftTarget });
    await store.set({ task: { source: here, labels, key, expires: Date.now() + 10 * 60_000 } });
    await focusTab(workspace.tabId);
  });
}

main().catch(error => {
  status.textContent = reasons[error.message] || reasons.access;
});
