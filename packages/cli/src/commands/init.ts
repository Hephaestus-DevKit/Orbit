import picocolors from "picocolors";
import { scaffoldAgentProject } from "../runtime/ProjectScaffolder.js";

export async function runInit(
  cwd: string,
  options: { minimal?: boolean; json?: boolean } = {},
): Promise<void> {
  const result = await scaffoldAgentProject(cwd, options);
  if (options.json) {
    console.log(JSON.stringify({ schemaVersion: 1, ...result }, null, 2));
    return;
  }
  for (const file of result.files) {
    const symbol = file.status === "created" ? "✔" : "●";
    const color =
      file.status === "created" ? picocolors.green : picocolors.gray;
    console.log(color(`${symbol} ${file.status}: ${file.path}`));
  }
  if (result.ecosystems.length > 0) {
    console.log(picocolors.cyan(`● Detected: ${result.ecosystems.join(", ")}`));
  }
  for (const warning of result.warnings) {
    console.log(picocolors.yellow(`⚠️ ${warning}`));
  }
}
