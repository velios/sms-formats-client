import { useId } from "react";
import { useTranslation } from "react-i18next";
import { ModalDialog } from "@/components/ModalDialog";
import { config } from "@/config";
import { COOKBOOK_HTML } from "@/content/cookbook.generated";

const COOKBOOK_GITHUB_URL = `https://github.com/${config.sourceOwner}/${config.sourceRepo}/blob/${config.defaultBranch}/docs/transaction_sms_regex_cookbook.md`;

interface Props {
  onClose: () => void;
}

export function CookbookModal({ onClose }: Props) {
  const { t } = useTranslation();
  const titleId = useId();

  return (
    <ModalDialog
      className="flex h-[calc(100vh-40px)] flex-col sm:max-w-[1000px]"
      onClose={onClose}
      title={
        <span className="flex items-center gap-3">
          {t("cookbook.title")}
          <a
            className="font-normal text-[color:var(--c-text-dim)] text-xs"
            href={COOKBOOK_GITHUB_URL}
            rel="noopener noreferrer"
            target="_blank"
          >
            {t("cookbook.openOnGitHub")} ↗
          </a>
        </span>
      }
      titleId={titleId}
    >
      {/* Trusted build-time HTML from our vendored cookbook (ADR-0009). */}
      <div
        className="cookbook-prose min-h-0 flex-1 overflow-y-auto pr-2"
        // biome-ignore lint/security/noDangerouslySetInnerHtml: trusted build-time cookbook HTML, not user input (ADR-0009)
        dangerouslySetInnerHTML={{ __html: COOKBOOK_HTML }}
      />
    </ModalDialog>
  );
}
