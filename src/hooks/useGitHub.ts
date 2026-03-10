import { useQuery } from "@tanstack/react-query";
import { useEffect } from "react";
import { config } from "@/config";
import {
  fetchBranches,
  fetchBranchSha,
  fetchFileContent,
  fetchOpenPRs,
  fetchPullRequestCommits,
  fetchPullRequestFiles,
  fetchPullRequestHead,
  fetchRepoTree,
  fetchSourceRepoForks,
  indexBanksFromTree,
  refreshPullRequestApprovalPermission,
} from "@/domain/github";
import type { RepoRef, SourceRef } from "@/domain/types";
import { isSameDraftScope, makeDraftSourceKey } from "@/store/draft-scope";
import { useDraftStore, useSourceStore } from "@/store";
import {
  clearWorkspaceSelection,
  loadWorkspaceSelection,
  saveWorkspaceSelection,
} from "@/store/workspace-session";

const SOURCE_CACHE_STALE_MS = 10 * 60_000;
const SOURCE_CACHE_GC_MS = 30 * 60_000;

function repoKey(repository: RepoRef): string {
  return `${repository.owner}/${repository.repo}`;
}

function shouldResetDraftsOnSourceSwitch(params: {
  currentSource: ReturnType<typeof useSourceStore.getState>["sourceRef"];
  type: "branch" | "pr";
  name: string;
  prNumber?: number;
  shaHint?: string;
}): boolean {
  const { currentSource, type, name, prNumber } = params;
  return !isSameDraftScope(currentSource, {
    type,
    name,
    prNumber,
  });
}

async function resolveSourceData(params: {
  repository: RepoRef;
  type: "branch" | "pr";
  name: string;
  prNumber?: number;
  shaHint?: string;
}): Promise<{
  banks: ReturnType<typeof indexBanksFromTree>;
  changedFiles: string[];
  sourceRef: SourceRef;
  tree: Awaited<ReturnType<typeof fetchRepoTree>>;
}> {
  const { repository, type, prNumber, shaHint } = params;
  let { name } = params;
  let sha = shaHint;
  let changedFiles: string[] = [];

  if (type === "pr" && prNumber) {
    const prHead = await fetchPullRequestHead(prNumber, repository);
    name = prHead.headRef;
    if (!sha) {
      sha = prHead.headSha;
    }
    changedFiles = await fetchPullRequestFiles(prNumber, repository);
  }

  if (!sha) {
    sha = await fetchBranchSha(name, repository);
  }

  const sourceRef: SourceRef = { type, name, sha, prNumber };
  const tree = await fetchRepoTree(sha, repository);
  const banks = indexBanksFromTree(tree);

  return { banks, changedFiles, sourceRef, tree };
}

async function restoreDraftsForSource(
  sourceRef: SourceRef,
  repository: RepoRef
): Promise<void> {
  await useDraftStore
    .getState()
    .restoreFromDB(makeDraftSourceKey(sourceRef, repository));
}

function persistWorkspaceState(repository: RepoRef, sourceRef: SourceRef): void {
  saveWorkspaceSelection({ repository, sourceRef });
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

export function usePullRequestCommits(
  prNumber: number | undefined,
  enabled = true
) {
  const repository = useSourceStore((s) => s.repository);
  return useQuery({
    queryKey: ["pull-request-commits", repoKey(repository), prNumber],
    queryFn: async () => {
      if (!prNumber) {
        throw new Error("No pull request number");
      }
      return fetchPullRequestCommits(prNumber, repository);
    },
    enabled: enabled && !!prNumber,
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
  const sourceRef = useSourceStore((s) => s.sourceRef);
  const setSource = useSourceStore((s) => s.setSource);
  const setSourceChangedFiles = useSourceStore((s) => s.setSourceChangedFiles);
  const setLoading = useSourceStore((s) => s.setLoading);
  const setError = useSourceStore((s) => s.setError);
  const setTree = useSourceStore((s) => s.setTree);
  const setBanks = useSourceStore((s) => s.setBanks);
  const clearDrafts = useDraftStore((s) => s.clearAll);

  return async (
    type: "branch" | "pr",
    name: string,
    prNumber?: number,
    shaHint?: string
  ) => {
    if (
      shouldResetDraftsOnSourceSwitch({
        currentSource: sourceRef,
        type,
        name,
        prNumber,
        shaHint,
      })
    ) {
      clearDrafts();
    }
    setLoading(true);
    try {
      const nextSourceData = await resolveSourceData({
        repository,
        type,
        name,
        prNumber,
        shaHint,
      });

      await restoreDraftsForSource(nextSourceData.sourceRef, repository);
      setSource(nextSourceData.sourceRef);
      setTree(nextSourceData.tree);
      setBanks(nextSourceData.banks);
      setSourceChangedFiles(nextSourceData.changedFiles);
      persistWorkspaceState(repository, nextSourceData.sourceRef);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to switch source");
    } finally {
      setLoading(false);
    }
  };
}

export function useSwitchRepository() {
  const currentRepository = useSourceStore((s) => s.repository);
  const clearDrafts = useDraftStore((s) => s.clearAll);
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

    clearDrafts();
    setLoading(true);
    try {
      await refreshPullRequestApprovalPermission(nextRepository);
      const nextSourceData = await resolveSourceData({
        repository: nextRepository,
        type: "branch",
        name: config.defaultBranch,
      });

      await restoreDraftsForSource(nextSourceData.sourceRef, nextRepository);
      setRepository(nextRepository);
      setSource(nextSourceData.sourceRef);
      setSourceChangedFiles(nextSourceData.changedFiles);
      setTree(nextSourceData.tree);
      setBanks(nextSourceData.banks);
      persistWorkspaceState(nextRepository, nextSourceData.sourceRef);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to switch repository");
    } finally {
      setLoading(false);
    }
  };
}

export function useInitMainBranch() {
  const repository = useSourceStore((s) => s.repository);
  const setRepository = useSourceStore((s) => s.setRepository);
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
      const persistedSelection = loadWorkspaceSelection();
      const initialRepository = persistedSelection?.repository ?? repository;
      const selectedScopeRepository = persistedSelection?.repository ?? repository;
      const selectedScopeSource = persistedSelection?.sourceRef ?? {
        type: "branch" as const,
        name: config.defaultBranch,
        sha: "",
      };
      const nextSourceData = await resolveSourceData({
        repository: selectedScopeRepository,
        type: selectedScopeSource.type,
        name: selectedScopeSource.name,
        prNumber: selectedScopeSource.prNumber,
        shaHint: selectedScopeSource.sha,
      });

      await restoreDraftsForSource(
        nextSourceData.sourceRef,
        selectedScopeRepository
      );
      setRepository(initialRepository);
      setSource(nextSourceData.sourceRef);
      setSourceChangedFiles(nextSourceData.changedFiles);
      setTree(nextSourceData.tree);
      setBanks(nextSourceData.banks);
      persistWorkspaceState(selectedScopeRepository, nextSourceData.sourceRef);
    } catch (e) {
      clearWorkspaceSelection();
      setError(e instanceof Error ? e.message : "Failed to load main branch");
    } finally {
      setLoading(false);
    }
  };
}
