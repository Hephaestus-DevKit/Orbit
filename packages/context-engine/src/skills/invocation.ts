/** Ignore pasted fenced examples and quoted source lines during routing. */
export function invocationText(query: string): string {
  return query
    .replace(/```[^\n]*\n[\s\S]*?(?:```|$)/g, " ")
    .replace(/~~~[^\n]*\n[\s\S]*?(?:~~~|$)/g, " ")
    .replace(/^\s*>.*$/gm, " ");
}

/** Conservative, explicit opt-outs; this is not a semantic intent classifier. */
export function excludesSkill(query: string, name: string): boolean {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const target = `(?<![a-z0-9-])(?:\\$|skill:\\s*|技能[:：]\\s*)?${escaped}(?![a-z0-9-])`;
  const negative =
    "(?:do\\s+not|don't|don’t|never|without|disable|skip|avoid|不要|别|別|勿|禁用|停用|不使用)";
  if (
    new RegExp(`${negative}[^.。!?！？;；,，\\n]{0,48}${target}`, "iu").test(
      query,
    )
  )
    return true;
  if (
    new RegExp(
      `(?:what\\s+is|explain|describe|介绍|介紹|解释|解釋|什么是|什麼是)\\s*(?:the\\s+)?[\x60"'“”‘’]*(?:skill\\s+)?${target}`,
      "iu",
    ).test(query)
  )
    return true;
  return new RegExp(
    `${negative}\\s*(?:(?:use|invoke|activate|load|使用|启用|啟用|调用|調用|加载|載入)\\s*)?(?:(?:any|all|任何|所有)\\s*)?(?:skills?\\b|技能)`,
    "iu",
  ).test(query);
}
