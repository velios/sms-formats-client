import type { FormatIntersectionStat } from "@/domain/format";
import type { CachedFormatEntry } from "@/features/quick-check/format-entries";

// Set of formats raised into the "Intersections" tab: the clicked format
// first, then the formats whose examples its regex recognizes (ADR-0011).
export interface IntersectionScope {
  anchorPath: string;
  formatPaths: string[];
}

export type IntersectionsErrorCode =
  | "no-source"
  | "missing-pr-number"
  | "load-failed";

export type IntersectionsScopeSignal = "raised" | "cleared";

export function normalizeIntersectionExample(example: string): string {
  return example.trim();
}

function extractFormatFileName(path: string): string {
  return path.split("/").pop() ?? path;
}

// A loaded snapshot is accepted only if no reset/cancel/newer run bumped the
// run id while it was in flight; a stale run is dropped silently (ADR-0013).
export function shouldAcceptRunResult(params: {
  currentRunId: number;
  runId: number;
}): boolean {
  return params.currentRunId === params.runId;
}

export function buildCachedFormatEntryFromEditorContext(params: {
  filePath: string;
  regex: string;
  examples: string[];
}): CachedFormatEntry {
  const { filePath, regex, examples } = params;
  return {
    filePath,
    fileName: extractFormatFileName(filePath),
    regex: regex.trim(),
    examples: examples.map(normalizeIntersectionExample).filter(Boolean),
    source: "draft",
    fingerprint: `draft-live:${Date.now()}`,
  };
}

export function mergeLiveEditIntoSnapshot(params: {
  entries: Map<string, CachedFormatEntry>;
  context: { filePath: string; regex: string; examples: string[] };
}): Map<string, CachedFormatEntry> {
  const { entries, context } = params;
  const next = new Map(entries);
  next.set(context.filePath, buildCachedFormatEntryFromEditorContext(context));
  return next;
}

export function resolveVisibleIntersectionEntries(params: {
  entriesByPath: Map<string, CachedFormatEntry>;
  deletedFormatFiles: Set<string>;
}): CachedFormatEntry[] {
  const { entriesByPath, deletedFormatFiles } = params;
  return Array.from(entriesByPath.values()).filter(
    (entry) => !deletedFormatFiles.has(entry.filePath)
  );
}

export function buildIntersectionScope(params: {
  anchorPath: string;
  stats: Map<string, FormatIntersectionStat>;
}): IntersectionScope {
  const { anchorPath, stats } = params;
  const otherPaths = stats.get(anchorPath)?.intersectingFormatPaths ?? [];
  return {
    anchorPath,
    formatPaths: [anchorPath, ...otherPaths],
  };
}

export function resolveIntersectionScopeFiles(params: {
  scope: IntersectionScope | null;
  allFormatFiles: string[];
  deletedFormatFiles: Set<string>;
}): string[] | null {
  const { scope, allFormatFiles, deletedFormatFiles } = params;
  if (!scope) {
    return null;
  }
  return scope.formatPaths.filter(
    (path) => allFormatFiles.includes(path) && !deletedFormatFiles.has(path)
  );
}
