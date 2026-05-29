import { cleanText, parseFormatFile } from "@/domain/format";
import type { RepoRef } from "@/domain/types";
import { useFileContentStore } from "@/store/file-content-store";

export type RegexSource = "draft" | "remote";

export interface CachedFormatEntry {
  filePath: string;
  fileName: string;
  regex: string;
  examples: string[];
  source: RegexSource;
  fingerprint: string;
}

export interface DraftEntryLike {
  content: string;
  isDeleted?: boolean;
  timestamp: number;
}

export interface DraftStoreLike {
  getDraft: (filePath: string) => DraftEntryLike | undefined;
}

export interface PreparedFormatEntries {
  entries: CachedFormatEntry[];
  loadErrorsCount: number;
  remoteFetchedCount: number;
  cachedCount: number;
}

interface LocalFormatPreparation {
  preparedEntries: CachedFormatEntry[];
  remotePathsToLoad: string[];
}

function extractFormatFileName(path: string): string {
  return path.split("/").pop() ?? path;
}

function parseFormatEntry(params: {
  filePath: string;
  content: string;
  source: RegexSource;
  fingerprint: string;
}): CachedFormatEntry {
  const { filePath, content, source, fingerprint } = params;
  const parsed = parseFormatFile(content, filePath);

  return {
    filePath,
    fileName: extractFormatFileName(filePath),
    regex: parsed.regex.trim(),
    examples: parsed.examples.filter((ex) => cleanText(ex) !== ""),
    source,
    fingerprint,
  };
}

function collectLocalFormatEntries(params: {
  filePaths: string[];
  draftStore: DraftStoreLike;
}): LocalFormatPreparation {
  const { filePaths, draftStore } = params;
  const preparedEntries: CachedFormatEntry[] = [];
  const remotePathsToLoad: string[] = [];

  for (const filePath of filePaths) {
    const draft = draftStore.getDraft(filePath);
    if (draft) {
      if (draft.isDeleted) {
        continue;
      }

      const parsedDraftEntry = parseFormatEntry({
        filePath,
        content: draft.content,
        source: "draft",
        fingerprint: `draft:${draft.timestamp}`,
      });
      preparedEntries.push(parsedDraftEntry);
      continue;
    }

    remotePathsToLoad.push(filePath);
  }

  return {
    preparedEntries,
    remotePathsToLoad,
  };
}

export async function prepareFormatEntries(params: {
  filePaths: string[];
  draftStore: DraftStoreLike;
  prNumber: number;
  sourceRefName: string;
  repository: RepoRef;
}): Promise<PreparedFormatEntries> {
  const { filePaths, draftStore, prNumber, sourceRefName, repository } = params;

  const localPreparation = collectLocalFormatEntries({
    filePaths,
    draftStore,
  });
  const remoteLoad = await useFileContentStore.getState().primeFileContents({
    repository,
    prNumber,
    filePaths: localPreparation.remotePathsToLoad,
    refName: sourceRefName,
    headSha: sourceRefName,
    loadedFrom: "quick-check",
  });
  const remoteEntries = localPreparation.remotePathsToLoad.flatMap(
    (filePath) => {
      const content = useFileContentStore.getState().getCachedFileContent({
        repository,
        prNumber,
        filePath,
        headSha: sourceRefName,
      });
      if (typeof content !== "string") {
        return [];
      }
      return [
        parseFormatEntry({
          filePath,
          content,
          source: "remote",
          fingerprint: `remote:${sourceRefName}`,
        }),
      ];
    }
  );

  return {
    entries: [...localPreparation.preparedEntries, ...remoteEntries],
    loadErrorsCount: remoteLoad.loadErrorsCount,
    remoteFetchedCount: remoteLoad.remoteFetchedCount,
    cachedCount: remoteLoad.cachedCount,
  };
}
