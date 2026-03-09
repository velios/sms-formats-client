import { parseFormatFile } from "@/domain/format";
import { fetchFileContent } from "@/domain/github";
import type { RepoRef } from "@/domain/types";

const QUICK_CHECK_PARALLELISM = 4;

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
  cachedCount: number;
}

interface RemoteLoadResult {
  entries: CachedFormatEntry[];
  loadErrorsCount: number;
}

export const sharedFormatEntryCache = new Map<string, CachedFormatEntry>();

function extractFormatFileName(path: string): string {
  return path.split("/").pop() ?? path;
}

function buildDraftFingerprint(timestamp: number): string {
  return `draft:${timestamp}`;
}

function buildRemoteFingerprint(refName: string): string {
  return `remote:${refName}`;
}

function buildCacheKey(repository: RepoRef, filePath: string): string {
  return `${repository.owner}/${repository.repo}:${filePath}`;
}

function normalizeExampleText(value: string): string {
  return value.trim();
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
    examples: parsed.examples.map(normalizeExampleText).filter(Boolean),
    source,
    fingerprint,
  };
}

function collectLocalFormatEntries(params: {
  filePaths: string[];
  draftStore: DraftStoreLike;
  cache: Map<string, CachedFormatEntry>;
  sourceRefName: string;
  repository: RepoRef;
}): LocalFormatPreparation {
  const { filePaths, draftStore, cache, sourceRefName, repository } = params;
  const preparedEntries: CachedFormatEntry[] = [];
  const remotePathsToLoad: string[] = [];
  let cachedCount = 0;

  for (const filePath of filePaths) {
    const cacheKey = buildCacheKey(repository, filePath);
    const draft = draftStore.getDraft(filePath);
    if (draft) {
      if (draft.isDeleted) {
        continue;
      }
      const draftFingerprint = buildDraftFingerprint(draft.timestamp);
      const cached = cache.get(cacheKey);
      if (cached && cached.fingerprint === draftFingerprint) {
        preparedEntries.push(cached);
        cachedCount += 1;
        continue;
      }

      const parsedDraftEntry = parseFormatEntry({
        filePath,
        content: draft.content,
        source: "draft",
        fingerprint: draftFingerprint,
      });
      cache.set(cacheKey, parsedDraftEntry);
      preparedEntries.push(parsedDraftEntry);
      continue;
    }

    const remoteFingerprint = buildRemoteFingerprint(sourceRefName);
    const cached = cache.get(cacheKey);
    if (cached && cached.fingerprint === remoteFingerprint) {
      preparedEntries.push(cached);
      cachedCount += 1;
      continue;
    }

    remotePathsToLoad.push(filePath);
  }

  return {
    preparedEntries,
    remotePathsToLoad,
    cachedCount,
  };
}

async function loadRemoteFormatEntries(params: {
  filePaths: string[];
  refName: string;
  repository: RepoRef;
  cache: Map<string, CachedFormatEntry>;
}): Promise<RemoteLoadResult> {
  const { filePaths, refName, repository, cache } = params;
  const fingerprint = buildRemoteFingerprint(refName);
  const queue = [...filePaths];
  const entries: CachedFormatEntry[] = [];
  let loadErrorsCount = 0;

  const workerCount = Math.min(QUICK_CHECK_PARALLELISM, queue.length);
  const workers = Array.from({ length: workerCount }, async () => {
    while (queue.length > 0) {
      const filePath = queue.shift();
      if (!filePath) {
        break;
      }

      try {
        const content = await fetchFileContent(filePath, refName, repository);
        const parsedEntry = parseFormatEntry({
          filePath,
          content,
          source: "remote",
          fingerprint,
        });
        cache.set(buildCacheKey(repository, filePath), parsedEntry);
        entries.push(parsedEntry);
      } catch {
        loadErrorsCount += 1;
      }
    }
  });

  await Promise.all(workers);
  return { entries, loadErrorsCount };
}

export async function prepareFormatEntries(params: {
  filePaths: string[];
  draftStore: DraftStoreLike;
  sourceRefName: string;
  repository: RepoRef;
  cache?: Map<string, CachedFormatEntry>;
}): Promise<PreparedFormatEntries> {
  const {
    filePaths,
    draftStore,
    sourceRefName,
    repository,
    cache = sharedFormatEntryCache,
  } = params;

  const localPreparation = collectLocalFormatEntries({
    filePaths,
    draftStore,
    cache,
    sourceRefName,
    repository,
  });
  const remoteLoad = await loadRemoteFormatEntries({
    filePaths: localPreparation.remotePathsToLoad,
    refName: sourceRefName,
    repository,
    cache,
  });

  return {
    entries: [...localPreparation.preparedEntries, ...remoteLoad.entries],
    loadErrorsCount: remoteLoad.loadErrorsCount,
    remoteFetchedCount: localPreparation.remotePathsToLoad.length,
    cachedCount: localPreparation.cachedCount,
  };
}
