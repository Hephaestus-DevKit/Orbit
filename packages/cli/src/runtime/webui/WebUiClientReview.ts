import type { WebUiLoopSnapshot } from "./WebUiContracts.js";

type Verification = ReturnType<NonNullable<WebUiLoopSnapshot["getSessionReview"]>>["verification"];
type Label = (en: string, zh: string, tw: string) => string;

/** Distinguish failed checks, incomplete historical records, and successful checks. */
export function verificationSummary(checks: Verification, t: Label): string {
  const failures = checks.filter(check => check.success === false).length;
  if (failures) return String(failures) + t(" failed", " 项失败", " 項失敗");
  if (!checks.length || checks.some(check => check.success !== true))
    return t("See records", "查看记录", "查看記錄");
  return String(checks.length) + t(" passed", " 项通过", " 項通過");
}

/** Render task evidence with the same outcome semantics in the chat and details. */
export function renderReviewResults(
  fileCount: number,
  verification: Verification,
  t: Label,
  relativeSessionTime: (value: string) => string,
  summarize: typeof verificationSummary,
): void {
  const get = (id: string) => document.getElementById(id)!;
  get("reviewResults").hidden = !fileCount && !verification.length;
  get("changesButton").hidden = !fileCount;
  get("resultFileCount").textContent = String(fileCount);
  get("verificationResultButton").hidden = !verification.length;
  get("resultVerification").textContent = summarize(verification, t);
  get("verificationCount").textContent = String(verification.length);
  get("verificationList").replaceChildren();
  if (!verification.length) {
    const empty = document.createElement("p");
    empty.className = "review-empty";
    empty.textContent = t(
      "No verification recorded for this chat.",
      "本次对话尚无验证记录。",
      "本次對話尚無驗證記錄。",
    );
    get("verificationList").append(empty);
  } else {
    for (const result of verification) {
      const row = document.createElement("div");
      row.className = "verification-row "
        + (result.success === true ? "is-success" : result.success === false ? "is-error" : "");
      const marker = document.createElement("span");
      marker.textContent = result.success === true ? "✓" : result.success === false ? "×" : "·";
      const content = document.createElement("span");
      const title = document.createElement("strong");
      title.textContent = typeof result.success !== "boolean"
        ? (t("Outcome unrecorded", "结果未记录", "結果未記錄"))
        : result.success
        ? (t("Verification passed", "验证通过", "驗證通過"))
        : (t("Verification failed", "验证失败", "驗證失敗"));
      const detail = document.createElement("small");
      detail.textContent = result.detail || relativeSessionTime(result.timestamp);
      content.append(title, detail);
      row.append(marker, content);
      get("verificationList").append(row);
    }
  }
}
