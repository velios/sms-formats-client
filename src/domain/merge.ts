import type { MergeResult } from "./types";

/**
 * Simple 3-way merge for text files.
 * base = previous remote snapshot
 * local = user's draft
 * remote = freshly fetched content
 */
export function threeWayMerge(
  base: string,
  local: string,
  remote: string,
  path: string
): MergeResult {
  // If local hasn't changed from base, use remote
  if (local === base) {
    return { path, status: "unchanged", content: remote };
  }

  // If remote hasn't changed from base, keep local
  if (remote === base) {
    return { path, status: "clean", content: local };
  }

  // If both changed the same way, no conflict
  if (local === remote) {
    return { path, status: "clean", content: local };
  }

  // Both changed differently: attempt line-level merge
  const baseLines = base.split("\n");
  const localLines = local.split("\n");
  const remoteLines = remote.split("\n");

  const merged: string[] = [];
  let hasConflict = false;
  const maxLen = Math.max(
    baseLines.length,
    localLines.length,
    remoteLines.length
  );

  for (let i = 0; i < maxLen; i++) {
    const bLine = baseLines[i] ?? "";
    const lLine = localLines[i] ?? "";
    const rLine = remoteLines[i] ?? "";

    if (lLine === rLine) {
      merged.push(lLine);
    } else if (lLine === bLine) {
      merged.push(rLine);
    } else if (rLine === bLine) {
      merged.push(lLine);
    } else {
      // True conflict
      hasConflict = true;
      merged.push("<<<<<<< LOCAL");
      merged.push(lLine);
      merged.push("=======");
      merged.push(rLine);
      merged.push(">>>>>>> REMOTE");
    }
  }

  return {
    path,
    status: hasConflict ? "conflict" : "clean",
    content: merged.join("\n"),
  };
}
