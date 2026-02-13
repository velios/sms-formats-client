import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useFileContent } from "@/hooks/useGitHub";
import { useDraftStore, useSourceStore } from "@/store";

interface Props {
  bankPath: string;
}

export function SendersEditor({ bankPath }: Props) {
  const { t } = useTranslation();
  const sourceRef = useSourceStore((s) => s.sourceRef);
  const draftStore = useDraftStore();
  const filePath = `${bankPath}/senders.txt`;

  const { data: remoteContent, isLoading } = useFileContent(
    filePath,
    sourceRef?.sha ?? sourceRef?.name
  );

  const draft = draftStore.getDraft(filePath);
  const currentContent = draft?.content ?? remoteContent ?? "";
  const baseSha = draft?.baseSha ?? sourceRef?.sha ?? "";

  const [value, setValue] = useState(currentContent);

  useEffect(() => {
    setValue(currentContent);
  }, [currentContent]);

  useEffect(() => {
    if (remoteContent !== undefined && !draft) {
      draftStore.setDraft(filePath, remoteContent, baseSha, remoteContent);
    }
  }, [remoteContent, baseSha, draft, draftStore.setDraft, filePath]); // eslint-disable-line

  const handleChange = (newVal: string) => {
    setValue(newVal);
    draftStore.setDraft(filePath, newVal, baseSha, remoteContent ?? "");
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
    <div className="panel">
      <div className="panel__header">
        <div className="flex items-center gap-sm">
          {t("bank.senders")} — senders.txt
          {isModified && (
            <span className="badge badge--modified">
              {t("editor.modified")}
            </span>
          )}
        </div>
      </div>
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
  );
}
