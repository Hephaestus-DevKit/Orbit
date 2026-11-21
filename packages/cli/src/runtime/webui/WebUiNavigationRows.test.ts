import { runInNewContext } from "node:vm";
import { describe, expect, it } from "../../../../../scripts/testing/support.mjs";
import { createNavigationRows, projectPathKey } from "./WebUiNavigationRows.js";

describe("live navigation rows", () => {
  it("preserves distinct Unix directories and recognizes equivalent Windows paths", () => {
    expect(projectPathKey("/src/Web")).not.toBe(projectPathKey("/src/web"));
    expect(projectPathKey("C:\\Projects\\ORBIT")).toBe("c:/projects/orbit");
    expect(projectPathKey("\\\\Server\\Repo")).toBe("//server/repo");
  });

  it("reuses controls during a status refresh and moves matching rows when their order changes", () => {
    interface TestRow {
      id: string;
      dataset: Record<string, string>;
      remove(): void;
      replaceWith(next: TestRow): void;
    }
    const children: TestRow[] = [];
    function row(id: string): TestRow {
      return {
        id,
        dataset: {} as Record<string, string>,
        remove() {
          children.splice(children.indexOf(this), 1);
        },
        replaceWith(next: TestRow) {
          children[children.indexOf(this)] = next;
        },
      };
    }
    const container = {
      children,
      contains: () => false,
      insertBefore(item: TestRow, before: TestRow | null) {
        if (children.includes(item)) item.remove();
        children.splice(before ? children.indexOf(before) : children.length, 0, item);
      },
    };
    const reconcile = runInNewContext(`(${createNavigationRows.toString()})()`, {
      document: { activeElement: null },
    }) as ReturnType<typeof createNavigationRows>;
    function update(items: string[], suffix = "") {
      reconcile(
        container as unknown as HTMLElement,
        items,
        id => id,
        id => [id, suffix],
        id => row(id) as unknown as HTMLElement,
      );
    }
    update(["a", "b"]);
    const [a, b] = children;
    update(["b", "a"]);
    expect(children[0]).toBe(b);
    expect(children[1]).toBe(a);
    update(["a"]);
    expect(children).toEqual([a]);
    update(["a"], "renamed");
    expect(children[0]).not.toBe(a);
  });
});
