// The prompt package surface: task, document checkboxes, composition preview,
// copy / download / clear (PRD #20). The preview shows the composition of the
// package, never its text — it answers "did anything get lost?".

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { ModalDialog } from "@/components/ModalDialog";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { StatusBadge } from "@/components/ui/status-badge";
import { Textarea } from "@/components/ui/textarea";
import type { RepoRef } from "@/domain/types";
import type { BankInventory } from "@/features/bank-inventory/core";
import type { PromptPackageSummary } from "./core";
import {
  type PromptPackageDocumentKey,
  type PromptPackageDraftStore,
  usePromptPackage,
} from "./use-prompt-package";

const DOCUMENT_KEYS: PromptPackageDocumentKey[] = [
  "cookbook",
  "formatRules",
  "snippets",
];

interface Props {
  bankName: string;
  bankPath: string;
  repository: RepoRef;
  sourceRefName: string | undefined;
  prNumber: number | null;
  inventory: Pick<
    BankInventory,
    "mainLayerPaths" | "prLayerPaths" | "recordsByPath"
  >;
  draftStore: PromptPackageDraftStore;
  onClose: () => void;
}

function buildFileName(bankPath: string, prNumber: number | null): string {
  const folder = bankPath.split("/").pop() ?? bankPath;
  return prNumber === null
    ? `prompt-${folder}.txt`
    : `prompt-${folder}-pr${prNumber}.txt`;
}

function downloadPackage(fileName: string, text: string): void {
  const url = URL.createObjectURL(
    new Blob([text], { type: "text/plain;charset=utf-8" })
  );
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  anchor.click();
  URL.revokeObjectURL(url);
}

function PreviewSummary(params: {
  summary: PromptPackageSummary;
  t: (key: string, options?: Record<string, unknown>) => string;
}) {
  const { summary, t } = params;
  const kilobytes = Math.max(1, Math.round(summary.bytes / 1024));
  const tokens =
    summary.estimatedTokens >= 1000
      ? t("promptPackage.tokensThousands", {
          count: Math.round(summary.estimatedTokens / 1000),
        })
      : t("promptPackage.tokens", { count: summary.estimatedTokens });

  return (
    <div className="flex flex-col gap-1 text-[13px]">
      {/* All three layers always, zeroes included: an explicit zero explains a
          missing block and catches drafts that did not get picked up. */}
      {summary.layers.map((layer) => (
        <div className="flex justify-between gap-3" key={layer.layer}>
          <span className="text-[color:var(--c-text-muted)]">
            {t(`promptPackage.layer.${layer.layer}`)}
          </span>
          <span>{layer.fileCount}</span>
        </div>
      ))}
      <div className="flex justify-between gap-3">
        <span className="text-[color:var(--c-text-muted)]">
          {t("promptPackage.documentsIncluded")}
        </span>
        <span className="text-right">
          {summary.documents.length > 0
            ? summary.documents.join(", ")
            : t("promptPackage.documentsNone")}
        </span>
      </div>
      <div className="mt-1 border-[color:var(--c-border)] border-t pt-1 text-[color:var(--c-text-muted)]">
        {t("promptPackage.totals", {
          files: summary.fileCount,
          kilobytes,
          tokens,
        })}
      </div>
      {summary.skipped.length > 0 && (
        <StatusBadge variant="warning">
          {t("promptPackage.skipped", { count: summary.skipped.length })}
        </StatusBadge>
      )}
    </div>
  );
}

