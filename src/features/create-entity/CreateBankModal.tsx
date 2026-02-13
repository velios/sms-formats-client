import { useId, useState } from "react";
import { useTranslation } from "react-i18next";
import { FORMAT_TEMPLATE } from "@/domain/format";
import { useDraftStore, useSourceStore } from "@/store";

interface Props {
  onClose: () => void;
}

export function CreateBankModal({ onClose }: Props) {
  const { t } = useTranslation();
  const dialogTitleId = useId();
  const bankNameInputId = useId();
  const bankIdInputId = useId();
  const [bankName, setBankName] = useState("");
  const [bankId, setBankId] = useState("");
  const draftStore = useDraftStore();
  const sourceRef = useSourceStore((s) => s.sourceRef);

  const handleCreate = () => {
    if (!bankName.trim()) {
      return;
    }

    const folderName = bankId
      ? `${bankName.trim()}_${bankId.trim()}`
      : bankName.trim();
    const basePath = `src/${folderName}`;
    const baseSha = sourceRef?.sha ?? "";

    // Create senders.txt
    draftStore.setDraft(
      `${basePath}/senders.txt`,
      "SENDER_NAME\n",
      baseSha,
      ""
    );

    // Create one default format file
    draftStore.setDraft(
      `${basePath}/formats/default_1.txt`,
      FORMAT_TEMPLATE,
      baseSha,
      ""
    );

    // Add bank to source store so it appears in bank list
    const currentBanks = useSourceStore.getState().banks;
    useSourceStore.getState().setBanks([
      ...currentBanks,
      {
        displayName: bankName.trim(),
        folderPath: basePath,
        bankId: bankId.trim() || null,
        formatFiles: [`${basePath}/formats/default_1.txt`],
        hasSenders: true,
      },
    ]);

    onClose();
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
          {t("bank.createBank")}
        </div>

        <div className="flex-col gap-md">
          <div className="flex-col gap-xs">
            <label className="text-muted text-sm" htmlFor={bankNameInputId}>
              {t("bank.bankName")} *
            </label>
            <input
              autoFocus
              className="input"
              id={bankNameInputId}
              onChange={(e) => setBankName(e.target.value)}
              placeholder="Банк"
              value={bankName}
            />
          </div>

          <div className="flex-col gap-xs">
            <label className="text-muted text-sm" htmlFor={bankIdInputId}>
              {t("bank.bankId")}
            </label>
            <input
              className="input"
              id={bankIdInputId}
              onChange={(e) => setBankId(e.target.value.replace(/\D/g, ""))}
              placeholder="123"
              value={bankId}
            />
          </div>
        </div>

        <div className="modal__actions">
          <button className="btn" onClick={onClose}>
            {t("app.cancel")}
          </button>
          <button
            className="btn btn--primary"
            disabled={!bankName.trim()}
            onClick={handleCreate}
          >
            {t("bank.createBank")}
          </button>
        </div>
      </div>
    </div>
  );
}
