import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  calculateFormatIntersectionStats,
  type FormatIntersectionStat,
} from "@/domain/format";
import type { RepoRef } from "@/domain/types";
import {
  type CachedFormatEntry,
  type DraftStoreLike,
  prepareFormatEntries,
} from "@/features/quick-check/format-entries";
import {
  buildIntersectionScope,
  type IntersectionScope,
  type IntersectionsErrorCode,
  type IntersectionsScopeSignal,
  mergeLiveEditIntoSnapshot,
  resolveIntersectionScopeFiles,
  resolveVisibleIntersectionEntries,
  shouldAcceptRunResult,
} from "./core";

export interface IntersectionsDraftStore extends DraftStoreLike {
  drafts: ReadonlyMap<string, unknown>;
}

export interface UseIntersectionsParams {
  // Identity of the workspace: when any part changes the whole tool resets,
  // including the scope (ADR-0013 — reset is the module's invariant).
  bankPath: string;
  repository: RepoRef;
  sourceRefName: string | undefined;
  prNumber: number | null;
  // Live format files: paths to snapshot on calculate, and the filters that
  // keep deleted files out of badges and scope.
  formatPaths: string[];
  draftStore: IntersectionsDraftStore;
  allFormatFiles: string[];
  deletedFormatFiles: Set<string>;
  loadEntries?: typeof prepareFormatEntries;
  // "raised" — scope was lifted under an anchor, "cleared" — scope dropped;
  // the caller maps the signal onto its own tab state (ADR-0013).
  onScopeSignal?: (signal: IntersectionsScopeSignal) => void;
}

export interface UseIntersectionsResult {
  entries: Map<string, CachedFormatEntry>;
  visibleEntries: CachedFormatEntry[];
  stats: Map<string, FormatIntersectionStat>;
  scopeFiles: string[] | null;
  hasCalculated: boolean;
  isCalculating: boolean;
  error: IntersectionsErrorCode | null;
  loadErrorsCount: number;
  calculate: () => Promise<void>;
  scopeTo: (filePath: string) => void;
  mergeLiveEdit: (context: {
    filePath: string;
    regex: string;
    examples: string[];
  }) => void;
}

export function useIntersections(
  params: UseIntersectionsParams
): UseIntersectionsResult {
  const {
    bankPath,
    repository,
    sourceRefName,
    prNumber,
    formatPaths,
    draftStore,
    allFormatFiles,
    deletedFormatFiles,
    loadEntries = prepareFormatEntries,
    onScopeSignal,
  } = params;

  const [entries, setEntries] = useState<Map<string, CachedFormatEntry>>(
    new Map()
  );
  const [hasCalculated, setHasCalculated] = useState(false);
  const [isCalculating, setIsCalculating] = useState(false);
  const [error, setError] = useState<IntersectionsErrorCode | null>(null);
  const [loadErrorsCount, setLoadErrorsCount] = useState(0);
  const [scope, setScope] = useState<IntersectionScope | null>(null);
  const runIdRef = useRef(0);

  const onScopeSignalRef = useRef(onScopeSignal);
  useEffect(() => {
    onScopeSignalRef.current = onScopeSignal;
  });

  useEffect(() => {
    runIdRef.current += 1;
    setEntries(new Map());
    setHasCalculated(false);
    setLoadErrorsCount(0);
    setError(null);
    setIsCalculating(false);
    setScope(null);
    onScopeSignalRef.current?.("cleared");
  }, [bankPath, repository.owner, repository.repo, sourceRefName]);

  // A draft edit or a change of the live file list mid-flight silently
  // cancels the calculation — preserved as-is per ADR-0013.
  useEffect(() => {
    runIdRef.current += 1;
    setIsCalculating(false);
  }, [draftStore.drafts, formatPaths]);

  const visibleEntries = useMemo(
    () =>
      resolveVisibleIntersectionEntries({
        entriesByPath: entries,
        deletedFormatFiles,
      }),
    [entries, deletedFormatFiles]
  );
  const stats = useMemo(
    () => calculateFormatIntersectionStats(visibleEntries),
    [visibleEntries]
  );
  const scopeFiles = useMemo(
    () =>
      resolveIntersectionScopeFiles({
        scope,
        allFormatFiles,
        deletedFormatFiles,
      }),
    [allFormatFiles, deletedFormatFiles, scope]
  );

  const calculate = useCallback(async () => {
    setScope(null);
    onScopeSignalRef.current?.("cleared");

    const runId = runIdRef.current + 1;
    runIdRef.current = runId;

    if (!sourceRefName) {
      setError("no-source");
      setLoadErrorsCount(0);
      setIsCalculating(false);
      return;
    }
    if (!prNumber) {
      setError("missing-pr-number");
      setLoadErrorsCount(0);
      setIsCalculating(false);
      return;
    }

    setIsCalculating(true);
    setError(null);
    setLoadErrorsCount(0);

    try {
      const prepared = await loadEntries({
        filePaths: formatPaths,
        draftStore,
        prNumber,
        sourceRefName,
        repository,
      });
      if (!shouldAcceptRunResult({ currentRunId: runIdRef.current, runId })) {
        return;
      }

      setEntries(
        new Map(prepared.entries.map((entry) => [entry.filePath, entry]))
      );
      setHasCalculated(true);
      setLoadErrorsCount(prepared.loadErrorsCount);
    } catch {
      if (!shouldAcceptRunResult({ currentRunId: runIdRef.current, runId })) {
        return;
      }
      setLoadErrorsCount(0);
      setError("load-failed");
    } finally {
      if (shouldAcceptRunResult({ currentRunId: runIdRef.current, runId })) {
        setIsCalculating(false);
      }
    }
  }, [
    draftStore,
    formatPaths,
    loadEntries,
    prNumber,
    repository,
    sourceRefName,
  ]);

  const scopeTo = useCallback(
    (filePath: string) => {
      setScope(buildIntersectionScope({ anchorPath: filePath, stats }));
      onScopeSignalRef.current?.("raised");
    },
    [stats]
  );

  const mergeLiveEdit = useCallback(
    (context: { filePath: string; regex: string; examples: string[] }) => {
      if (!hasCalculated || deletedFormatFiles.has(context.filePath)) {
        return;
      }
      setEntries((prev) =>
        mergeLiveEditIntoSnapshot({ entries: prev, context })
      );
      setError(null);
    },
    [deletedFormatFiles, hasCalculated]
  );

  return {
    entries,
    visibleEntries,
    stats,
    scopeFiles,
    hasCalculated,
    isCalculating,
    error,
    loadErrorsCount,
    calculate,
    scopeTo,
    mergeLiveEdit,
  };
}
