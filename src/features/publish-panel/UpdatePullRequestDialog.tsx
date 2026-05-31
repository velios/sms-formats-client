import { useId, useState } from "react";
import { useTranslation } from "react-i18next";
import { ModalDialog } from "@/components/ModalDialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";

export interface CommitMessageInput {
  title: string;
  description: string;
}

interface Props {
  isBusy: boolean;
  onClose: () => void;
  onSubmit: (commit: CommitMessageInput | null) => Promise<void>;
}

export function UpdatePullRequestDialog({ isBusy, onClose, onSubmit }: Props) {
  const { t } = useTranslation();
  const dialogTitleId = useId();
  const commitTitleInputId = useId();
  const commitDescriptionInputId = useId();
  const [commitTitle, setCommitTitle] = useState("");
  const [commitDescription, setCommitDescription] = useState("");
  const hasTitle = commitTitle.trim().length > 0;

  const handleSubmitWithMessage = async () => {
    if (isBusy || !hasTitle) {
      return;
    }
    await onSubmit({ title: commitTitle, description: commitDescription });
  };

  const handleSubmitWithDefaultTitle = async () => {
    if (isBusy) {
      return;
    }
    await onSubmit(null);
  };

  return (
    <ModalDialog
      onClose={onClose}
      title={t("publish.updateDialogTitle")}
      titleId={dialogTitleId}
    >
      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-1">
          <label
            className="text-[color:var(--c-text-muted)] text-xs"
            htmlFor={commitTitleInputId}
          >
            {t("publish.commitTitleLabel")}
          </label>
          <Input
            autoFocus
            id={commitTitleInputId}
            onChange={(event) => setCommitTitle(event.target.value)}
            placeholder={t("publish.commitTitlePlaceholder")}
            value={commitTitle}
          />
        </div>
        <div className="flex flex-col gap-1">
          <label
            className="text-[color:var(--c-text-muted)] text-xs"
            htmlFor={commitDescriptionInputId}
          >
            {t("publish.commitDescriptionLabel")}
          </label>
          <Textarea
            id={commitDescriptionInputId}
            onChange={(event) => setCommitDescription(event.target.value)}
            placeholder={t("publish.commitDescriptionPlaceholder")}
            value={commitDescription}
          />
        </div>
      </div>

      <div className="mt-6 flex justify-end gap-2">
        <Button
          disabled={isBusy}
          onClick={() => void handleSubmitWithDefaultTitle()}
          type="button"
        >
          {t("publish.updateWithDefaultTitle")}
        </Button>
        <Button
          disabled={isBusy || !hasTitle}
          onClick={() => void handleSubmitWithMessage()}
          type="button"
          variant="primary"
        >
          {isBusy ? <Spinner /> : null}
          {t("publish.updateAction")}
        </Button>
      </div>
    </ModalDialog>
  );
}
