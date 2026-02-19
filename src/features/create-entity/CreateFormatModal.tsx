import { useId, useState } from "react";
import { useTranslation } from "react-i18next";
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
    <div className="modal-overlay" onClick={onClose}>
      <div
        aria-labelledby={dialogTitleId}
        aria-modal="true"
        className="modal"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
      >
        <div className="modal__title" id={dialogTitleId}>
          {t("bank.createFormat")}
        </div>

        <div className="flex-col gap-md">
          <div className="flex-col gap-xs">
            <label className="text-muted text-sm" htmlFor={formatNameInputId}>
              {t("bank.formatName")} *
            </label>
            <input
              autoFocus
              className="input"
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
            <input
              className="input"
              id={formatIdInputId}
              onChange={(e) => setFormatId(e.target.value.replace(/\D/g, ""))}
              placeholder="1"
              value={formatId}
            />
          </div>
        </div>

        <div className="modal__actions">
          <button className="btn" onClick={onClose}>
            {t("app.cancel")}
          </button>
          <button
            className="btn btn--primary"
            disabled={!formatName.trim()}
            onClick={handleCreate}
          >
            {t("bank.createFormat")}
          </button>
        </div>
      </div>
    </div>
  );
}
