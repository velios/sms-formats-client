import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/ui/status-badge";
import type {
  WorkspaceSessionController,
  WorkspaceState,
} from "./workspace-session";

export function WorkspaceSessionNotice({
  controller,
  state,
}: {
  controller: WorkspaceSessionController;
  state: WorkspaceState;
}) {
  const { t } = useTranslation();
  const busy = state.operation !== null;
  const pending = state.block === "sync-pending";
  const notice = noticeText(state, t);

  const canRetry = pending || !state.session || Boolean(state.error);
  if (!(notice || state.error || canRetry)) {
    return null;
  }

  return (
    <div className="flex shrink-0 flex-wrap items-center justify-between gap-3">
      <div className="flex flex-col gap-2">
        {notice && (
          <div className="ui-notice" data-tone="warning">
            {notice}
          </div>
        )}
        {state.error && (
          <StatusBadge variant="error">
            {t("app.error")}:{" "}
            {state.error === "recovery-unavailable"
              ? t("workspace.recoveryUnavailable")
              : state.error}
          </StatusBadge>
        )}
      </div>
      <div className="flex gap-2">
        {(state.block === "stale" ||
          (!state.block && state.freshness === "stale")) && (
          <Button
            disabled={busy}
            onClick={() => {
              if (window.confirm(t("experiment.refreshPrConfirm"))) {
                void controller.discardAndRefresh();
              }
            }}
            type="button"
            variant="ghost"
          >
            {t("workspace.discardAndRefresh")}
          </Button>
        )}
        {canRetry && (
          <Button
            disabled={busy}
            onClick={() => {
              if (pending) {
                void controller.syncPublication();
              } else if (state.session) {
                void controller.checkUpdates();
              } else {
                void controller.open();
              }
            }}
            type="button"
            variant="ghost"
          >
            {pending ? t("workspace.retrySync") : t("app.retry")}
          </Button>
        )}
      </div>
    </div>
  );
}

function noticeText(
  state: WorkspaceState,
  t: (key: string) => string
): string | null {
  const status = state.block ?? state.freshness;
  if (status === "stale") {
    return t("workspace.cachedStaleNotice");
  }
  if (status === "sync-pending") {
    return t("publish.updatedRefreshFailed");
  }
  if (status) {
    return t(`workspace.unavailable.${status}`);
  }
  return !state.experiment && state.session?.writable === false
    ? t("publish.readOnly")
    : null;
}
