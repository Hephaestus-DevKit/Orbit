import { promises as fs } from "fs";

/**
 * Create a new scaffold file exclusively and clean up a failed write without
 * removing another writer's replacement. The caller must validate the target
 * against its workspace boundary and create the parent directory first.
 */
export async function writeNewScaffoldFile(
  path: string,
  content: string,
): Promise<void> {
  const file = await fs.open(path, "wx");
  try {
    await file.writeFile(content, "utf8");
    await file.close();
  } catch (error: unknown) {
    const identity = await file.stat().catch(() => undefined);
    await file.close().catch(() => undefined);
    try {
      const current = await fs.lstat(path).catch((statError: unknown) => {
        if (
          typeof statError === "object" &&
          statError !== null &&
          "code" in statError &&
          statError.code === "ENOENT"
        )
          return undefined;
        throw statError;
      });
      if (
        identity &&
        current?.dev === identity.dev &&
        current.ino === identity.ino
      ) {
        await fs.unlink(path);
      }
    } catch (cleanupError: unknown) {
      throw new AggregateError(
        [error, cleanupError],
        `Scaffold creation failed; could not clean up incomplete file: ${path}`,
      );
    }
    throw error;
  }
}
