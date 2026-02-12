import { useQuery } from "@tanstack/react-query";
import { useEffect } from "react";
import { config } from "@/config";
import {
  fetchBranches,
  fetchBranchSha,
  fetchFileContent,
  fetchOpenPRs,
  fetchRepoTree,
  fetchStartableIssues,
  indexBanksFromTree,
} from "@/domain/github";
import { useSourceStore } from "@/store";

const SOURCE_CACHE_STALE_MS = 10 * 60_000;
const SOURCE_CACHE_GC_MS = 30 * 60_000;

export function useBranches(enabled = true) {
  return useQuery({
    queryKey: ["branches"],
    queryFn: fetchBranches,
    enabled,
    staleTime: SOURCE_CACHE_STALE_MS,
    gcTime: SOURCE_CACHE_GC_MS,
  });
}

export function useOpenPRs(enabled = true) {
  return useQuery({
    queryKey: ["open-prs"],
    queryFn: fetchOpenPRs,
    enabled,
    staleTime: SOURCE_CACHE_STALE_MS,
    gcTime: SOURCE_CACHE_GC_MS,
  });
}

export function useStartableIssues(enabled = true) {
  return useQuery({
    queryKey: ["startable-issues"],
    queryFn: fetchStartableIssues,
    enabled,
    staleTime: SOURCE_CACHE_STALE_MS,
    gcTime: SOURCE_CACHE_GC_MS,
  });
}

export function useRepoTree(sha: string | undefined) {
  const query = useQuery({
    queryKey: ["tree", sha],
    queryFn: async () => {
      if (!sha) {
        throw new Error("No sha");
      }
      const tree = await fetchRepoTree(sha);
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
  return useQuery({
    queryKey: ["file", path, ref],
    queryFn: async () => {
      if (!(path && ref)) {
        throw new Error("Missing path or ref");
      }
      return fetchFileContent(path, ref);
    },
    enabled: !!path && !!ref,
    staleTime: 5 * 60_000,
  });
}

export function useSwitchSource() {
  const setSource = useSourceStore((s) => s.setSource);
  const setLoading = useSourceStore((s) => s.setLoading);
  const setError = useSourceStore((s) => s.setError);
  const setTree = useSourceStore((s) => s.setTree);
  const setBanks = useSourceStore((s) => s.setBanks);

  return async (type: "branch" | "pr", name: string, prNumber?: number) => {
    setLoading(true);
    try {
      const sha = await fetchBranchSha(name);
      setSource({ type, name, sha, prNumber });
      const tree = await fetchRepoTree(sha);
      const banks = indexBanksFromTree(tree);
      setTree(tree);
      setBanks(banks);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to switch source");
    } finally {
      setLoading(false);
    }
  };
}

export function useInitMainBranch() {
  const setSource = useSourceStore((s) => s.setSource);
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
      const sha = await fetchBranchSha(config.defaultBranch);
      setSource({ type: "branch", name: config.defaultBranch, sha });
      const tree = await fetchRepoTree(sha);
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
