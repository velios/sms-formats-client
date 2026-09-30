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

  const canRetry = pending || !state.session;
  if (!(notice || state.error || canRetry || state.session)) {
    return null;
  }

  return (
    <div className="flex shrink-0 flex-wrap items-center justify-between gap-3">
      <div className="flex flex-col gap-2">
        {notice && <StatusBadge variant="warning">{notice}</StatusBadge>}
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
        {state.session && !pending && (
          <Button
            disabled={busy}
            onClick={() => {
              void controller.checkUpdates();
            }}
            type="button"
            variant="ghost"
          >
            {t("workspace.checkUpdates")}
          </Button>
        )}
        {state.block === "stale" && state.nextSession && (
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
  return state.block === "stale"
    ? t("workspace.cachedStaleNotice")
    : state.block === "sync-pending"
      ? t("publish.updatedRefreshFailed")
      : state.block
        ? t(`workspace.unavailable.${state.block}`)
        : state.session?.writable === false
          ? t(state.experiment ? "experiment.localOnly" : "publish.readOnly")
          : null;
}
