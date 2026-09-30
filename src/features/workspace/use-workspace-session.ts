import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
} from "react";
import type { useNavigate } from "react-router-dom";
import { indexBanksFromTree } from "@/domain/bank-index";
import {
  getLegacyRouteRedirectPath,
  parsePullRequestRouteParams,
} from "@/domain/bank-route";
import type { PullRequestWorkspaceResolution } from "@/domain/pull-request-workspace";
import type { PullRequestSource, RepoRef } from "@/domain/types";
import {
  fetchRepoTree,
  getGitHubAuthChangeVersion,
  resolvePullRequestWorkspace,
  subscribeGitHubAuthChange,
} from "@/infrastructure/github";
import {
  useDraftStore,
  useSourceStore,
  waitForDraftStoreHydration,
} from "@/store";
import { makeDraftSourceKey } from "@/store/draft-scope";
import {
  clearWorkspaceSession,
  loadWorkspaceSession,
  saveWorkspaceSession,
} from "@/store/workspace-session";

export function saveActiveRouteSession(
  repository: RepoRef,
  session: ActiveRouteSession
): void {
  saveWorkspaceSession({
    repository,
    prNumber: session.prNumber,
    headSha: session.headSha,
    baseSha: session.baseSha,
    bankPath: session.bankPath,
    writable: session.writable,
    readOnlyReason: session.readOnlyReason,
    changedFiles: session.changedFiles,
  });
}

export type ActiveRouteSession = Extract<
  PullRequestWorkspaceResolution,
  { status: "supported" }
>;

export function resolveWorkspaceRefresh(
  current: ActiveRouteSession,
  next: PullRequestWorkspaceResolution,
  hasDrafts: boolean
) {
  if (next.status !== "supported") {
    return "ignore";
  }
  if (next.headSha !== current.headSha) {
    return hasDrafts ? "stale" : "refresh";
  }
  return !next.writable && current.writable ? "read-only" : "ready";
}

type RouteInitState =
  | { status: "loading" }
  | {
      status: "ready";
      session: ActiveRouteSession;
      mode: "clean" | "draft" | "read-only";
    }
  | { status: "stale"; session: ActiveRouteSession }
  | { status: "transient-error"; reason: string };

export function resolveWorkspaceEntryMode(params: {
  headSha: string;
  persistedDrafts: Array<{ baselineHeadSha?: string }>;
  writable: boolean;
}): "stale" | "read-only" | "draft" | "clean" {
  const { headSha, persistedDrafts, writable } = params;
  if (
    persistedDrafts.some(
      (draft) =>
        Boolean(draft.baselineHeadSha) && draft.baselineHeadSha !== headSha
    )
  ) {
    return "stale";
  }
  if (!writable) {
    return "read-only";
  }
  return persistedDrafts.length > 0 ? "draft" : "clean";
}

function isSameRepository(left: RepoRef, right: RepoRef): boolean {
  return left.owner === right.owner && left.repo === right.repo;
}

function resolveReusableRouteInitState(params: {
  parsedRoute: { repository: RepoRef; prNumber: number } | null;
  legacyRedirectTarget: string | null;
  currentRepository: RepoRef;
  currentSourceRef: PullRequestSource | null;
  hasTree: boolean;
  hasBanks: boolean;
}) {
  const {
    parsedRoute,
    legacyRedirectTarget,
    currentRepository,
    currentSourceRef,
    hasTree,
    hasBanks,
  } = params;
  if (legacyRedirectTarget || !parsedRoute) {
    return null;
  }

  const persistedSession = loadWorkspaceSession();
  if (!persistedSession) {
    return null;
  }

  if (
    !(
      isSameRepository(parsedRoute.repository, persistedSession.repository) &&
      isSameRepository(parsedRoute.repository, currentRepository) &&
      currentSourceRef?.type === "pr" &&
      currentSourceRef.prNumber === parsedRoute.prNumber &&
      persistedSession.prNumber === parsedRoute.prNumber &&
      currentSourceRef.sha === persistedSession.headSha &&
      hasTree &&
      hasBanks
    )
  ) {
    return null;
  }

  return {
    status: "ready" as const,
    session: {
      status: "supported" as const,
      repository: persistedSession.repository,
      prNumber: persistedSession.prNumber,
      headSha: persistedSession.headSha,
      baseSha: persistedSession.baseSha,
      bankPath: persistedSession.bankPath,
      writable: persistedSession.writable,
      readOnlyReason: persistedSession.readOnlyReason,
      changedFiles: persistedSession.changedFiles,
    },
    mode: (persistedSession.writable ? "clean" : "read-only") as
      | "clean"
      | "read-only",
  };
}

