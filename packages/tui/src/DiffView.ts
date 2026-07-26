import picocolors from "picocolors";

interface Hunk {
  startB: number;
  endB: number;
  startA: number;
  endA: number;
  linesB: string[];
  linesA: string[];
}

interface MergedHunk {
  startB: number;
  endB: number;
  startA: number;
  endA: number;
  subHunks: Hunk[];
}

export class DiffView {
  private static findHunks(
    beforeContent: string,
    afterContent: string,
  ): Hunk[] {
    const linesBefore = beforeContent ? beforeContent.split("\n") : [];
    const linesAfter = afterContent.split("\n");

    const hunks: Hunk[] = [];
    let iB = 0;
    let iA = 0;

    while (iB < linesBefore.length || iA < linesAfter.length) {
      if (
        iB < linesBefore.length &&
        iA < linesAfter.length &&
        linesBefore[iB] === linesAfter[iA]
      ) {
        iB++;
        iA++;
        continue;
      }

      const startB = iB;
      const startA = iA;

      let bestDB = -1;
      let bestDA = -1;
      let minSum = Infinity;

      const maxLookahead = 20;
      for (let dB = 0; dB <= maxLookahead; dB++) {
        for (let dA = 0; dA <= maxLookahead; dA++) {
          if (dB === 0 && dA === 0) continue;
          const posB = iB + dB;
          const posA = iA + dA;

          if (posB > linesBefore.length || posA > linesAfter.length) continue;

          const isEndB = posB === linesBefore.length;
          const isEndA = posA === linesAfter.length;

          let isMatch = false;
          if (isEndB && isEndA) {
            isMatch = true;
          } else if (!isEndB && !isEndA) {
            isMatch = linesBefore[posB] === linesAfter[posA];
          }

          if (isMatch) {
            const sum = dB + dA;
            if (sum < minSum) {
              minSum = sum;
              bestDB = dB;
              bestDA = dA;
            }
          }
        }
      }

      if (bestDB !== -1 && bestDA !== -1) {
        const linesB = linesBefore.slice(startB, startB + bestDB);
        const linesA = linesAfter.slice(startA, startA + bestDA);
        iB += bestDB;
        iA += bestDA;

        hunks.push({
          startB,
          endB: iB,
          startA,
          endA: iA,
          linesB,
          linesA,
        });
      } else {
        const linesB = linesBefore.slice(startB);
        const linesA = linesAfter.slice(startA);
        iB = linesBefore.length;
        iA = linesAfter.length;

        hunks.push({
          startB,
          endB: iB,
          startA,
          endA: iA,
          linesB,
          linesA,
        });
      }
    }
    return hunks;
  }

  private static mergeHunks(rawHunks: Hunk[]): MergedHunk[] {
    if (rawHunks.length === 0) return [];
    const hunks: MergedHunk[] = [];
    let current: MergedHunk = {
      startB: rawHunks[0].startB,
      endB: rawHunks[0].endB,
      startA: rawHunks[0].startA,
      endA: rawHunks[0].endA,
      subHunks: [rawHunks[0]],
    };
    for (let i = 1; i < rawHunks.length; i++) {
      const next = rawHunks[i];
      if (current.endB + 6 >= next.startB) {
        current.subHunks.push(next);
        current.endB = next.endB;
        current.endA = next.endA;
      } else {
        hunks.push(current);
        current = {
          startB: next.startB,
          endB: next.endB,
          startA: next.startA,
          endA: next.endA,
          subHunks: [next],
        };
      }
    }
    hunks.push(current);
    return hunks;
  }

