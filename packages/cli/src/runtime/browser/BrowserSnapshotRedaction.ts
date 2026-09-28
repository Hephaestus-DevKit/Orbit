/** Remove editable field values from Playwright's textual accessibility snapshot. */
export function redactBrowserSnapshot(snapshot: string): string {
  let privateIndent: number | undefined;
  const lines: string[] = [];
  for (const line of snapshot.split(/\r?\n/)) {
    const indent = /^\s*/.exec(line)?.[0].length ?? 0;
    if (privateIndent !== undefined) {
      if (!line.trim()) continue;
      if (indent > privateIndent) continue;
      privateIndent = undefined;
    }
    const field =
      /^(\s*)-\s*(textbox|searchbox|combobox|spinbutton)(?=\s|:|$)/u.exec(line);
    if (field) {
      privateIndent = field[1]!.length;
      lines.push(`${field[1]}- ${field[2]} [form value hidden]`);
    } else lines.push(line);
  }
  return lines.join("\n");
}
