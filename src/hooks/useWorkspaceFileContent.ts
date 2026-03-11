import { useEffect, useMemo } from "react";
import { useSourceStore } from "@/store";
import { useFileContentStore } from "@/store/file-content-store";

export function useWorkspaceFileContent(params: {
  filePath: string;
  loadedFrom: "editor" | "search-index";
  contentRefName?: string;
}) {
  const { filePath, loadedFrom, contentRefName } = params;
  const repository = useSourceStore((state) => state.repository);
  const sourceRef = useSourceStore((state) => state.sourceRef);
  const prNumber =
    sourceRef?.type === "pr" && sourceRef.prNumber ? sourceRef.prNumber : null;
  const headSha = sourceRef?.sha ?? null;
  const refName = contentRefName ?? sourceRef?.sha ?? sourceRef?.name ?? null;

  const entry = useFileContentStore(
    useMemo(
      () => (state) =>
        prNumber
          ? state.getFileContentEntry({
              repository,
              prNumber,
              filePath,
            })
          : undefined,
      [filePath, prNumber, repository]
    )
  );

  const data =
    prNumber && headSha
      ? (useFileContentStore
          .getState()
          .getCachedFileContent({ repository, prNumber, filePath, headSha }) ??
        undefined)
      : undefined;

  useEffect(() => {
    if (!(prNumber && headSha && refName) || typeof data === "string") {
      return;
    }
    if (entry?.status === "loading" && entry.lastResolvedHeadSha === headSha) {
      return;
    }
    void useFileContentStore.getState().primeFileContent({
      repository,
      prNumber,
      filePath,
      refName,
      headSha,
      loadedFrom,
    });
  }, [
    data,
    entry?.lastResolvedHeadSha,
    entry?.status,
    filePath,
    headSha,
    loadedFrom,
    prNumber,
    refName,
    repository,
  ]);

  return {
    data,
    isLoading:
      Boolean(prNumber && headSha && refName) &&
      typeof data !== "string" &&
      entry?.status !== "error",
    error:
      entry?.lastResolvedHeadSha === headSha && entry?.status === "error"
        ? entry.error
        : null,
  };
}
