import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { useTranslation } from "react-i18next";
import {
  useLocation,
  useNavigate,
  useParams,
  useSearchParams,
} from "react-router-dom";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/ui/status-badge";
import { indexBanksFromTree } from "@/domain/bank-index";
import { FormatEditor } from "@/features/format-editor/FormatEditor";
import { ResizablePanels } from "@/features/resizable-panels/ResizablePanels";
import { SendersEditor } from "@/features/senders-editor/SendersEditor";
import {
  buildSelectionSearch,
  decodeRequestedFileValue,
} from "@/features/workspace/file-selection";
import { SourceExperimentController } from "@/features/workspace/source-experiment";
import {
  type WorkspaceEditorMode,
  WorkspaceHeaderBar,
} from "@/features/workspace-header/WorkspaceHeaderBar";
import {
  getGitHubAuthChangeVersion,
  getGitHubUserToken,
  subscribeGitHubAuthChange,
} from "@/infrastructure/github";
import { useDraftStore } from "@/store";

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: Workspace composition.
export function SourceWorkspace() {
  const { t } = useTranslation();
  const params = useParams();
  const location = useLocation();
  const navigate = useNavigate();
  const [search] = useSearchParams();
  const requested = decodeRequestedFileValue(search);
  const authVersion = useSyncExternalStore(
    subscribeGitHubAuthChange,
    getGitHubAuthChangeVersion,
    getGitHubAuthChangeVersion
  );
  const fullBank = Boolean(getGitHubUserToken());
  const controller = useMemo(
    () =>
      new SourceExperimentController(
        { owner: params.owner ?? "", repo: params.repo ?? "" },
        params.prNumber
          ? { type: "pr", prNumber: Number(params.prNumber) }
          : { type: "main" },
        Boolean(getGitHubUserToken())
      ),
    [params.owner, params.repo, params.prNumber, authVersion]
  );
  const state = useSyncExternalStore(
    controller.subscribe,
    controller.getSnapshot,
    controller.getSnapshot
  );
  const [mode, setMode] = useState<WorkspaceEditorMode>("structured");
  const drafts = useDraftStore((store) => store.drafts);
  useEffect(() => {
    void controller.open(requested);
    return () => controller.deactivate();
  }, [controller]);
  useEffect(() => {
    if (requested) {
      void controller.select(requested);
    }
  }, [controller, requested, state.head]);
  useEffect(() => {
    setMode("structured");
  }, [state.filePath]);
  const select = (path: string) =>
    navigate(`${location.pathname}${buildSelectionSearch(search, path)}`);
  const banks = useMemo(() => indexBanksFromTree(state.tree), [state.tree]);
  const bankPath = state.filePath?.split("/").slice(0, 2).join("/") ?? "";
  const bank = banks.find((item) => item.folderPath === bankPath);
  const file = state.filePath;
  const showSenders = file === `${bankPath}/senders.txt`;
  const draft = file ? drafts.get(file) : undefined;
  const busy =
    state.operation === "opening" ||
    state.operation === "selecting" ||
    state.operation === "refreshing";
  const notices = (
    <div className="flex shrink-0 flex-wrap items-center gap-2">
      <StatusBadge variant="info">{t("experiment.localOnly")}</StatusBadge>
      {(state.nextHead ?? state.head)?.prState && (
        <StatusBadge variant="info">
          {t(`experiment.prState.${(state.nextHead ?? state.head)?.prState}`)}
        </StatusBadge>
      )}
      {draft && (
        <span className="font-mono text-xs">
          {t("experiment.baseline", { sha: draft.baselineHeadSha })}
        </span>
      )}
      {state.nextHead && (
        <StatusBadge variant="warning">
          {t("experiment.sourceUpdated")}{" "}
          {t(
            draft && draft.content !== draft.headContent
              ? "experiment.editsSaved"
              : "experiment.baselineSaved"
          )}
        </StatusBadge>
      )}
      {state.error && (
        <StatusBadge variant="error">
          {state.head ? t("experiment.freshnessFailed") : t("app.error")}:{" "}
          {state.error}
        </StatusBadge>
      )}
      <Button
        disabled={state.operation !== null}
        onClick={() => {
          void (state.head
            ? state.error && file && !draft
              ? controller.select(file, true)
              : controller.checkUpdates()
            : controller.open(requested));
        }}
        size="sm"
        variant="ghost"
      >
        {t(
          state.error
            ? "app.retry"
            : state.head
              ? "workspace.checkUpdates"
              : "app.retry"
        )}
      </Button>
      {state.nextHead && (
        <Button
          disabled={state.operation !== null}
          onClick={() => {
            if (
              window.confirm(
                t(
                  !fullBank
                    ? "experiment.refreshFileConfirm"
                    : params.prNumber
                      ? "experiment.refreshPrConfirm"
                      : "experiment.refreshBankConfirm",
                  { bank: bankPath }
                )
              )
            ) {
              void controller.refresh();
            }
          }}
          size="sm"
          variant="ghost"
        >
          {t("experiment.refreshAction")}
        </Button>
      )}
      {draft && (
        <Button
          onClick={() => {
            void navigator.clipboard.writeText(draft.content);
          }}
          size="sm"
          variant="ghost"
        >
          {t("experiment.copy")}
        </Button>
      )}
    </div>
  );
  const editor =
    busy || (requested && file !== requested) ? (
      <div className="ui-state">{t("app.loading")}</div>
    ) : state.missing ? (
      <StatusBadge variant="warning">
        {t("experiment.missing", { path: file })}
      </StatusBadge>
    ) : file && draft && showSenders ? (
      <SendersEditor bankPath={bankPath} />
    ) : file && draft ? (
      <FormatEditor
        filePath={file}
        key={`${controller.scope}:${file}`}
        mode={mode}
      />
    ) : (
      <div className="ui-state">{t("experiment.chooseFile")}</div>
    );
  return (
    <div className="ui-panel-stack h-full">
      <WorkspaceHeaderBar
        allFormatFiles={bank?.formatFiles ?? []}
        bankName={bank?.displayName ?? bankPath}
        bankRepoUrl={`https://github.com/${controller.repository.owner}/${controller.repository.repo}/tree/${state.head?.sourceRef.sha ?? "main"}/${bankPath}`}
        localOnly
        mode={mode}
        onModeChange={setMode}
        onRenameFile={() => false}
        readOnly={busy || state.missing}
        selectedFile={file}
        sendersPath={`${bankPath}/senders.txt`}
        showSenders={showSenders}
      />
      {notices}
      {fullBank ? (
        <ResizablePanels side="left">
          <div className="ui-panel flex min-h-0 flex-col">
            <div className="ui-panel-heading">{t("bank.formats")}</div>
            <div className="ui-panel-body overflow-auto">
              <select
                aria-label={t("experiment.bank")}
                className="mb-2 w-full"
                disabled={busy}
                onChange={(event) => {
                  const next = banks.find(
                    (item) => item.folderPath === event.target.value
                  )?.formatFiles[0];
                  if (next) {
                    select(next);
                  }
                }}
                value={bankPath}
              >
                {banks.map((item) => (
                  <option key={item.folderPath} value={item.folderPath}>
                    {item.displayName}
                  </option>
                ))}
              </select>
              {bank?.hasSenders && (
                <button
                  className="ui-list-row w-full text-left"
                  disabled={busy}
                  onClick={() => select(`${bankPath}/senders.txt`)}
                  type="button"
                >
                  senders.txt
                </button>
              )}
              {state.tree
                .filter(
                  (entry) =>
                    entry.type === "blob" &&
                    entry.path.startsWith(`${bankPath}/`) &&
                    !bank?.formatFiles.includes(entry.path) &&
                    entry.path !== `${bankPath}/senders.txt`
                )
                .map((entry) => (
                  <a
                    className="ui-list-row block"
                    href={`https://github.com/${controller.repository.owner}/${controller.repository.repo}/blob/${state.head?.sourceRef.sha}/${entry.path}`}
                    key={entry.path}
                    rel="noreferrer"
                    target="_blank"
                  >
                    {entry.path.slice(bankPath.length + 1)}
                  </a>
                ))}
              {bank?.formatFiles.map((path) => (
                <button
                  className="ui-list-row w-full text-left"
                  disabled={state.operation === "refreshing"}
                  key={path}
                  onClick={() => select(path)}
                  type="button"
                >
                  {path.split("/").pop()}
                  {drafts.get(path)?.content !==
                    drafts.get(path)?.headContent && drafts.has(path)
                    ? " *"
                    : ""}
                </button>
              ))}
            </div>
          </div>
          <div className="ui-panel-stack min-w-0 overflow-hidden">{editor}</div>
        </ResizablePanels>
      ) : (
        <div className="min-h-0 flex-1 overflow-hidden">{editor}</div>
      )}
    </div>
  );
}
