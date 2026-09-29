import { useEffect } from "react";

export function useAutoSelectFormat(params: {
  workspaceReady: boolean;
  requestedFile: string | null;
  allFormatFiles: string[];
  sendersPath: string;
  preferredFormatFile: string | null;
  selectionReady: boolean;
  onSelectFile: (filePath: string | null, replace?: boolean) => void;
}) {
  const {
    workspaceReady,
    requestedFile,
    allFormatFiles,
    sendersPath,
    preferredFormatFile,
    selectionReady,
    onSelectFile,
  } = params;

  useEffect(() => {
    const nextSelection = resolveAutoSelectFile({
      workspaceReady,
      selectionReady,
      requestedFile,
      allFormatFiles,
      sendersPath,
      preferredFormatFile,
    });
    if (typeof nextSelection === "undefined") {
      return;
    }
    onSelectFile(nextSelection, true);
  }, [
    allFormatFiles,
    onSelectFile,
    preferredFormatFile,
    requestedFile,
    selectionReady,
    sendersPath,
    workspaceReady,
  ]);
}

export function resolveAutoSelectFile(params: {
  workspaceReady: boolean;
  selectionReady: boolean;
  requestedFile: string | null;
  allFormatFiles: string[];
  sendersPath: string;
  preferredFormatFile: string | null;
}): string | null | undefined {
  const {
    workspaceReady,
    selectionReady,
    requestedFile,
    allFormatFiles,
    sendersPath,
    preferredFormatFile,
  } = params;
  if (!(workspaceReady && selectionReady)) {
    return undefined;
  }
  if (requestedFile === sendersPath) {
    return undefined;
  }
  if (requestedFile && allFormatFiles.includes(requestedFile)) {
    return undefined;
  }
  if (!preferredFormatFile) {
    return requestedFile ? null : undefined;
  }
  return requestedFile !== preferredFormatFile
    ? preferredFormatFile
    : undefined;
}

export function buildSearchIndexingMeta(params: {
  shouldIndexExamples: boolean;
  indexedScopeSummary: { loadedCount: number; total: number };
  indexingInFlight: number;
  indexingErrors: number;
  t: (key: string, options?: Record<string, unknown>) => string;
}): { showSearchIndexStatus: boolean; searchIndexingLabel: string } {
  const {
    shouldIndexExamples,
    indexedScopeSummary,
    indexingInFlight,
    indexingErrors,
    t,
  } = params;
  const showSearchIndexStatus =
    shouldIndexExamples &&
    indexedScopeSummary.total > 0 &&
    (indexingInFlight > 0 ||
      indexedScopeSummary.loadedCount < indexedScopeSummary.total ||
      indexingErrors > 0);

  const searchIndexingLabel =
    indexingErrors > 0
      ? t("bank.searchIndexingWithErrors", {
          loaded: indexedScopeSummary.loadedCount,
          total: indexedScopeSummary.total,
          errors: indexingErrors,
        })
      : t("bank.searchIndexing", {
          loaded: indexedScopeSummary.loadedCount,
          total: indexedScopeSummary.total,
        });

  return {
    showSearchIndexStatus,
    searchIndexingLabel,
  };
}
