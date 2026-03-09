import { useId, useState } from "react";
import { useTranslation } from "react-i18next";
import { ModalDialog } from "@/components/ModalDialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { FORMAT_TEMPLATE } from "@/domain/format";
import { useDraftStore, useSourceStore } from "@/store";

interface Props {
  bankPath: string;
  onClose: () => void;
  onCreated: (path: string) => void;
}

export function CreateFormatModal({ bankPath, onClose, onCreated }: Props) {
  const { t } = useTranslation();
  const dialogTitleId = useId();
  const formatNameInputId = useId();
  const formatIdInputId = useId();
  const [formatName, setFormatName] = useState("");
  const [formatId, setFormatId] = useState("");
  const draftStore = useDraftStore();
  const sourceRef = useSourceStore((s) => s.sourceRef);

  const handleCreate = () => {
    if (!formatName.trim()) {
      return;
    }

    const fileName = formatId
      ? `${formatName.trim()}_${formatId.trim()}.txt`
      : `${formatName.trim()}.txt`;
    const filePath = `${bankPath}/formats/${fileName}`;
    const baseSha = sourceRef?.sha ?? "";

    draftStore.setDraft(filePath, FORMAT_TEMPLATE, baseSha, "");
    onCreated(filePath);
  };

  return (
    <ModalDialog
      onClose={onClose}
      title={t("bank.createFormat")}
      titleId={dialogTitleId}
    >
      <div className="flex-col gap-md">
        <div className="flex-col gap-xs">
          <label className="text-muted text-sm" htmlFor={formatNameInputId}>
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

        <div className="flex-col gap-xs">
          <label className="text-muted text-sm" htmlFor={formatIdInputId}>
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

      <div className="modal__actions">
        <Button onClick={onClose} type="button">
          {t("app.cancel")}
        </Button>
        <Button
          disabled={!formatName.trim()}
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
