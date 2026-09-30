import { useQuery } from "@tanstack/react-query";
import { useSyncExternalStore } from "react";
import type { RepoRef } from "@/domain/types";
import {
  fetchOpenPRs,
  fetchPullRequestMetadata,
  fetchSourceRepoForks,
  getGitHubAuthChangeVersion,
  subscribeGitHubAuthChange,
} from "@/infrastructure/github";
import { useDraftStore, useSourceStore } from "@/store";
import { clearWorkspaceSession } from "@/store/workspace-session";

const SOURCE_CACHE_STALE_MS = 10 * 60_000;
const SOURCE_CACHE_GC_MS = 30 * 60_000;

function repoKey(repository: RepoRef): string {
  return `${repository.owner}/${repository.repo}`;
}

export function openPrsQueryKey(repository: RepoRef) {
  return ["open-prs", repoKey(repository)] as const;
}

export type OpenPullRequests = Awaited<ReturnType<typeof fetchOpenPRs>>;

export function useOpenPRs(enabled = true) {
  const repository = useSourceStore((state) => state.repository);
  const list = useQuery({
    queryKey: openPrsQueryKey(repository),
    queryFn: () => fetchOpenPRs(repository),
    enabled,
    staleTime: SOURCE_CACHE_STALE_MS,
    gcTime: SOURCE_CACHE_GC_MS,
  });
  const authVersion = useSyncExternalStore(
    subscribeGitHubAuthChange,
    getGitHubAuthChangeVersion,
    getGitHubAuthChangeVersion
  );
  const metadata = useQuery({
    queryKey: [
      "open-pr-metadata",
      repoKey(repository),
      authVersion,
      list.data?.map((pr) => `${pr.number}:${pr.headSha}`),
    ],
    queryFn: async () => {
      const prs = list.data ?? [];
      const result: OpenPullRequests = [];
      for (let start = 0; start < prs.length; start += 4) {
        result.push(
          ...(await Promise.all(
            prs
              .slice(start, start + 4)
              .map((pr) => fetchPullRequestMetadata(pr, repository))
          ))
        );
      }
      return result;
    },
    enabled: enabled && Boolean(list.data?.length),
    staleTime: 30_000,
    retry: false,
  });
  return { ...list, data: metadata.data ?? list.data };
}

export function useAvailableSourceRepos(enabled = true) {
  return useQuery({
    queryKey: ["source-repositories"],
    queryFn: fetchSourceRepoForks,
    enabled,
    staleTime: SOURCE_CACHE_STALE_MS,
    gcTime: SOURCE_CACHE_GC_MS,
  });
}

export function useSwitchRepository() {
  const currentRepository = useSourceStore((state) => state.repository);
  const clearDrafts = useDraftStore((state) => state.clearAll);
  const setRepository = useSourceStore((state) => state.setRepository);
  const setSource = useSourceStore((state) => state.setSource);
  const setTree = useSourceStore((state) => state.setTree);
  const setBanks = useSourceStore((state) => state.setBanks);
  const setError = useSourceStore((state) => state.setError);

  return async (nextRepository: RepoRef) => {
    if (
      nextRepository.owner === currentRepository.owner &&
      nextRepository.repo === currentRepository.repo
    ) {
      return;
    }

    clearDrafts();
    clearWorkspaceSession();
    setRepository(nextRepository);
    setSource(null);
    setTree([]);
    setBanks([]);
    setError(null);
  };
}
