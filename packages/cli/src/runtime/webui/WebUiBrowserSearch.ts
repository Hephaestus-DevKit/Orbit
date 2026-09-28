/** Recover only queries from known search-result URLs; never interpret arbitrary `q` parameters as searches. */
export function browserSearchQuery(rawUrl: string): string {
  try {
    const url = new URL(rawUrl);
    if (url.protocol !== "https:" || url.username || url.password || url.port)
      return "";
    const host = url.hostname.toLowerCase();
    const path = url.pathname.replace(/\/+$/, "") || "/";
    let parameter: "q" | "wd" | undefined;
    if (
      ["bing.com", "www.bing.com", "cn.bing.com"].includes(host) &&
      path === "/search"
    )
      parameter = "q";
    else if (
      [
        "google.com",
        "www.google.com",
        "www.google.co.uk",
        "www.google.de",
        "www.google.com.br",
        "www.google.com.hk",
      ].includes(host) &&
      path === "/search"
    )
      parameter = "q";
    else if (["baidu.com", "www.baidu.com"].includes(host) && path === "/s")
      parameter = "wd";
    else if (
      [
        "duckduckgo.com",
        "www.duckduckgo.com",
        "html.duckduckgo.com",
        "lite.duckduckgo.com",
      ].includes(host) &&
      ["/", "/html", "/lite"].includes(path)
    )
      parameter = "q";
    const query = parameter
      ? (url.searchParams.get(parameter) || "").trim()
      : "";
    return query.length <= 4096 ? query : "";
  } catch {
    return "";
  }
}