export function PromptPackageModal({
  bankName,
  bankPath,
  repository,
  sourceRefName,
  prNumber,
  inventory,
  draftStore,
  onClose,
}: Props) {
  const { t } = useTranslation();
  const titleId = useId();
  const taskId = useId();
  const taskRef = useRef<HTMLTextAreaElement>(null);
  const [isCopied, setIsCopied] = useState(false);

  const promptPackage = usePromptPackage({
    bankName,
    bankPath,
    repository,
    sourceRefName,
    inventory,
    draftStore,
  });
  const { build, documents, hasToken, result, task } = promptPackage;

  useEffect(() => {
    taskRef.current?.focus();
  }, []);

  // One fetch per opening: the bodies of the layers cannot change while the
  // modal holds the screen. Editing the task or a checkbox only re-assembles
  // the string, so nothing here reacts to them.
  const buildRef = useRef(build);
  buildRef.current = build;
  useEffect(() => {
    if (hasToken) {
      void buildRef.current();
    }
  }, [hasToken]);

  const handleCopy = useCallback(async () => {
    if (!result) {
      return;
    }
    await navigator.clipboard.writeText(result.text);
    setIsCopied(true);
    setTimeout(() => setIsCopied(false), 2000);
  }, [result]);

  const errorMessage =
    promptPackage.error === null
      ? null
      : t(`promptPackage.error.${promptPackage.error}`);

  return (
    <ModalDialog
      className="flex max-h-[calc(100vh-40px)] flex-col sm:max-w-[720px]"
      onClose={onClose}
      title={t("promptPackage.title", { bank: bankName })}
      titleId={titleId}
    >
      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto">
        <div className="flex flex-col gap-1.5">
          <label
            className="font-medium text-[13px] text-[color:var(--c-text-muted)]"
            htmlFor={taskId}
          >
            {t("promptPackage.taskLabel")}
          </label>
          <Textarea
            className="min-h-24"
            id={taskId}
            onChange={(event) => promptPackage.setTask(event.target.value)}
            placeholder={t("promptPackage.taskPlaceholder")}
            ref={taskRef}
            value={task}
          />
        </div>

        <fieldset className="flex flex-col gap-1.5 border-0 p-0">
          <legend className="mb-1.5 font-medium text-[13px] text-[color:var(--c-text-muted)]">
            {t("promptPackage.documentsLabel")}
          </legend>
          {DOCUMENT_KEYS.map((key) => (
            <label
              className="flex cursor-pointer select-none items-center gap-2 text-[13px]"
              key={key}
            >
              <input
                checked={documents[key]}
                className="accent-[color:var(--c-border-focus)]"
                onChange={(event) =>
                  promptPackage.toggleDocument(key, event.target.checked)
                }
                type="checkbox"
              />
              {t(`promptPackage.document.${key}`)}
            </label>
          ))}
        </fieldset>

        <div className="flex flex-col gap-2 rounded-[var(--radius-md)] border border-[color:var(--c-border)] bg-[color:var(--c-bg-elevated)] p-3">
          <div className="font-semibold text-[12px] text-[color:var(--c-text-muted)] uppercase tracking-[0.5px]">
            {t("promptPackage.previewTitle")}
          </div>
          {errorMessage && (
            <div className="flex flex-col items-start gap-2">
              <StatusBadge variant="error">{errorMessage}</StatusBadge>
              {promptPackage.errorDetail && (
                <span className="text-[12px] text-[color:var(--c-text-dim)]">
                  {promptPackage.errorDetail}
                </span>
              )}
              {promptPackage.error === "load-failed" && (
                <Button
                  disabled={promptPackage.isBuilding}
                  onClick={() => void promptPackage.build()}
                  size="sm"
                  type="button"
                  variant="secondary"
                >
                  {t("promptPackage.retry")}
                </Button>
              )}
            </div>
          )}
          {promptPackage.isBuilding && (
            <div className="flex items-center gap-2 text-[13px] text-[color:var(--c-text-muted)]">
              <Spinner />
              {t("promptPackage.building")}
            </div>
          )}
          {result && !errorMessage && (
            <PreviewSummary summary={result.summary} t={t} />
          )}
        </div>
      </div>

      <div className="mt-4 flex shrink-0 items-center gap-2 border-[color:var(--c-border)] border-t pt-4">
        <Button
          disabled={!result || promptPackage.isBuilding}
          onClick={() => void handleCopy()}
          type="button"
          variant="primary"
        >
          {isCopied ? t("promptPackage.copied") : t("promptPackage.copy")}
        </Button>
        <Button
          disabled={!result || promptPackage.isBuilding}
          onClick={() =>
            result &&
            downloadPackage(buildFileName(bankPath, prNumber), result.text)
          }
          type="button"
          variant="secondary"
        >
          {t("promptPackage.download")}
        </Button>
        <Button
          className="ml-auto"
          onClick={promptPackage.reset}
          type="button"
          variant="ghost"
        >
          {t("promptPackage.clear")}
        </Button>
      </div>
    </ModalDialog>
  );
}
