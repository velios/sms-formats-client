import { useId, useState } from "react";
import { useTranslation } from "react-i18next";
import { ModalDialog } from "@/components/ModalDialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { FORMAT_TEMPLATE } from "@/domain/format";
import { validateNewFormatPath } from "@/domain/format/file-path";
import { useDraftStore, useSourceStore } from "@/store";

interface Props {
  bankPath: string;
  onClose: () => void;
  onCreated: (path: string) => void;
  readOnly?: boolean;
}

export function CreateFormatModal({
  bankPath,
  onClose,
  onCreated,
  readOnly = false,
}: Props) {
  const { t } = useTranslation();
  const formatNameInputId = useId();
  const formatIdInputId = useId();
  const [formatName, setFormatName] = useState("");
  const [formatId, setFormatId] = useState("");
  const draftStore = useDraftStore();
  const tree = useSourceStore((state) => state.tree);
  const [error, setError] = useState<string | null>(null);
  const sourceRef = useSourceStore((s) => s.sourceRef);

  const handleCreate = () => {
    if (readOnly || !formatName.trim()) {
      return;
    }

    const fileName = formatId
      ? `${formatName.trim()}_${formatId.trim()}.txt`
      : `${formatName.trim()}.txt`;
    const filePath = `${bankPath}/formats/${fileName}`;
    const pathError = validateNewFormatPath(filePath, bankPath, [
      ...tree.map((entry) => entry.path),
      ...draftStore.drafts.keys(),
    ]);
    if (pathError) {
      setError(t(`createEntity.${pathError}`));
      return;
    }
    const baseSha = sourceRef?.sha ?? "";

    draftStore.setDraft(filePath, FORMAT_TEMPLATE, baseSha, null);
    onCreated(filePath);
  };

  return (
    <ModalDialog onClose={onClose} title={t("bank.createFormat")}>
      <div className="ui-panel-stack">
        <div className="ui-field">
          <label className="ui-field-label" htmlFor={formatNameInputId}>
            {t("bank.formatName")} *
          </label>
          <Input
            autoFocus
            id={formatNameInputId}
            onChange={(e) => setFormatName(e.target.value)}
            placeholder="format_name"
            value={formatName}
          />
        </div>

        <div className="ui-field">
          <label className="ui-field-label" htmlFor={formatIdInputId}>
            {t("bank.formatId")}
          </label>
          <Input
            id={formatIdInputId}
            onChange={(e) => setFormatId(e.target.value.replace(/\D/g, ""))}
            placeholder="1"
            value={formatId}
          />
        </div>
      </div>

      {error && (
        <div className="ui-notice" data-tone="error" role="alert">
          {error}
        </div>
      )}
      <div className="ui-dialog-actions justify-end">
        <Button onClick={onClose} type="button">
          {t("app.cancel")}
        </Button>
        <Button
          disabled={readOnly || !formatName.trim()}
          onClick={handleCreate}
          type="button"
          variant="primary"
        >
          {t("bank.createFormat")}
        </Button>
      </div>
    </ModalDialog>
  );
}
