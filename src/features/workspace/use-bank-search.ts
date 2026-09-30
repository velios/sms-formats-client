import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { parseFormatFile } from "@/domain/format";
import { type FormatSearchDoc, searchFormatPaths } from "@/domain/search";
import { loadFileContent } from "@/infrastructure/file-content";

const SEARCH_EXAMPLE_MIN_QUERY_LENGTH = 2;
const SEARCH_INDEX_PARALLELISM = 4;

export function extractFormatFileName(path: string): string {
  return path.split("/").pop() ?? path;
}

function extractExamplesForSearch(content: string, filePath: string): string {
  return parseFormatFile(content, filePath).examples.join("\n");
}

function shouldStartExampleIndexing(
  query: string,
  formatTab: "all" | "recent" | "intersections"
): boolean {
  if (formatTab !== "all") {
    return false;
  }
  return query.trim().length >= SEARCH_EXAMPLE_MIN_QUERY_LENGTH;
}

function upsertRemoteSearchDoc(
  prev: Map<string, FormatSearchDoc>,
  path: string,
  exampleText: string
): Map<string, FormatSearchDoc> {
  const next = new Map(prev);
  const previous = next.get(path);
  next.set(path, {
    path,
    name: previous?.name ?? extractFormatFileName(path),
    exampleText,
    isLoaded: true,
    source: "remote",
  });
  return next;
}

function upsertRemoteErrorDoc(
  prev: Map<string, FormatSearchDoc>,
  path: string
): Map<string, FormatSearchDoc> {
  const next = new Map(prev);
  const previous = next.get(path);
  next.set(path, {
    path,
    name: previous?.name ?? extractFormatFileName(path),
    exampleText: previous?.exampleText ?? "",
    isLoaded: true,
    source: "remote-error",
  });
  return next;
}

function syncSearchDocs(params: {
  previousDocs: Map<string, FormatSearchDoc>;
  formatPaths: string[];
  draftStore: {
    getDraft: (
      filePath: string
    ) => { content: string; headContent: string | null } | undefined;
  };
}): Map<string, FormatSearchDoc> {
  const { previousDocs, formatPaths, draftStore } = params;
  const next = new Map<string, FormatSearchDoc>();
  for (const path of formatPaths) {
    const draft = draftStore.getDraft(path);
    if (draft) {
      next.set(path, {
        path,
        name: extractFormatFileName(path),
        exampleText: extractExamplesForSearch(draft.content, path),
        isLoaded: true,
        source: "draft",
      });
      continue;
    }

    const previous = previousDocs.get(path);
    if (previous && previous.source !== "draft") {
      next.set(path, {
        ...previous,
        path,
        name: extractFormatFileName(path),
      });
      continue;
    }

    next.set(path, {
      path,
      name: extractFormatFileName(path),
      exampleText: "",
      isLoaded: false,
      source: "none",
    });
  }
  return next;
}

interface SearchDraftStore {
  drafts: Map<string, { content: string; headContent: string | null }>;
  getDraft: (
    filePath: string
  ) => { content: string; headContent: string | null } | undefined;
}

