const zh = navigator.language.toLowerCase().startsWith("zh");
const t = (en, cn) => zh ? cn : en;
document.documentElement.lang = zh ? "zh-CN" : "en";
const status = document.querySelector("#status");
const fields = document.querySelector("#fields");
const actions = document.querySelector("#actions");
const store = browser.storage.session;
const reasons = {
  draft: t(
    "Your Orbit draft has text. Send or save it first.",
    "Orbit 输入框里有草稿。请先发送或保存。",
  ),
  empty: t("No empty, visible text fields are available.", "没有可填写的可见空文本框。"),
  page: t("Choose a normal HTTPS page or a local test page.", "请选择 HTTPS 网页或本地测试页。"),
  workspace: t(
    "Connect your signed-in Orbit workspace first.",
    "请先在已连接的 Orbit 工作区打开扩展并连接。",
  ),
  reply: t(
    "Send the request in Orbit and wait for its completed JSON reply.",
    "请在 Orbit 发送请求，等它回复完整的 JSON 草稿。",
  ),
  stale: t(
    "The tab or form changed. Start a new handoff.",
    "标签页或表单已变化，请重新交给 Orbit。",
  ),
  access: t(
    "Safari could not access this tab. Check the extension permission and reopen it.",
    "Safari 无法访问此标签页。请检查扩展权限并重新打开。",
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
  const { workspace, task } = await store.get(["workspace", "task"]);
  const live = task && Date.now() < task.expires;
  if (task && !live) await store.remove("task");
  if (info.workspace) {
    if (workspace?.documentId !== here.documentId || workspace.tabId !== tab.id) {
      status.textContent = t(
        "Use this Orbit workspace for Safari drafts?",
        "用这个 Orbit 工作区起草 Safari 表单？",
      );
      button(t("Connect this workspace", "连接这个工作区"), async () => {
        await store.remove("task");
        await store.set({ workspace: here });
        await main();
      });
    } else {
      status.textContent = t(
        "Connected. Open Orbit in the toolbar on the form you want to fill.",
        "已连接。在要填写的网页上点 Safari 工具栏里的 Orbit。",
      );
      if (live) button(t("Return to the form", "返回表单"), () => focusTab(task.source.tabId));
      button(t("Disconnect", "断开连接"), async () => {
        await store.remove(["workspace", "task"]);
        await main();
      });
    }
    return;
  }
  if (!workspace) throw Error("workspace");
  if (live && task.source.tabId === here.tabId && task.source.documentId === here.documentId) {
    status.textContent = t(
      "Review each suggestion here. You submit the form on the website.",
      "在这里核对建议值。最后由你在网页上提交。",
    );
    button(t("Review Orbit’s draft", "查看 Orbit 草稿"), async () => {
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
      button(t("Fill reviewed values", "填入已核对的内容"), async () => {
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
        );
      });
      button(t("Cancel", "取消"), main);
    });
    button(t("Return to Orbit", "返回 Orbit"), () => focusTab(workspace.tabId));
    button(t("End this handoff", "结束这次协作"), async () => {
      await store.remove("task");
      await main();
    });
    return;
  }
  status.textContent = t(
    "Send the site address and empty field labels to an Orbit draft. You can add instructions before sending.",
    "把网站地址和空文本框的字段名放进 Orbit 草稿。你可以补充要求，再发送。",
  );
  if (live)
    status.textContent += t(
      " This replaces the previous form handoff.",
      " 这会替换上一次表单协作。",
    );
  button(t("Hand to Orbit", "交给 Orbit"), async () => {
    const key = crypto.randomUUID();
    const { site, labels } = await message(here, "start", { key });
    await message(workspace, "prepare", { key, site, labels });
    await store.set({ task: { source: here, labels, key, expires: Date.now() + 10 * 60_000 } });
    await focusTab(workspace.tabId);
  });
}

main().catch(error => {
  status.textContent = reasons[error.message] || reasons.access;
});
