import type { FormatIntersectionStat } from "@/domain/format";
import type { LoadedFormat } from "@/features/workspace/bank-snapshot";

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

export function shouldAcceptRunResult(params: {
  currentRunId: number;
  runId: number;
}): boolean {
  return params.currentRunId === params.runId;
}

export function buildLoadedFormatFromEditorContext(params: {
  filePath: string;
  regex: string;
  examples: string[];
}): LoadedFormat {
  const { filePath, regex, examples } = params;
  return {
    filePath,
    fileName: extractFormatFileName(filePath),
    regex: regex.trim(),
    examples: examples.map(normalizeIntersectionExample).filter(Boolean),
    source: "draft",
  };
}

export function mergeLiveEditIntoSnapshot(params: {
  entries: Map<string, LoadedFormat>;
  context: { filePath: string; regex: string; examples: string[] };
}): Map<string, LoadedFormat> {
  const { entries, context } = params;
  const next = new Map(entries);
  next.set(context.filePath, buildLoadedFormatFromEditorContext(context));
  return next;
}

export function resolveVisibleIntersectionEntries(params: {
  entriesByPath: Map<string, LoadedFormat>;
  deletedFormatFiles: Set<string>;
}): LoadedFormat[] {
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
