import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { Spinner } from "@/components/ui/spinner";
import { StatusBadge } from "@/components/ui/status-badge";
import { Textarea } from "@/components/ui/textarea";
import { useWorkspaceFileContent } from "@/hooks/useWorkspaceFileContent";
import { useDraftStore, useSourceStore } from "@/store";

interface Props {
  bankPath: string;
  readOnly?: boolean;
}

export function SendersEditor({ bankPath, readOnly = false }: Props) {
  const { t } = useTranslation();
  const sourceRef = useSourceStore((s) => s.sourceRef);
  const filePath = `${bankPath}/senders.txt`;

  const draft = useDraftStore((state) => state.drafts.get(filePath));
  const existsAtHead = useSourceStore((state) =>
    state.tree.some((entry) => entry.path === filePath && entry.type === "blob")
  );

  const {
    data: headContent,
    isLoading,
    error: headContentError,
  } = useWorkspaceFileContent({
    filePath,
    enabled: existsAtHead,
  });

  const currentContent = draft?.content ?? headContent ?? "";
  const baseSha = draft?.baselineHeadSha ?? sourceRef?.sha ?? "";
  const remoteBaseline = draft ? draft.headContent : (headContent ?? null);

  useEffect(() => {
    if (!readOnly && headContent !== undefined && baseSha === sourceRef?.sha) {
      useDraftStore
        .getState()
        .ensureDraft(filePath, headContent, baseSha, headContent);
    }
  }, [baseSha, filePath, readOnly, headContent, sourceRef?.sha]);

  const handleChange = (newValue: string) => {
    if (!readOnly) {
      useDraftStore
        .getState()
        .applyUserEdit(filePath, newValue, baseSha, remoteBaseline);
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center gap-2">
        <Spinner />
        <span>{t("app.loading")}</span>
      </div>
    );
  }

  return (
    <div className="ui-panel-stack h-full overflow-hidden">
      {headContentError && (
        <StatusBadge variant="error">{headContentError}</StatusBadge>
      )}
      <div className="ui-panel flex min-h-0 flex-1 flex-col">
        <div className="ui-panel-heading shrink-0">{t("bank.senders")}</div>
        <div className="ui-panel-body flex min-h-0 flex-1 flex-col gap-2">
          <div className="text-muted-foreground text-xs">
            {t("editor.sendersHint")}
          </div>
          <Textarea
            className="min-h-[15rem] flex-1 resize-none font-mono"
            onChange={(e) => handleChange(e.target.value)}
            onKeyDown={(event) => {
              if (
                (event.metaKey || event.ctrlKey) &&
                event.key.toLowerCase() === "z"
              ) {
                event.preventDefault();
                if (readOnly) {
                  return;
                }
                if (event.shiftKey) {
                  useDraftStore.getState().redo(filePath);
                } else {
                  useDraftStore.getState().undo(filePath);
                }
              }
            }}
            readOnly={readOnly}
            rows={15}
            spellCheck={false}
            value={currentContent}
          />
        </div>
      </div>
    </div>
  );
}
