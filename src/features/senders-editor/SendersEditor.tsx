import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/ui/status-badge";
import { Textarea } from "@/components/ui/textarea";
import { config } from "@/config";
import { useFileContent } from "@/hooks/useGitHub";
import { useDraftStore, useSourceStore } from "@/store";

interface Props {
  bankPath: string;
}

export function SendersEditor({ bankPath }: Props) {
  const { t } = useTranslation();
  const sourceRef = useSourceStore((s) => s.sourceRef);
  const repository = useSourceStore((s) => s.repository);
  const draftStore = useDraftStore();
  const filePath = `${bankPath}/senders.txt`;

  const { data: remoteContent, isLoading } = useFileContent(
    filePath,
    sourceRef?.sha ?? sourceRef?.name
  );

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
    if (remoteContent !== undefined) {
      draftStore.ensureDraft(filePath, remoteContent, baseSha, remoteContent);
    }
  }, [remoteContent, baseSha, draftStore, filePath]);

  const handleChange = (newValue: string) => {
    lastAppliedValueRef.current = newValue;
    setValue(newValue);
    draftStore.applyUserEdit(filePath, newValue, baseSha, remoteBaseline);
  };

  if (isLoading) {
    return (
      <div className="flex items-center gap-2">
        <span className="spinner" />
        <span>{t("app.loading")}</span>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col gap-4 overflow-hidden">
      <div className="flex min-h-[52px] shrink-0 flex-wrap items-center gap-2">
        <div className="ml-2 flex min-w-0 flex-1 items-center gap-2">
          <span className="font-medium text-mono">{fileName}</span>
          <Button
            asChild
            aria-label={t("bank.openFormatInRepo")}
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
            disabled={!canUndo}
            onClick={() => draftStore.undo(filePath)}
            size="sm"
            type="button"
            variant="ghost"
          >
            ↶ {t("editor.undo")}
          </Button>
          <Button
            aria-label={t("editor.redo")}
            disabled={!canRedo}
            onClick={() => draftStore.redo(filePath)}
            size="sm"
            type="button"
            variant="ghost"
          >
            ↷ {t("editor.redo")}
          </Button>
          <Button
            aria-label={t("editor.resetFileToSource")}
            disabled={!canResetFile}
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
          <div className="mb-2 text-xs text-[color:var(--c-text-muted)]">
            {t("editor.sendersHint")}
          </div>
          <Textarea
            className="min-h-[15rem] font-mono"
            onChange={(e) => handleChange(e.target.value)}
            rows={15}
            spellCheck={false}
            value={value}
          />
        </div>
      </div>
    </div>
  );
}
