import { useEffect, useMemo, useSyncExternalStore } from "react";
import type { useNavigate } from "react-router-dom";
import {
  getLegacyRouteRedirectPath,
  parsePullRequestRouteParams,
} from "@/domain/bank-route";
import { decodeRequestedFileValue } from "@/features/workspace/file-selection";
import {
  getGitHubAuthChangeVersion,
  subscribeGitHubAuthChange,
} from "@/infrastructure/github";
import { WorkspaceSessionController } from "./workspace-session";
import { watchWorkspaceVisibility } from "./workspace-visibility";

export function useWorkspaceSession(params: {
  locationPathname: string;
  locationSearch: string;
  navigate: ReturnType<typeof useNavigate>;
  routeParams: Readonly<Record<string, string | undefined>>;
}) {
  const { locationPathname, locationSearch, navigate, routeParams } = params;
  const authVersion = useSyncExternalStore(
    subscribeGitHubAuthChange,
    getGitHubAuthChangeVersion,
    getGitHubAuthChangeVersion
  );
  const route = useMemo(
    () => parsePullRequestRouteParams(routeParams),
    [routeParams.owner, routeParams.repo, routeParams.prNumber]
  );
  const legacyRedirect = getLegacyRouteRedirectPath(
    locationPathname,
    locationSearch
  );
  const controller = useMemo(
    () =>
      new WorkspaceSessionController(
        route?.repository ?? { owner: "", repo: "" },
        route?.prNumber ?? 0
      ),
    [route]
  );
  controller.selectFile(
    decodeRequestedFileValue(new URLSearchParams(locationSearch))
  );
  const state = useSyncExternalStore(
    controller.subscribe,
    controller.getSnapshot,
    controller.getSnapshot
  );

  useEffect(() => {
    if (legacyRedirect || !route) {
      navigate(legacyRedirect ?? "/", { replace: true });
      return;
    }
    void controller.open();
    const stopWatching = watchWorkspaceVisibility(controller.checkFreshness);
    return () => {
      stopWatching();
      controller.deactivate();
    };
  }, [controller, authVersion, legacyRedirect, navigate, route]);

  return { state, controller };
}
