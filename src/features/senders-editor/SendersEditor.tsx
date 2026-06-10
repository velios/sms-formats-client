import { useEffect, useRef, useState } from "react";
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
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-md border border-[color:var(--c-border)] bg-[color:var(--c-bg-surface)]">
        <div className="flex min-h-10 shrink-0 items-center border-[color:var(--c-border)] border-b bg-[color:var(--c-bg-elevated)] px-4 py-1 font-semibold text-[12px] text-[color:var(--c-text-muted)] uppercase tracking-[0.5px]">
          {t("bank.senders")}
        </div>
        <div className="flex min-h-0 flex-1 flex-col gap-2 p-4">
          <div className="text-[color:var(--c-text-muted)] text-xs">
            {t("editor.sendersHint")}
          </div>
          <Textarea
            className="min-h-[15rem] flex-1 resize-none font-mono"
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
