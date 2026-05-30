import { create } from "zustand";
import { fetchFileContent } from "@/domain/github";
import type { RepoRef } from "@/domain/types";

export type FileContentLoadSource =
  | "editor"
  | "quick-check"
  | "validation"
  | "search-index"
  | "prefetch";

export type FileContentEntryStatus = "loading" | "ready" | "error";

export interface FileContentEntry {
  repository: RepoRef;
  prNumber: number;
  filePath: string;
  content: string;
  lastResolvedHeadSha: string;
  status: FileContentEntryStatus;
  loadedAt: number;
  loadedFrom: FileContentLoadSource;
  error: string | null;
}

interface FileContentKeyParams {
  repository: RepoRef;
  prNumber: number;
  filePath: string;
}

interface PrimeFileContentParams extends FileContentKeyParams {
  refName: string;
  headSha: string;
  loadedFrom: FileContentLoadSource;
}

interface PrimeFileContentsParams {
  repository: RepoRef;
  prNumber: number;
  filePaths: string[];
  refName: string;
  headSha: string;
  loadedFrom: FileContentLoadSource;
}

interface PrimeFileContentsResult {
  cachedCount: number;
  remoteFetchedCount: number;
  loadErrorsCount: number;
}

interface FileContentStoreState {
  entries: Record<string, FileContentEntry>;
  getFileContentEntry: (
    params: FileContentKeyParams
  ) => FileContentEntry | undefined;
  getCachedFileContent: (
    params: FileContentKeyParams & { headSha: string }
  ) => string | undefined;
  setFileContentEntry: (
    params: FileContentKeyParams & {
      content: string;
      lastResolvedHeadSha: string;
      loadedFrom: FileContentLoadSource;
      status: FileContentEntryStatus;
      error?: string | null;
    }
  ) => void;
  primeFileContent: (params: PrimeFileContentParams) => Promise<string | null>;
  primeFileContents: (
    params: PrimeFileContentsParams
  ) => Promise<PrimeFileContentsResult>;
  invalidatePullRequestFileContents: (params: {
    repository: RepoRef;
    prNumber: number;
  }) => void;
}

const inFlightRequests = new Map<string, Promise<string | null>>();

function buildRepoSlug(repository: RepoRef): string {
  return `${repository.owner}/${repository.repo}`;
}

export function buildFileContentCacheKey(params: FileContentKeyParams): string {
  const { repository, prNumber, filePath } = params;
  return `${buildRepoSlug(repository)}:pr:${prNumber}:${filePath}`;
}

function buildInFlightKey(params: PrimeFileContentParams): string {
  return `${buildFileContentCacheKey(params)}:${params.headSha}`;
}

function isEntryFresh(entry: FileContentEntry | undefined, headSha: string) {
  return entry?.status === "ready" && entry.lastResolvedHeadSha === headSha;
}

export const useFileContentStore = create<FileContentStoreState>(
  (set, get) => ({
    entries: {},

    getFileContentEntry: (params) =>
      get().entries[buildFileContentCacheKey(params)],

    getCachedFileContent: (params) => {
      const entry = get().getFileContentEntry(params);
      return entry && isEntryFresh(entry, params.headSha)
        ? entry.content
        : undefined;
    },

    setFileContentEntry: ({
      repository,
      prNumber,
      filePath,
      content,
      lastResolvedHeadSha,
      loadedFrom,
      status,
      error = null,
    }) => {
      const key = buildFileContentCacheKey({ repository, prNumber, filePath });
      set((state) => ({
        entries: {
          ...state.entries,
          [key]: {
            repository,
            prNumber,
            filePath,
            content,
            lastResolvedHeadSha,
            status,
            loadedAt: Date.now(),
            loadedFrom,
            error,
          },
        },
      }));
    },

    primeFileContent: async ({
      repository,
      prNumber,
      filePath,
      refName,
      headSha,
      loadedFrom,
    }) => {
      const params = {
        repository,
        prNumber,
        filePath,
        refName,
        headSha,
        loadedFrom,
      };
      const cached = get().getCachedFileContent({
        repository,
        prNumber,
        filePath,
        headSha,
      });
      if (typeof cached === "string") {
        return cached;
      }

      const inFlightKey = buildInFlightKey(params);
      const existingRequest = inFlightRequests.get(inFlightKey);
      if (existingRequest) {
        return existingRequest;
      }

      get().setFileContentEntry({
        repository,
        prNumber,
        filePath,
        content: "",
        lastResolvedHeadSha: headSha,
        loadedFrom,
        status: "loading",
      });

      const request = fetchFileContent(filePath, refName, repository)
        .then((content) => {
          get().setFileContentEntry({
            repository,
            prNumber,
            filePath,
            content,
            lastResolvedHeadSha: headSha,
            loadedFrom,
            status: "ready",
          });
          return content;
        })
        .catch((error) => {
          get().setFileContentEntry({
            repository,
            prNumber,
            filePath,
            content: "",
            lastResolvedHeadSha: headSha,
            loadedFrom,
            status: "error",
            error: error instanceof Error ? error.message : "unknown",
          });
          return null;
        })
        .finally(() => {
          inFlightRequests.delete(inFlightKey);
        });

      inFlightRequests.set(inFlightKey, request);
      return request;
    },

    primeFileContents: async ({
      repository,
      prNumber,
      filePaths,
      refName,
      headSha,
      loadedFrom,
    }) => {
      const uniquePaths = Array.from(new Set(filePaths));
      const cachedPaths = uniquePaths.filter(
        (filePath) =>
          typeof get().getCachedFileContent({
            repository,
            prNumber,
            filePath,
            headSha,
          }) === "string"
      );
      const pathsToFetch = uniquePaths.filter(
        (filePath) => !cachedPaths.includes(filePath)
      );

      const results = await Promise.all(
        pathsToFetch.map((filePath) =>
          get().primeFileContent({
            repository,
            prNumber,
            filePath,
            refName,
            headSha,
            loadedFrom,
          })
        )
      );

      return {
        cachedCount: cachedPaths.length,
        remoteFetchedCount: pathsToFetch.filter(
          (_, index) => results[index] !== null
        ).length,
        loadErrorsCount: results.filter((result) => result === null).length,
      };
    },

    invalidatePullRequestFileContents: ({ repository, prNumber }) => {
      const prefix = `${buildRepoSlug(repository)}:pr:${prNumber}:`;
      set((state) => {
        const nextEntries = { ...state.entries };
        for (const key of Object.keys(nextEntries)) {
          if (key.startsWith(prefix)) {
            delete nextEntries[key];
          }
        }
        return {
          entries: nextEntries,
        };
      });
    },
  })
);
