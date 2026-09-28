import type { WebUiLanguage } from "./WebUiPage.js";

/** Explain navigation failures without exposing a browser stack or suggesting unsafe bypasses. */
export function browserFailureMessage(
  message: string,
  language: WebUiLanguage,
): string {
  const t = (en: string, zh: string, tw: string) =>
    language === "en" ? en : language === "zh-TW" ? tw : zh;
  if (/Timeout .*exceeded|timed out|ERR_TIMED_OUT/i.test(message))
    return t(
      "This page is taking too long to load. Check the connection and retry, or choose another search engine and submit your search again.",
      "网页加载超时。请检查网络后重试；也可切换搜索引擎并重新提交搜索。",
      "網頁載入逾時。請檢查網路後重試；也可切換搜尋引擎並重新送出搜尋。",
    );
  if (/ERR_NAME_NOT_RESOLVED|ENOTFOUND/i.test(message))
    return t(
      "The website address could not be found. Check the spelling and your network connection.",
      "找不到这个网站。请检查网址拼写和网络连接。",
      "找不到這個網站。請檢查網址拼寫與網路連線。",
    );
  if (/ERR_CERT_|ERR_SSL_/i.test(message))
    return t(
      "A secure connection could not be established. Check the website address and its certificate; security checks remain enabled.",
      "无法建立安全连接。请检查网址和网站证书；安全检查仍保持开启。",
      "無法建立安全連線。請檢查網址與網站憑證；安全檢查仍保持開啟。",
    );
  if (
    /ERR_(?:CONNECTION_|INTERNET_DISCONNECTED|TUNNEL_CONNECTION_FAILED|PROXY_CONNECTION_FAILED)|ECONNREFUSED/i.test(
      message,
    )
  )
    return t(
      "The website could not be reached. Check the connection, or make sure the local development server is running, then retry.",
      "无法连接网站。请检查网络；如果是本地页面，确认开发服务器已启动后重试。",
      "無法連線至網站。請檢查網路；若為本機頁面，請確認開發伺服器已啟動後重試。",
    );
  return message.split("\n")[0]!.slice(0, 350);
}
