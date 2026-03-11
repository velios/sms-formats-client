import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { StatusBadge } from "@/components/ui/status-badge";
import { Textarea } from "@/components/ui/textarea";
import { config } from "@/config";
import { useWorkspaceFileContent } from "@/hooks/useWorkspaceFileContent";
import { useDraftStore, useSourceStore } from "@/store";

interface Props {
  bankPath: string;
  readOnly?: boolean;
}

export function SendersEditor({ bankPath, readOnly = false }: Props) {
  const { t } = useTranslation();
  const sourceRef = useSourceStore((s) => s.sourceRef);
  const repository = useSourceStore((s) => s.repository);
  const draftStore = useDraftStore();
  const filePath = `${bankPath}/senders.txt`;

  const {
    data: remoteContent,
    isLoading,
    error: remoteContentError,
  } = useWorkspaceFileContent({
    filePath,
    loadedFrom: "editor",
  });

  const draft = draftStore.getDraft(filePath);
  const currentContent = draft?.content ?? remoteContent ?? "";
  const baseSha = draft?.baseSha ?? sourceRef?.sha ?? "";
  const remoteBaseline = remoteContent ?? draft?.remoteContent ?? "";
  const fileName = filePath.split("/").pop() ?? filePath;
  const refName = sourceRef?.sha ?? sourceRef?.name ?? config.defaultBranch;
  const encodedPath = filePath.split("/").map(encodeURIComponent).join("/");
  const formatRepoUrl = `https://github.com/${repository.owner}/${repository.repo}/blob/${encodeURIComponent(refName)}/${encodedPath}`;
  const isModified = draft ? draft.content !== draft.remoteContent : false;
  const canUndo = draftStore.canUndo(filePath);
  const canRedo = draftStore.canRedo(filePath);
  const canResetFile = isModified;

  const [value, setValue] = useState(currentContent);
  const lastAppliedValueRef = useRef<string | null>(null);

  useEffect(() => {
    if (lastAppliedValueRef.current === currentContent) {
      return;
    }
    lastAppliedValueRef.current = currentContent;
    setValue(currentContent);
  }, [currentContent]);

  useEffect(() => {
    if (!readOnly && remoteContent !== undefined) {
      draftStore.ensureDraft(filePath, remoteContent, baseSha, remoteContent);
    }
  }, [baseSha, draftStore, filePath, readOnly, remoteContent]);

  const handleChange = (newValue: string) => {
    if (readOnly) {
      return;
    }
    lastAppliedValueRef.current = newValue;
    setValue(newValue);
    draftStore.applyUserEdit(filePath, newValue, baseSha, remoteBaseline);
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
    <div className="flex h-full min-h-0 flex-col gap-4 overflow-hidden">
      {remoteContentError && (
        <StatusBadge variant="error">{remoteContentError}</StatusBadge>
      )}
      <div className="flex min-h-[52px] shrink-0 flex-wrap items-center gap-2">
        <div className="ml-2 flex min-w-0 flex-1 items-center gap-2">
          <span className="font-medium font-mono">{fileName}</span>
          <Button
            aria-label={t("bank.openFormatInRepo")}
            asChild
            size="sm"
            title={t("bank.openFormatInRepo")}
            variant="ghost"
          >
            <a
              href={formatRepoUrl}
              onClick={(e) => e.stopPropagation()}
              rel="noreferrer"
              target="_blank"
            >
              ↗
            </a>
          </Button>
          {isModified && (
            <StatusBadge variant="modified">{t("editor.modified")}</StatusBadge>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <Button
            aria-label={t("editor.undo")}
            disabled={readOnly || !canUndo}
            onClick={() => draftStore.undo(filePath)}
            size="sm"
            type="button"
            variant="ghost"
          >
            ↶ {t("editor.undo")}
          </Button>
          <Button
            aria-label={t("editor.redo")}
            disabled={readOnly || !canRedo}
            onClick={() => draftStore.redo(filePath)}
            size="sm"
            type="button"
            variant="ghost"
          >
            ↷ {t("editor.redo")}
          </Button>
          <Button
            aria-label={t("editor.resetFileToSource")}
            disabled={readOnly || !canResetFile}
            onClick={() => draftStore.resetFileToRemote(filePath)}
            size="sm"
            type="button"
            variant="ghost"
          >
            ⟲ {t("editor.resetFileToSource")}
          </Button>
        </div>
      </div>
      <div className="overflow-hidden rounded-md border border-[color:var(--c-border)] bg-[color:var(--c-bg-surface)]">
        <div className="p-4">
          <div className="mb-2 text-[color:var(--c-text-muted)] text-xs">
            {t("editor.sendersHint")}
          </div>
          <Textarea
            className="min-h-[15rem] font-mono"
            onChange={(e) => handleChange(e.target.value)}
            readOnly={readOnly}
            rows={15}
            spellCheck={false}
            value={value}
          />
        </div>
      </div>
    </div>
  );
}