export function useBankFormatSearch(params: {
  allFormatFiles: string[];
  changedFormatFiles: Set<string>;
  draftStore: SearchDraftStore;
  formatSearch: string;
  formatTab: "all" | "recent" | "intersections";
  bankPath: string;
  prNumber: number | null;
  repository: { owner: string; repo: string };
  sourceHeadSha: string | null;
}) {
  const {
    allFormatFiles,
    changedFormatFiles,
    draftStore,
    formatSearch,
    formatTab,
    bankPath,
    prNumber,
    repository,
    sourceHeadSha,
  } = params;
  const searchSessionId = `${repository.owner}/${repository.repo}:${sourceHeadSha ?? ""}:${bankPath}`;
  const [searchIndex, setSearchIndex] = useState({
    sessionId: searchSessionId,
    docs: new Map<string, FormatSearchDoc>(),
  });
  const searchDocsByPath = useMemo(
    () =>
      searchIndex.sessionId === searchSessionId
        ? searchIndex.docs
        : new Map<string, FormatSearchDoc>(),
    [searchIndex, searchSessionId]
  );
  const [indexingInFlight, setIndexingInFlight] = useState(0);
  const [indexingErrors, setIndexingErrors] = useState(0);
  const indexingSessionRef = useRef("");
  const inFlightSearchPathsRef = useRef(new Set<string>());

  useEffect(() => {
    indexingSessionRef.current = searchSessionId;
    inFlightSearchPathsRef.current.clear();
    setIndexingInFlight(0);
    setIndexingErrors(0);
  }, [searchSessionId]);

  useEffect(() => {
    setSearchIndex((prev) => ({
      sessionId: searchSessionId,
      docs: syncSearchDocs({
        previousDocs:
          prev.sessionId === searchSessionId ? prev.docs : new Map(),
        formatPaths: allFormatFiles,
        draftStore,
      }),
    }));
  }, [allFormatFiles, draftStore, draftStore.drafts, searchSessionId]);

  const activeSearchScope = allFormatFiles;
  const shouldIndexExamples = shouldStartExampleIndexing(
    formatSearch,
    formatTab
  );

  const loadRemoteSearchDoc = useCallback(
    async (path: string, sessionId: string) => {
      if (!(prNumber && sourceHeadSha)) {
        return;
      }
      try {
        const headContent = await loadFileContent({
          repository,
          filePath: path,
          commitSha: sourceHeadSha,
        });
        if (indexingSessionRef.current !== sessionId) {
          return;
        }
        const exampleText = extractExamplesForSearch(headContent, path);
        setSearchIndex((prev) =>
          prev.sessionId === sessionId &&
          prev.docs.get(path)?.source !== "draft"
            ? {
                ...prev,
                docs: upsertRemoteSearchDoc(prev.docs, path, exampleText),
              }
            : prev
        );
      } catch {
        if (indexingSessionRef.current !== sessionId) {
          return;
        }
        setSearchIndex((prev) =>
          prev.sessionId === sessionId &&
          prev.docs.get(path)?.source !== "draft"
            ? { ...prev, docs: upsertRemoteErrorDoc(prev.docs, path) }
            : prev
        );
        setIndexingErrors((prev) => prev + 1);
      } finally {
        if (indexingSessionRef.current === sessionId) {
          inFlightSearchPathsRef.current.delete(path);
          setIndexingInFlight((prev) => Math.max(prev - 1, 0));
        }
      }
    },
    [prNumber, repository, sourceHeadSha]
  );

  useEffect(() => {
    if (!(shouldIndexExamples && prNumber && sourceHeadSha)) {
      return;
    }

    const availableSlots =
      SEARCH_INDEX_PARALLELISM - inFlightSearchPathsRef.current.size;
    if (availableSlots <= 0) {
      return;
    }

    const pendingPaths = activeSearchScope.filter((path) => {
      if (inFlightSearchPathsRef.current.has(path)) {
        return false;
      }
      if (draftStore.getDraft(path)) {
        return false;
      }
      const doc = searchDocsByPath.get(path);
      return !doc?.isLoaded;
    });
    if (pendingPaths.length === 0) {
      return;
    }

    const sessionId = indexingSessionRef.current;
    const batch = pendingPaths.slice(0, availableSlots);
    for (const path of batch) {
      inFlightSearchPathsRef.current.add(path);
      setIndexingInFlight((prev) => prev + 1);
      void loadRemoteSearchDoc(path, sessionId);
    }
  }, [
    activeSearchScope,
    draftStore,
    draftStore.drafts,
    loadRemoteSearchDoc,
    searchDocsByPath,
    shouldIndexExamples,
    prNumber,
    sourceHeadSha,
  ]);

  const indexedScopeSummary = useMemo(() => {
    let loadedCount = 0;
    for (const path of activeSearchScope) {
      const draft = draftStore.getDraft(path);
      if (draft) {
        loadedCount += 1;
        continue;
      }
      if (searchDocsByPath.get(path)?.isLoaded) {
        loadedCount += 1;
      }
    }
    return {
      loadedCount,
      total: activeSearchScope.length,
    };
  }, [activeSearchScope, draftStore, draftStore.drafts, searchDocsByPath]);

  const filteredFormatFiles = useMemo(
    () =>
      searchFormatPaths({
        formatPaths: allFormatFiles,
        query: formatSearch,
        docsByPath: searchDocsByPath,
        changedFormatFiles,
      }),
    [allFormatFiles, changedFormatFiles, formatSearch, searchDocsByPath]
  );

  return {
    filteredFormatFiles,
    shouldIndexExamples,
    indexedScopeSummary,
    indexingInFlight,
    indexingErrors,
  };
}
