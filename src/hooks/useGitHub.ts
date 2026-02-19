import { useQuery } from "@tanstack/react-query";
import { useEffect } from "react";
import { config } from "@/config";
import {
  fetchBranches,
  fetchBranchSha,
  fetchFileContent,
  fetchOpenPRs,
  fetchPullRequestFiles,
  fetchPullRequestHead,
  fetchRepoTree,
  fetchSourceRepoForks,
  fetchStartableIssues,
  indexBanksFromTree,
  refreshPullRequestApprovalPermission,
} from "@/domain/github";
import type { RepoRef } from "@/domain/types";
import { useSourceStore } from "@/store";

const SOURCE_CACHE_STALE_MS = 10 * 60_000;
const SOURCE_CACHE_GC_MS = 30 * 60_000;

function repoKey(repository: RepoRef): string {
  return `${repository.owner}/${repository.repo}`;
}

export function useBranches(enabled = true) {
  const repository = useSourceStore((s) => s.repository);
  return useQuery({
    queryKey: ["branches", repoKey(repository)],
    queryFn: () => fetchBranches(repository),
    enabled,
    staleTime: SOURCE_CACHE_STALE_MS,
    gcTime: SOURCE_CACHE_GC_MS,
  });
}

export function useOpenPRs(enabled = true) {
  const repository = useSourceStore((s) => s.repository);
  return useQuery({
    queryKey: ["open-prs", repoKey(repository)],
    queryFn: () => fetchOpenPRs(repository),
    enabled,
    staleTime: SOURCE_CACHE_STALE_MS,
    gcTime: SOURCE_CACHE_GC_MS,
  });
}

export function useStartableIssues(enabled = true) {
  const repository = useSourceStore((s) => s.repository);
  return useQuery({
    queryKey: ["startable-issues", repoKey(repository)],
    queryFn: () => fetchStartableIssues(repository),
    enabled,
    staleTime: SOURCE_CACHE_STALE_MS,
    gcTime: SOURCE_CACHE_GC_MS,
  });
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

export function useRepoTree(sha: string | undefined) {
  const repository = useSourceStore((s) => s.repository);
  const query = useQuery({
    queryKey: ["tree", repoKey(repository), sha],
    queryFn: async () => {
      if (!sha) {
        throw new Error("No sha");
      }
      const tree = await fetchRepoTree(sha, repository);
      const banks = indexBanksFromTree(tree);
      return { tree, banks };
    },
    enabled: !!sha,
    staleTime: 5 * 60_000,
  });

  useEffect(() => {
    if (!query.data) {
      return;
    }
    useSourceStore.getState().setTree(query.data.tree);
    useSourceStore.getState().setBanks(query.data.banks);
  }, [query.data]);

  return query;
}

export function useFileContent(
  path: string | undefined,
  ref: string | undefined
) {
  const repository = useSourceStore((s) => s.repository);
  return useQuery({
    queryKey: ["file", repoKey(repository), path, ref],
    queryFn: async () => {
      if (!(path && ref)) {
        throw new Error("Missing path or ref");
      }
      return fetchFileContent(path, ref, repository);
    },
    enabled: !!path && !!ref,
    staleTime: 5 * 60_000,
  });
}

export function useSwitchSource() {
  const repository = useSourceStore((s) => s.repository);
  const setSource = useSourceStore((s) => s.setSource);
  const setSourceChangedFiles = useSourceStore((s) => s.setSourceChangedFiles);
  const setLoading = useSourceStore((s) => s.setLoading);
  const setError = useSourceStore((s) => s.setError);
  const setTree = useSourceStore((s) => s.setTree);
  const setBanks = useSourceStore((s) => s.setBanks);

  return async (
    type: "branch" | "pr",
    name: string,
    prNumber?: number,
    shaHint?: string
  ) => {
    setLoading(true);
    try {
      let sha = shaHint;
      let changedFiles: string[] = [];

      if (type === "pr" && prNumber) {
        if (!sha) {
          const prHead = await fetchPullRequestHead(prNumber, repository);
          sha = prHead.headSha;
          name = prHead.headRef;
        }
        changedFiles = await fetchPullRequestFiles(prNumber, repository);
      }

      if (!sha) {
        sha = await fetchBranchSha(name, repository);
      }

      setSource({ type, name, sha, prNumber });
      const tree = await fetchRepoTree(sha, repository);
      const banks = indexBanksFromTree(tree);
      setTree(tree);
      setBanks(banks);
      setSourceChangedFiles(changedFiles);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to switch source");
    } finally {
      setLoading(false);
    }
  };
}

export function useSwitchRepository() {
  const currentRepository = useSourceStore((s) => s.repository);
  const setRepository = useSourceStore((s) => s.setRepository);
  const setSource = useSourceStore((s) => s.setSource);
  const setSourceChangedFiles = useSourceStore((s) => s.setSourceChangedFiles);
  const setLoading = useSourceStore((s) => s.setLoading);
  const setError = useSourceStore((s) => s.setError);
  const setTree = useSourceStore((s) => s.setTree);
  const setBanks = useSourceStore((s) => s.setBanks);

  return async (nextRepository: RepoRef) => {
    if (
      nextRepository.owner === currentRepository.owner &&
      nextRepository.repo === currentRepository.repo
    ) {
      return;
    }

    setLoading(true);
    try {
      await refreshPullRequestApprovalPermission(nextRepository);
      const sha = await fetchBranchSha(config.defaultBranch, nextRepository);
      const tree = await fetchRepoTree(sha, nextRepository);
      const banks = indexBanksFromTree(tree);

      setRepository(nextRepository);
      setSource({ type: "branch", name: config.defaultBranch, sha });
      setSourceChangedFiles([]);
      setTree(tree);
      setBanks(banks);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to switch repository");
    } finally {
      setLoading(false);
    }
  };
}

export function useInitMainBranch() {
  const repository = useSourceStore((s) => s.repository);
  const setSource = useSourceStore((s) => s.setSource);
  const setSourceChangedFiles = useSourceStore((s) => s.setSourceChangedFiles);
  const setLoading = useSourceStore((s) => s.setLoading);
  const setError = useSourceStore((s) => s.setError);
  const setTree = useSourceStore((s) => s.setTree);
  const setBanks = useSourceStore((s) => s.setBanks);
  const sourceRef = useSourceStore((s) => s.sourceRef);

  return async () => {
    if (sourceRef) {
      return; // Already initialized
    }
    setLoading(true);
    try {
      const sha = await fetchBranchSha(config.defaultBranch, repository);
      setSource({ type: "branch", name: config.defaultBranch, sha });
      setSourceChangedFiles([]);
      const tree = await fetchRepoTree(sha, repository);
      const banks = indexBanksFromTree(tree);
      setTree(tree);
      setBanks(banks);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load main branch");
    } finally {
      setLoading(false);
    }
  };
}
