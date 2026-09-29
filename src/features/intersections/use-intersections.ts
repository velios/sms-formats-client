import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  calculateFormatIntersectionStats,
  type FormatIntersectionStat,
} from "@/domain/format";
import type { RepoRef } from "@/domain/types";
import {
  type DraftStoreLike,
  type LoadedFormat,
  loadBankSnapshot,
} from "@/features/workspace/bank-snapshot";
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
  bankPath: string;
  repository: RepoRef;
  sourceRefName: string | undefined;
  prNumber: number | null;
  formatPaths: string[];
  draftStore: IntersectionsDraftStore;
  allFormatFiles: string[];
  deletedFormatFiles: Set<string>;
  loadEntries?: typeof loadBankSnapshot;
  onScopeSignal?: (signal: IntersectionsScopeSignal) => void;
}

export interface UseIntersectionsResult {
  entries: Map<string, LoadedFormat>;
  visibleEntries: LoadedFormat[];
  stats: Map<string, FormatIntersectionStat>;
  scopeFiles: string[] | null;
  hasCalculated: boolean;
  isCalculating: boolean;
  error: IntersectionsErrorCode | null;
  loadErrorsCount: number;
  calculate: (filePaths?: string[]) => Promise<boolean>;
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
    loadEntries = loadBankSnapshot,
    onScopeSignal,
  } = params;

  const [entries, setEntries] = useState<Map<string, LoadedFormat>>(new Map());
  const [hasCalculated, setHasCalculated] = useState(false);
  const [isCalculating, setIsCalculating] = useState(false);
  const [error, setError] = useState<IntersectionsErrorCode | null>(null);
  const [loadErrorsCount, setLoadErrorsCount] = useState(0);
  const [scope, setScope] = useState<IntersectionScope | null>(null);
  const runIdRef = useRef(0);
  const contextRef = useRef({ drafts: draftStore.drafts, formatPaths });
  contextRef.current = { drafts: draftStore.drafts, formatPaths };

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

  useEffect(() => {
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

  const calculate = useCallback(
    async (filePathsOverride?: string[]) => {
      setScope(null);
      onScopeSignalRef.current?.("cleared");

      const context = contextRef.current;
      const paths = filePathsOverride ?? formatPaths;
      const draftsAtStart = new Map(
        paths.map((path) => [path, draftStore.getDraft(path)])
      );
      const isCurrent = () =>
        runIdRef.current === runId &&
        [...draftsAtStart].every(
          ([path, draft]) => draftStore.getDraft(path) === draft
        ) &&
        (filePathsOverride !== undefined ||
          (context.drafts === contextRef.current.drafts &&
            context.formatPaths === contextRef.current.formatPaths));
      const runId = runIdRef.current + 1;
      runIdRef.current = runId;

      if (!sourceRefName) {
        setError("no-source");
        setLoadErrorsCount(0);
        setIsCalculating(false);
        return false;
      }
      if (!prNumber) {
        setError("missing-pr-number");
        setLoadErrorsCount(0);
        setIsCalculating(false);
        return false;
      }

      setIsCalculating(true);
      setError(null);
      setLoadErrorsCount(0);

      try {
        const prepared = await loadEntries({
          filePaths: paths,
          draftStore,
          sourceRefName,
          repository,
        });
        if (!isCurrent()) {
          return false;
        }

        setEntries(
          new Map(prepared.entries.map((entry) => [entry.filePath, entry]))
        );
        setHasCalculated(true);
        setLoadErrorsCount(prepared.loadErrorsCount);
        return prepared.loadErrorsCount === 0;
      } catch {
        if (!isCurrent()) {
          return false;
        }
        setLoadErrorsCount(0);
        setError("load-failed");
        return false;
      } finally {
        if (shouldAcceptRunResult({ currentRunId: runIdRef.current, runId })) {
          setIsCalculating(false);
        }
      }
    },
    [draftStore, formatPaths, loadEntries, prNumber, repository, sourceRefName]
  );

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
