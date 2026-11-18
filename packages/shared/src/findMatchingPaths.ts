import { isAbsolute, relative, sep } from "node:path";
import { Minimatch } from "minimatch";
import { PathScurry } from "path-scurry";

interface PathSearchOptions {
  cwd: string;
  ignore?: string[];
  deep?: number;
  dot?: boolean;
  absolute?: boolean;
  includeDirectories?: boolean;
}

/** Match workspace entries without following links, including literal path prefixes. */
export async function findMatchingPaths(
  pattern: string,
  options: PathSearchOptions,
): Promise<string[]> {
  const { cwd, dot = false, ignore = [] } = options;
  const positive = (value: string) =>
    value.length > 0 && (!value.startsWith("!") || value.startsWith("!("));
  if (!positive(pattern)) return [];
  const compile = (value: string) =>
    new Minimatch(
      (isAbsolute(value)
        ? relative(cwd, value).split(sep).join("/")
        : value).replace(/^\.\//, ""),
      { dot, nonegate: true, nocomment: true, platform: "linux" },
    );
  const matcher = compile(pattern);
  const excludes = ignore.filter(positive).map(compile);
  const walker = new PathScurry(cwd);
  const rootDepth = walker.cwd.depth();
  const ignored = (path: string) => excludes.some((rule) => rule.match(path));
  const files: string[] = [];
  for await (const entry of walker.iterate({
    follow: false,
    walkFilter: (directory) => {
      if (directory === walker.cwd)
        return true;
      const path = directory.relativePosix();
      return (
        directory.depth() - rootDepth <= (options.deep ?? Infinity)
        && !ignored(path)
        && !ignored(path + "/")
        && matcher.match(path, true)
      );
    },
  })) {
    if (!entry.isFile() && !(options.includeDirectories && entry.isDirectory()))
      continue;
    const path = entry.relativePosix();
    if (
      path
      && matcher.match(path)
      && !ignored(path)
      && !(entry.isDirectory() && ignored(path + "/"))
    ) {
      files.push(options.absolute ? entry.fullpath() : path);
    }
  }
  return files;
}
