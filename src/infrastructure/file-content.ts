import { queryOptions } from "@tanstack/react-query";
import type { RepoRef } from "@/domain/types";
import { fetchFileContent } from "@/infrastructure/github";
import { queryClient } from "@/lib/query-client";

export interface FileRevision {
  repository: RepoRef;
  filePath: string;
  commitSha: string;
}

// Cache only immutable commit SHAs.
export function fileContentOptions({
  repository,
  filePath,
  commitSha,
}: FileRevision) {
  return queryOptions({
    queryKey: [
      "file-content",
      repository.owner,
      repository.repo,
      commitSha,
      filePath,
    ],
    queryFn: () => fetchFileContent(filePath, commitSha, repository),
    staleTime: Number.POSITIVE_INFINITY,
    gcTime: 30 * 60_000,
    retry: false,
  });
}

export function getFileContent(params: FileRevision): string | undefined {
  return queryClient.getQueryData(fileContentOptions(params).queryKey);
}

export function cacheFileContent(
  params: FileRevision & { content: string }
): void {
  queryClient.setQueryData(fileContentOptions(params).queryKey, params.content);
}

export function loadFileContent(params: FileRevision): Promise<string> {
  return queryClient.fetchQuery(fileContentOptions(params));
}

export async function loadFileContents(
  params: Omit<FileRevision, "filePath"> & { filePaths: string[] }
) {
  const contents = new Map<string, string>();
  let cachedCount = 0;
  const paths = [...new Set(params.filePaths)];
  for (let start = 0; start < paths.length; start += 4) {
    await Promise.all(
      paths.slice(start, start + 4).map(async (filePath) => {
        const revision = { ...params, filePath };
        if (getFileContent(revision) !== undefined) {
          cachedCount += 1;
        }
        contents.set(filePath, await loadFileContent(revision));
      })
    );
  }
  return {
    contents,
    cachedCount,
    remoteFetchedCount: paths.length - cachedCount,
  };
}

export async function loadRevisionBlobs(
  commitSha: string,
  filePaths: string[],
  repository: RepoRef,
  fetchBlobs: typeof import("./github").fetchBlobsByRef
): Promise<import("./github").BlobFetchResult[]> {
  const paths = [...new Set(filePaths)];
  const pendingPaths = paths.filter((filePath) => {
    const state = queryClient.getQueryState(
      fileContentOptions({ repository, filePath, commitSha }).queryKey
    );
    return state?.data === undefined && state?.fetchStatus !== "fetching";
  });
  let batch: ReturnType<typeof fetchBlobs> | undefined;
  const loadBatch = () =>
    (batch ??= fetchBlobs(commitSha, pendingPaths, repository));
  return Promise.all(
    paths.map(async (filePath) => {
      let skipped: import("./github").BlobFetchResult | undefined;
      try {
        const text = await queryClient.fetchQuery({
          ...fileContentOptions({ repository, filePath, commitSha }),
          queryFn: async () => {
            const result = (await loadBatch()).find(
              (item) => item.path === filePath
            );
            if (result?.status === "loaded") {
              return result.text;
            }
            skipped = result ?? { path: filePath, status: "missing" };
            throw new Error(`File is unavailable: ${filePath}`);
          },
        });
        return { path: filePath, status: "loaded" as const, text };
      } catch (error) {
        if (skipped) {
          return skipped;
        }
        throw error;
      }
    })
  );
}
