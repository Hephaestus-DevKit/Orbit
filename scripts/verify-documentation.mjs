import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, extname, relative, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const repositoryRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));

/**
 * Return invalid local links without following remote URLs or same-page anchors.
 *
 * @param {string} root
 * @param {string[]} markdownFiles
 * @returns {string[]}
 */
export function findDocumentationFailures(root, markdownFiles) {
  const failures = [];

  for (const sourceFile of markdownFiles) {
    const sourcePath = resolve(root, sourceFile);
    if (!existsSync(sourcePath)) {
      failures.push(`${sourceFile}: Markdown source does not exist`);
      continue;
    }
    const markdown = readFileSync(sourcePath, "utf8");
    const inlineLinks = markdown.matchAll(
      /!?\[[^\]]*\]\(([^)\s]+)(?:\s+["'][^"']*["'])?\)/gu,
    );

    for (const match of inlineLinks) {
      const target = match[1];
      if (
        target.startsWith("#") ||
        /^[a-z][a-z\d+.-]*:/iu.test(target) ||
        target.startsWith("//")
      ) {
        continue;
      }

      const [encodedPath] = target.split("#", 1);
      let decodedPath;
      try {
        decodedPath = decodeURIComponent(encodedPath);
      } catch {
        failures.push(
          `${sourceFile}: link contains invalid URI encoding: ${target}`,
        );
        continue;
      }

      const destination = resolve(dirname(sourcePath), decodedPath);
      const relativeDestination = relative(root, destination);
      if (
        relativeDestination.startsWith("..") ||
        resolve(root, relativeDestination) !== destination
      ) {
        failures.push(
          `${sourceFile}: local link escapes the repository: ${target}`,
        );
        continue;
      }
      if (!existsSync(destination)) {
        failures.push(`${sourceFile}: local link does not exist: ${target}`);
        continue;
      }
      if (
        extname(destination).toLowerCase() === ".md" &&
        !statSync(destination).isFile()
      ) {
        failures.push(`${sourceFile}: Markdown link is not a file: ${target}`);
      }
    }
  }

  return failures;
}

function main() {
  // Read the working tree rather than only the Git index. This keeps the
  // documentation gate useful while a rename is still unstaged: deleted
  // index entries disappear and their untracked replacements are validated.
  const git = spawnSync(
    "git",
    ["ls-files", "--cached", "--others", "--exclude-standard", "--", "*.md"],
    {
      cwd: repositoryRoot,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    },
  );

  if (git.error) throw git.error;
  if (git.status !== 0) {
    throw new Error(
      `Documentation verification failed: ${(git.stderr || git.stdout).trim()}`,
    );
  }

  const markdownFiles = git.stdout
    .split(/\r?\n/u)
    .map((entry) => entry.trim())
    .filter(Boolean)
    .filter((entry) => existsSync(resolve(repositoryRoot, entry)));
  const failures = findDocumentationFailures(repositoryRoot, markdownFiles);
  if (failures.length > 0) {
    throw new Error(
      `Documentation verification failed:\n${failures
        .map((failure) => `- ${failure}`)
        .join("\n")}`,
    );
  }

  console.log(
    `✔ Verified ${markdownFiles.length} working-tree Markdown files and their local links.`,
  );
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  main();
}