export function useWorkspaceSession(params: {
  locationPathname: string;
  locationSearch: string;
  navigate: ReturnType<typeof useNavigate>;
  routeParams: Readonly<Record<string, string | undefined>>;
}) {
  const { locationPathname, locationSearch, navigate, routeParams } = params;
  const setRepository = useSourceStore((state) => state.setRepository);
  const setSource = useSourceStore((state) => state.setSource);
  const setTree = useSourceStore((state) => state.setTree);
  const setBanks = useSourceStore((state) => state.setBanks);
  const setLoading = useSourceStore((state) => state.setLoading);
  const setError = useSourceStore((state) => state.setError);
  const showStaleSession = useCallback((session: ActiveRouteSession) => {
    setState({
      status: "stale",
      session,
    });
  }, []);
  const showReadOnlySession = useCallback((session: ActiveRouteSession) => {
    setState({
      status: "ready",
      session,
      mode: "read-only",
    });
  }, []);
  const showReadySession = useCallback(
    (session: ActiveRouteSession, mode: "clean" | "draft" | "read-only") => {
      setState({
        status: "ready",
        session,
        mode,
      });
    },
    []
  );
  const authChangeVersion = useSyncExternalStore(
    subscribeGitHubAuthChange,
    getGitHubAuthChangeVersion,
    getGitHubAuthChangeVersion
  );
  const parsedRoute = useMemo(
    () =>
      parsePullRequestRouteParams({
        owner: routeParams.owner,
        repo: routeParams.repo,
        prNumber: routeParams.prNumber,
      }),
    [routeParams.owner, routeParams.prNumber, routeParams.repo]
  );
  const legacyRedirectTarget = useMemo(
    () => getLegacyRouteRedirectPath(locationPathname, locationSearch),
    [locationPathname, locationSearch]
  );
  const reusableState = useMemo(() => {
    const sourceState = useSourceStore.getState();
    return resolveReusableRouteInitState({
      parsedRoute,
      legacyRedirectTarget,
      currentRepository: sourceState.repository,
      currentSourceRef: sourceState.sourceRef,
      hasTree: sourceState.tree.length > 0,
      hasBanks: sourceState.banks.length > 0,
    });
  }, [legacyRedirectTarget, parsedRoute]);
  const [state, setState] = useState<RouteInitState>(
    () => reusableState ?? { status: "loading" }
  );

  useEffect(() => {
    if (legacyRedirectTarget) {
      clearWorkspaceSession();
      navigate(legacyRedirectTarget, { replace: true });
      return;
    }
    if (!parsedRoute) {
      clearWorkspaceSession();
      navigate("/", { replace: true });
    }
  }, [legacyRedirectTarget, navigate, parsedRoute]);

  useEffect(() => {
    if (legacyRedirectTarget || !parsedRoute) {
      return;
    }

    let cancelled = false;
    if (reusableState) {
      setLoading(false);
    } else {
      setState({ status: "loading" });
      setLoading(true);
    }
    setError(null);

    // biome-ignore lint/complexity/noExcessiveCognitiveComplexity: route init intentionally handles all PR-only entry branches in one place.
    const loadWorkspace = async () => {
      const sourceState = useSourceStore.getState();
      try {
        const resolution = await resolvePullRequestWorkspace(
          parsedRoute.prNumber,
          parsedRoute.repository
        );
        if (cancelled) {
          return;
        }

        if (resolution.status === "transient-error") {
          setState({
            status: "transient-error",
            reason: resolution.reason,
          });
          return;
        }

        if (resolution.status !== "supported") {
          clearWorkspaceSession();
          navigate("/", { replace: true });
          return;
        }

        const canReuseCurrentWorkspaceData =
          reusableState?.status === "ready" &&
          reusableState.session.headSha === resolution.headSha &&
          sourceState.tree.length > 0 &&
          sourceState.banks.length > 0;
        const tree = canReuseCurrentWorkspaceData
          ? sourceState.tree
          : await fetchRepoTree(resolution.headSha, parsedRoute.repository);
        if (cancelled) {
          return;
        }

        const sourceRef: PullRequestSource = {
          type: "pr",
          name: `pr-${resolution.prNumber}`,
          sha: resolution.headSha,
          prNumber: resolution.prNumber,
        };
        const draftScopeKey = makeDraftSourceKey(
          {
            type: "pr",
            prNumber: resolution.prNumber,
            name: sourceRef.name,
          },
          parsedRoute.repository
        );
        await waitForDraftStoreHydration();
        if (cancelled) {
          return;
        }
        const persistedDrafts = useDraftStore
          .getState()
          .getStoredDraftsForScope(draftScopeKey);

        setRepository(parsedRoute.repository);
        setSource(sourceRef);
        if (!canReuseCurrentWorkspaceData) {
          setTree(tree);
          setBanks(indexBanksFromTree(tree));
        }
        saveActiveRouteSession(parsedRoute.repository, resolution);
        const entryMode = resolveWorkspaceEntryMode({
          headSha: resolution.headSha,
          persistedDrafts,
          writable: resolution.writable,
        });
        if (entryMode === "stale") {
          useDraftStore.getState().activateScope(draftScopeKey, false);
          showStaleSession(resolution);
          return;
        }
        if (entryMode === "read-only") {
          useDraftStore.getState().activateScope(draftScopeKey, false);
          showReadOnlySession(resolution);
          return;
        }

        useDraftStore
          .getState()
          .activateScope(draftScopeKey, entryMode === "draft");

        showReadySession(resolution, entryMode);
      } catch (error) {
        if (cancelled) {
          return;
        }
        setState({
          status: "transient-error",
          reason:
            error instanceof Error && error.message ? error.message : "unknown",
        });
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    };

    void loadWorkspace();

    return () => {
      cancelled = true;
    };
  }, [
    authChangeVersion,
    locationPathname,
    navigate,
    parsedRoute,
    reusableState,
    setBanks,
    setError,
    setLoading,
    setRepository,
    setSource,
    setTree,
    showReadOnlySession,
    showReadySession,
    showStaleSession,
  ]);

  return {
    state,
    showReadOnlySession,
    showReadySession,
    showStaleSession,
  };
}
