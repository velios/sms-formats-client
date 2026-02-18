import { useEffect, useState } from "react";
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
  const saveLabel = t("app.save");
  const resetLabel = t("app.reset");

  const [value, setValue] = useState(currentContent);

  useEffect(() => {
    setValue(currentContent);
  }, [currentContent]);

  useEffect(() => {
    if (remoteContent !== undefined && !draft) {
      draftStore.setDraft(filePath, remoteContent, baseSha, remoteContent);
    }
  }, [remoteContent, baseSha, draft, draftStore.setDraft, filePath]); // eslint-disable-line

  const saveDraft = (content: string) => {
    if (content === remoteBaseline) {
      draftStore.removeDraft(filePath);
      return;
    }
    draftStore.setDraft(filePath, content, baseSha, remoteBaseline);
  };

  const handleChange = (newValue: string) => {
    setValue(newValue);
  };

  const handleSave = () => {
    saveDraft(value);
  };

  const handleReset = () => {
    setValue(remoteBaseline);
    saveDraft(remoteBaseline);
  };

  const isModified = draft ? draft.content !== draft.remoteContent : false;

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
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-sm">
          <span className="font-medium text-mono">{fileName}</span>
          <a
            aria-label={t("bank.openFormatInRepo")}
            className="format-row-link"
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
        <div className="flex gap-sm">
          <button className="btn bank-actions__btn" onClick={handleReset}>
            {resetLabel}
          </button>
          <button
            className="btn btn--primary bank-actions__btn"
            onClick={handleSave}
          >
            {saveLabel}
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
