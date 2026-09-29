import { useTranslation } from "react-i18next";
import { ModalDialog } from "@/components/ModalDialog";
import { FORMAT_RULES_HTML } from "@/content/format-rules.generated";

interface Props {
  onClose: () => void;
}

export function FormatRulesModal({ onClose }: Props) {
  const { t } = useTranslation();

  return (
    <ModalDialog
      className="flex h-[calc(100vh-40px)] flex-col sm:max-w-[1000px]"
      onClose={onClose}
      title={t("formatRules.title")}
    >
      <div
        className="cookbook-prose min-h-0 flex-1 overflow-y-auto pr-2"
        // biome-ignore lint/security/noDangerouslySetInnerHtml: trusted build-time document HTML, not user input (ADR-0009)
        dangerouslySetInnerHTML={{ __html: FORMAT_RULES_HTML }}
      />
    </ModalDialog>
  );
}
