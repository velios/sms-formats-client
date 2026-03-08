import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
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
      <div className="flex items-center gap-sm">
        <span className="spinner" />
        <span>{t("app.loading")}</span>
      </div>
    );
  }

  return (
    <div className="format-editor">
      <div className="format-editor__toolbar">
        <div className="format-editor__file-info">
          <span className="font-medium text-mono">{fileName}</span>
          <a
            aria-label={t("bank.openFormatInRepo")}
            className="btn btn--ghost btn--sm"
            href={formatRepoUrl}
            onClick={(e) => e.stopPropagation()}
            rel="noreferrer"
            target="_blank"
            title={t("bank.openFormatInRepo")}
          >
            ↗
          </a>
          {isModified && (
            <span className="badge badge--modified">
              {t("editor.modified")}
            </span>
          )}
        </div>
        <div className="format-editor__history">
          <button
            aria-label={t("editor.undo")}
            className="btn btn--ghost btn--sm"
            disabled={!canUndo}
            onClick={() => draftStore.undo(filePath)}
            type="button"
          >
            ↶ {t("editor.undo")}
          </button>
          <button
            aria-label={t("editor.redo")}
            className="btn btn--ghost btn--sm"
            disabled={!canRedo}
            onClick={() => draftStore.redo(filePath)}
            type="button"
          >
            ↷ {t("editor.redo")}
          </button>
          <button
            aria-label={t("editor.resetFileToSource")}
            className="btn btn--ghost btn--sm"
            disabled={!canResetFile}
            onClick={() => draftStore.resetFileToRemote(filePath)}
            type="button"
          >
            ⟲ {t("editor.resetFileToSource")}
          </button>
        </div>
      </div>
      <div className="panel">
        <div className="panel__body">
          <div className="mb-sm text-muted text-sm">
            {t("editor.sendersHint")}
          </div>
          <textarea
            className="textarea"
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