  /**
   * Column-zero unified diff without ANSI colors, suitable for browsers,
   * ```diff fences and `git apply`-style consumers. The interactive TUI
   * pager keeps using {@link render}, which indents for readability.
   */
  public static renderPlain(
    filePath: string,
    before: string | null,
    after: string,
  ): string {
    const output: string[] = [];
    output.push(`--- ${before === null ? "/dev/null" : `a/${filePath}`}`);
    output.push(`+++ b/${filePath}`);

    if (before === null) {
      const linesAfter = after.split("\n");
      output.push(`@@ -0,0 +1,${linesAfter.length} @@`);
      for (const line of linesAfter) {
        output.push(`+${line}`);
      }
      return output.join("\n");
    }

    const linesBefore = before.split("\n");
    const hunks = this.mergeHunks(this.findHunks(before, after));
    if (hunks.length === 0) {
      output.push(" No changes.");
      return output.join("\n");
    }

    for (const hunk of hunks) {
      const contextStart = Math.max(0, hunk.startB - 3);
      const contextEnd = Math.min(linesBefore.length, hunk.endB + 3);
      const oldCount = contextEnd - contextStart;
      let removed = 0;
      let added = 0;
      for (const sub of hunk.subHunks) {
        removed += sub.linesB.length;
        added += sub.linesA.length;
      }
      const newCount = oldCount - removed + added;
      const newStart = hunk.startA - (hunk.startB - contextStart);
      output.push(
        `@@ -${contextStart + 1},${oldCount} +${newStart + 1},${newCount} @@`,
      );

      for (let c = contextStart; c < hunk.startB; c++) {
        output.push(` ${linesBefore[c]}`);
      }
      let currentB = hunk.startB;
      for (const sub of hunk.subHunks) {
        for (let c = currentB; c < sub.startB; c++) {
          output.push(` ${linesBefore[c]}`);
        }
        for (const line of sub.linesB) {
          output.push(`-${line}`);
        }
        for (const line of sub.linesA) {
          output.push(`+${line}`);
        }
        currentB = sub.endB;
      }
      for (let c = hunk.endB; c < contextEnd; c++) {
        output.push(` ${linesBefore[c]}`);
      }
    }
    return output.join("\n");
  }

  public static render(
    filePath: string,
    before: string | null,
    after: string,
  ): string {
    const output: string[] = [];
    output.push(
      picocolors.gray(
        "--- Diff: " + picocolors.bold(picocolors.cyan(filePath)) + " ---",
      ),
    );

    if (before === null) {
      const linesAfter = after.split("\n");
      for (const line of linesAfter) {
        output.push(`  ${picocolors.green(`+ ${line}`)}`);
      }
    } else {
      const linesBefore = before.split("\n");
      const rawHunks = this.findHunks(before, after);

      if (rawHunks.length === 0) {
        output.push(`  No changes.`);
      } else {
        // Merge hunks that are close to each other (overlapping contexts where gap <= 6 lines)
        const hunks = this.mergeHunks(rawHunks);

        for (let idx = 0; idx < hunks.length; idx++) {
          const hunk = hunks[idx];
          const lenB = hunk.endB - hunk.startB;
          const lenA = hunk.endA - hunk.startA;

          // Add section header
          output.push(
            `  ${picocolors.cyan(`@@ -${hunk.startB + 1},${lenB} +${hunk.startA + 1},${lenA} @@`)}`,
          );

          // Context before (max 3 lines)
          const contextStart = Math.max(0, hunk.startB - 3);
          for (let c = contextStart; c < hunk.startB; c++) {
            output.push(`    ${linesBefore[c]}`);
          }

          // Print hunk content body
          let currentB = hunk.startB;
          for (const sub of hunk.subHunks) {
            // Print unchanged lines in the gap
            if (sub.startB > currentB) {
              const gapLines = linesBefore.slice(currentB, sub.startB);
              for (const line of gapLines) {
                output.push(`    ${line}`);
              }
            }
            // Deletions
            for (const line of sub.linesB) {
              output.push(`  ${picocolors.red(`- ${line}`)}`);
            }
            // Insertions
            for (const line of sub.linesA) {
              output.push(`  ${picocolors.green(`+ ${line}`)}`);
            }
            currentB = sub.endB;
          }

          // Context after (max 3 lines)
          const contextEnd = Math.min(linesBefore.length, hunk.endB + 3);
          for (let c = hunk.endB; c < contextEnd; c++) {
            output.push(`    ${linesBefore[c]}`);
          }
        }
      }
    }

    output.push(
      picocolors.gray(
        "----------------------------------------------------------------------------",
      ),
    );
    return output.join("\n");
  }
}
