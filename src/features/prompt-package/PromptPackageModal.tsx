import { useCallback, useEffect, useId, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { ModalDialog } from "@/components/ModalDialog";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { StatusBadge } from "@/components/ui/status-badge";
import { Textarea } from "@/components/ui/textarea";
import type { RepoRef } from "@/domain/types";
import type { BankInventory } from "@/features/bank-inventory/core";
import { PROMPT_PRESETS, type PromptPackageSummary } from "./core";

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
  headSha: string | undefined;
  baseSha: string | undefined;
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
    <div className="flex flex-col gap-1 text-sm">
      {summary.layers.map((layer) => (
        <div className="flex justify-between gap-3" key={layer.layer}>
          <span className="text-muted-foreground">
            {t(`promptPackage.layer.${layer.layer}`)}
          </span>
          <span>{layer.fileCount}</span>
        </div>
      ))}
      <div className="flex justify-between gap-3">
        <span className="text-muted-foreground">
          {t("promptPackage.documentsIncluded")}
        </span>
        <span className="text-right">
          {summary.documents.length > 0
            ? summary.documents.join(", ")
            : t("promptPackage.documentsNone")}
        </span>
      </div>
      <div className="mt-1 border-border border-t pt-1 text-muted-foreground">
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
  headSha,
  baseSha,
  prNumber,
  inventory,
  draftStore,
  onClose,
}: Props) {
  const { t } = useTranslation();
  const taskId = useId();
  const taskRef = useRef<HTMLTextAreaElement>(null);
  const [isCopied, setIsCopied] = useState(false);

  const promptPackage = usePromptPackage({
    bankName,
    bankPath,
    repository,
    headSha,
    baseSha,
    inventory,
    draftStore,
  });
  const { build, documents, hasToken, result, task } = promptPackage;

  useEffect(() => {
    taskRef.current?.focus();
  }, []);

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
    >
      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto">
        <div className="ui-field">
          <label className="ui-field-label font-medium" htmlFor={taskId}>
            {t("promptPackage.taskLabel")}
          </label>
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-muted-foreground text-xs">
              {t("promptPackage.presetsLabel")}
            </span>
            {PROMPT_PRESETS.map((preset) => (
              <Button
                key={preset.key}
                onClick={() => promptPackage.setTask(preset.task)}
                size="sm"
                type="button"
                variant="secondary"
              >
                {t(`promptPackage.preset.${preset.key}`)}
              </Button>
            ))}
          </div>
          <Textarea
            className="min-h-24"
            id={taskId}
            onChange={(event) => promptPackage.setTask(event.target.value)}
            placeholder={t("promptPackage.taskPlaceholder")}
            ref={taskRef}
            value={task}
          />
        </div>

        <fieldset className="ui-field border-0 p-0">
          <legend className="ui-field-label mb-1 font-medium">
            {t("promptPackage.documentsLabel")}
          </legend>
          {DOCUMENT_KEYS.map((key) => (
            <label
              className="flex cursor-pointer select-none items-center gap-2 text-sm"
              key={key}
            >
              <input
                checked={documents[key]}
                className="accent-[color:var(--ring)]"
                onChange={(event) =>
                  promptPackage.toggleDocument(key, event.target.checked)
                }
                type="checkbox"
              />
              {t(`promptPackage.document.${key}`)}
            </label>
          ))}
        </fieldset>

        <div className="flex flex-col gap-2 rounded-md border border-border bg-muted p-3">
          <div className="font-semibold text-muted-foreground text-xs uppercase tracking-[0.5px]">
            {t("promptPackage.previewTitle")}
          </div>
          {errorMessage && (
            <div className="flex flex-col items-start gap-2">
              <StatusBadge variant="error">{errorMessage}</StatusBadge>
              {promptPackage.errorDetail && (
                <span className="text-muted-foreground text-xs">
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
            <div className="flex items-center gap-2 text-muted-foreground text-sm">
              <Spinner />
              {t("promptPackage.building")}
            </div>
          )}
          {result && !errorMessage && (
            <PreviewSummary summary={result.summary} t={t} />
          )}
        </div>
      </div>

      <div className="ui-dialog-actions mt-4 border-border border-t pt-4">
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
