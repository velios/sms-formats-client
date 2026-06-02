import { useCallback, useEffect, useId, useState } from "react";
import { useTranslation } from "react-i18next";
import { ModalDialog } from "@/components/ModalDialog";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { StatusBadge } from "@/components/ui/status-badge";
import { Textarea } from "@/components/ui/textarea";
import { recognizeSms, regexesBySms, smsesByRegex } from "@/domain/format";
import type { RepoRef } from "@/domain/types";
import { cn } from "@/lib/utils";
import { useDraftStore, useSourceStore } from "@/store";
import { type CachedFormatEntry, prepareFormatEntries } from "./format-entries";

export type QuickCheckMode = "template-by-sms" | "sms-by-template";

type QuickCheckStatus = "match" | "no-match" | "invalid";

export interface QuickCheckActiveFormatContext {
  filePath: string;
  regex: string;
  activeExampleIndex: number;
  activeSmsText: string;
}

interface TemplateBySmsResult {
  filePath: string;
  fileName: string;
  regex: string;
  source: "draft" | "remote";
  status: QuickCheckStatus;
  errorMessage: string | null;
}

interface SmsByTemplateResult {
  filePath: string;
  fileName: string;
  source: "draft" | "remote";
  status: "match" | "no-match";
  matchedExamples: number;
  totalExamples: number;
  firstMatchedExample: string | null;
}

interface TemplateBySmsSummary {
  totalFormats: number;
  checkedRegexes: number;
  matchedCount: number;
  invalidRegexCount: number;
  missingRegexCount: number;
  loadErrorsCount: number;
  remoteFetchedCount: number;
  cachedCount: number;
}

interface SmsByTemplateSummary {
  totalFormats: number;
  checkedSmsCount: number;
  matchedSmsCount: number;
  matchedFormatsCount: number;
  missingExamplesCount: number;
  loadErrorsCount: number;
  remoteFetchedCount: number;
  cachedCount: number;
}

interface TemplateBySmsEvaluation {
  results: TemplateBySmsResult[];
  summary: Omit<TemplateBySmsSummary, "totalFormats" | "loadErrorsCount">;
}

interface SmsByTemplateEvaluation {
  results: SmsByTemplateResult[];
  summary: Omit<SmsByTemplateSummary, "totalFormats" | "loadErrorsCount">;
}

type QuickCheckRunState =
  | {
      mode: "template-by-sms";
      summary: TemplateBySmsSummary;
      results: TemplateBySmsResult[];
    }
  | {
      mode: "sms-by-template";
      summary: SmsByTemplateSummary;
      results: SmsByTemplateResult[];
    };

const quickCheckTabClassName = (isActive: boolean) =>
  cn(
    "cursor-pointer rounded-md border px-3 py-1.5 font-medium text-xs transition-[color,background-color,border-color,box-shadow] duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--c-border-focus)]",
    isActive
      ? "border-[color:var(--c-accent)] bg-[color:var(--c-bg-surface)] text-[color:var(--c-accent)] shadow-[inset_0_-2px_0_var(--c-accent)]"
      : "border-[color:var(--c-border)] bg-[color:var(--c-bg-elevated)] text-[color:var(--c-text-muted)] hover:border-[color:var(--c-accent-soft)] hover:bg-[color:var(--c-bg-surface)] hover:text-[color:var(--c-accent)]"
  );

interface Props {
  bankName: string;
  formatPaths: string[];
  initialMode: QuickCheckMode;
  activeFormatContext: QuickCheckActiveFormatContext | null;
  onOpenFileInApp: (filePath: string) => void;
  onClose: () => void;
}

function extractFormatFileName(path: string): string {
  return path.split("/").pop() ?? path;
}

function sortTemplateBySmsResults(
  results: TemplateBySmsResult[]
): TemplateBySmsResult[] {
  const rank: Record<QuickCheckStatus, number> = {
    match: 0,
    invalid: 1,
    "no-match": 2,
  };
  return [...results].sort((a, b) => {
    const byStatus = rank[a.status] - rank[b.status];
    if (byStatus !== 0) {
      return byStatus;
    }
    return a.fileName.localeCompare(b.fileName, undefined, {
      sensitivity: "base",
    });
  });
}

function sortSmsByTemplateResults(
  results: SmsByTemplateResult[]
): SmsByTemplateResult[] {
  return [...results].sort((a, b) => {
    if (a.status !== b.status) {
      return a.status === "match" ? -1 : 1;
    }
    if (a.matchedExamples !== b.matchedExamples) {
      return b.matchedExamples - a.matchedExamples;
    }
    return a.fileName.localeCompare(b.fileName, undefined, {
      sensitivity: "base",
    });
  });
}

function evaluateTemplateBySms(
  entries: CachedFormatEntry[],
  smsText: string
): TemplateBySmsEvaluation {
  const entriesWithRegex = entries.filter((entry) => entry.regex);
  const missingRegexCount = entries.length - entriesWithRegex.length;
  const recognitions = regexesBySms(
    entriesWithRegex.map((entry) => entry.regex),
    smsText
  );

  const evaluated: TemplateBySmsResult[] = entriesWithRegex.map((entry, i) => {
    const { matched, error } = recognitions[i]!;
    if (error) {
      return {
        filePath: entry.filePath,
        fileName: entry.fileName,
        regex: entry.regex,
        source: entry.source,
        status: "invalid",
        errorMessage: error,
      };
    }

    return {
      filePath: entry.filePath,
      fileName: entry.fileName,
      regex: entry.regex,
      source: entry.source,
      status: matched ? "match" : "no-match",
      errorMessage: null,
    };
  });

  return {
    summary: {
      checkedRegexes: entriesWithRegex.length,
      matchedCount: evaluated.filter((r) => r.status === "match").length,
      invalidRegexCount: evaluated.filter((r) => r.status === "invalid").length,
      missingRegexCount,
      remoteFetchedCount: 0,
      cachedCount: 0,
    },
    results: sortTemplateBySmsResults(evaluated),
  };
}

function evaluateSmsByTemplate(
  entries: CachedFormatEntry[],
  regex: string
): SmsByTemplateEvaluation {
  const evaluated: SmsByTemplateResult[] = entries.map((entry) => {
    const { matched } = smsesByRegex(entry.examples, regex);
    const matchedExamples = matched.filter(Boolean).length;
    const firstMatchedExample =
      entry.examples[matched.findIndex(Boolean)] ?? null;

    return {
      filePath: entry.filePath,
      fileName: entry.fileName,
      source: entry.source,
      status: matchedExamples > 0 ? "match" : "no-match",
      matchedExamples,
      totalExamples: entry.examples.length,
      firstMatchedExample,
    };
  });

  const checkedSmsCount = evaluated.reduce(
    (sum, item) => sum + item.totalExamples,
    0
  );
  const matchedSmsCount = evaluated.reduce(
    (sum, item) => sum + item.matchedExamples,
    0
  );
  const matchedFormatsCount = evaluated.filter(
    (item) => item.status === "match"
  ).length;
  const missingExamplesCount = evaluated.filter(
    (item) => item.totalExamples === 0
  ).length;

  return {
    summary: {
      checkedSmsCount,
      matchedSmsCount,
      matchedFormatsCount,
      missingExamplesCount,
      remoteFetchedCount: 0,
      cachedCount: 0,
    },
    results: sortSmsByTemplateResults(evaluated),
  };
}

function buildGitHubFileLink(params: {
  filePath: string;
  repository: RepoRef;
  refName: string;
}): string {
  const { filePath, repository, refName } = params;
  const encodedPath = filePath.split("/").map(encodeURIComponent).join("/");
  return `https://github.com/${repository.owner}/${repository.repo}/blob/${encodeURIComponent(refName)}/${encodedPath}#L1`;
}

export function QuickCheckPanel({
  bankName,
  formatPaths,
  initialMode,
  activeFormatContext,
  onOpenFileInApp,
  onClose,
}: Props) {
  const { t } = useTranslation();
  const dialogTitleId = useId();
  const inputId = useId();
  const draftStore = useDraftStore();
  const sourceRef = useSourceStore((s) => s.sourceRef);
  const repository = useSourceStore((s) => s.repository);
  const sourceRefName = sourceRef?.sha ?? sourceRef?.name;
  const prNumber =
    sourceRef?.type === "pr" && sourceRef.prNumber ? sourceRef.prNumber : null;

  const [mode, setMode] = useState<QuickCheckMode>(initialMode);
  const [smsText, setSmsText] = useState(
    activeFormatContext?.activeSmsText ?? ""
  );
  const [templateRegex, setTemplateRegex] = useState(
    activeFormatContext?.regex ?? ""
  );
  const [isChecking, setIsChecking] = useState(false);
  const [runState, setRunState] = useState<QuickCheckRunState | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    setMode(initialMode);
  }, [initialMode]);

  useEffect(() => {
    if (!activeFormatContext) {
      return;
    }
    setSmsText((previous) => previous || activeFormatContext.activeSmsText);
    setTemplateRegex((previous) => previous || activeFormatContext.regex);
  }, [activeFormatContext]);

  const handleOpenInApp = useCallback(
    (filePath: string) => {
      onOpenFileInApp(filePath);
      onClose();
    },
    [onClose, onOpenFileInApp]
  );

  const handleSwitchMode = useCallback(
    (nextMode: QuickCheckMode) => {
      setMode(nextMode);
      setErrorMessage(null);
      if (nextMode === "template-by-sms") {
        setSmsText(
          (previous) => previous || activeFormatContext?.activeSmsText || ""
        );
        return;
      }
      setTemplateRegex(
        (previous) => previous || activeFormatContext?.regex || ""
      );
    },
    [activeFormatContext]
  );

  const runQuickCheck = useCallback(async () => {
    if (!sourceRefName) {
      setErrorMessage(t("quickCheck.noSource"));
      setRunState(null);
      return;
    }

    if (mode === "template-by-sms" && !smsText.trim()) {
      setErrorMessage(t("quickCheck.emptySms"));
      setRunState(null);
      return;
    }

    if (mode === "sms-by-template" && !templateRegex.trim()) {
      setErrorMessage(t("quickCheck.emptyTemplateRegex"));
      setRunState(null);
      return;
    }

    if (mode === "sms-by-template") {
      const templateValidation = recognizeSms(templateRegex, "");
      if (templateValidation.error) {
        setErrorMessage(
          t("quickCheck.invalidTemplateRegex", {
            message: templateValidation.error,
          })
        );
        setRunState(null);
        return;
      }
    }

    setIsChecking(true);
    setErrorMessage(null);

    try {
      if (!prNumber) {
        setErrorMessage(t("quickCheck.noSource"));
        setRunState(null);
        return;
      }
      const prepared = await prepareFormatEntries({
        filePaths: formatPaths,
        draftStore,
        prNumber,
        sourceRefName,
        repository,
      });

      if (mode === "template-by-sms") {
        const evaluated = evaluateTemplateBySms(prepared.entries, smsText);
        setRunState({
          mode,
          results: evaluated.results,
          summary: {
            totalFormats: formatPaths.length,
            checkedRegexes: evaluated.summary.checkedRegexes,
            matchedCount: evaluated.summary.matchedCount,
            invalidRegexCount: evaluated.summary.invalidRegexCount,
            missingRegexCount: evaluated.summary.missingRegexCount,
            loadErrorsCount: prepared.loadErrorsCount,
            remoteFetchedCount: prepared.remoteFetchedCount,
            cachedCount: prepared.cachedCount,
          },
        });
        return;
      }

      const evaluated = evaluateSmsByTemplate(prepared.entries, templateRegex);
      setRunState({
        mode,
        results: evaluated.results,
        summary: {
          totalFormats: formatPaths.length,
          checkedSmsCount: evaluated.summary.checkedSmsCount,
          matchedSmsCount: evaluated.summary.matchedSmsCount,
          matchedFormatsCount: evaluated.summary.matchedFormatsCount,
          missingExamplesCount: evaluated.summary.missingExamplesCount,
          loadErrorsCount: prepared.loadErrorsCount,
          remoteFetchedCount: prepared.remoteFetchedCount,
          cachedCount: prepared.cachedCount,
        },
      });
    } catch {
      setRunState(null);
      setErrorMessage(t("quickCheck.unexpectedError"));
    } finally {
      setIsChecking(false);
    }
  }, [
    draftStore,
    formatPaths,
    mode,
    prNumber,
    repository,
    smsText,
    sourceRefName,
    t,
    templateRegex,
  ]);

  const templateBySmsState =
    runState?.mode === "template-by-sms" ? runState : null;
  const smsByTemplateState =
    runState?.mode === "sms-by-template" ? runState : null;

  return (
    <ModalDialog
      className="flex max-h-[min(88vh,880px)] flex-col sm:max-w-[760px] lg:max-w-[960px]"
      onClose={onClose}
      title={t("quickCheck.title", { bank: bankName })}
      titleId={dialogTitleId}
    >
      <div className="mb-4 flex gap-1" role="tablist">
        <button
          className={quickCheckTabClassName(mode === "template-by-sms")}
          onClick={() => handleSwitchMode("template-by-sms")}
          role="tab"
          type="button"
        >
          {t("quickCheck.openTemplateBySms")}
        </button>
        <button
          className={quickCheckTabClassName(mode === "sms-by-template")}
          onClick={() => handleSwitchMode("sms-by-template")}
          role="tab"
          type="button"
        >
          {t("quickCheck.openSmsByTemplate")}
        </button>
      </div>

      {mode === "template-by-sms" ? (
        <div className="flex flex-col gap-1">
          <label
            className="text-[color:var(--c-text-muted)] text-xs"
            htmlFor={inputId}
          >
            {t("quickCheck.smsLabel")}
          </label>
          <Textarea
            className="min-h-[120px] font-mono"
            id={inputId}
            onChange={(event) => setSmsText(event.target.value)}
            placeholder={t("quickCheck.smsPlaceholder")}
            value={smsText}
          />
          <div className="text-[color:var(--c-text-dim)] text-xs">
            {t("quickCheck.scopeInfo", { count: formatPaths.length })}
          </div>
          {activeFormatContext && (
            <div className="text-[color:var(--c-text-dim)] text-xs">
              {t("quickCheck.activeSmsSource", {
                file: extractFormatFileName(activeFormatContext.filePath),
                index: activeFormatContext.activeExampleIndex + 1,
              })}
            </div>
          )}
        </div>
      ) : (
        <div className="flex flex-col gap-1">
          <label
            className="text-[color:var(--c-text-muted)] text-xs"
            htmlFor={inputId}
          >
            {t("quickCheck.templateRegexLabel")}
          </label>
          <Textarea
            className="min-h-[88px] font-mono"
            id={inputId}
            onChange={(event) => setTemplateRegex(event.target.value)}
            placeholder={t("quickCheck.templateRegexPlaceholder")}
            value={templateRegex}
          />
          <div className="text-[color:var(--c-text-dim)] text-xs">
            {t("quickCheck.scopeInfo", { count: formatPaths.length })}
          </div>
          {activeFormatContext && (
            <div className="text-[color:var(--c-text-dim)] text-xs">
              {t("quickCheck.activeTemplateSource", {
                file: extractFormatFileName(activeFormatContext.filePath),
              })}
            </div>
          )}
        </div>
      )}

      {errorMessage && (
        <div
          aria-live="assertive"
          className="mt-2 rounded-[var(--radius-sm)] bg-[color:var(--c-error-soft)] px-3 py-2 text-[color:var(--c-error)] text-xs"
          role="alert"
        >
          {errorMessage}
        </div>
      )}

      {templateBySmsState && (
        <div
          aria-live="polite"
          className="mt-4 flex flex-wrap gap-1"
          role="status"
        >
          <StatusBadge variant="info">
            {t("quickCheck.summaryChecked", {
              checked: templateBySmsState.summary.checkedRegexes,
              total: templateBySmsState.summary.totalFormats,
            })}
          </StatusBadge>
          <StatusBadge variant="success">
            {t("quickCheck.summaryMatched", {
              count: templateBySmsState.summary.matchedCount,
            })}
          </StatusBadge>
          <StatusBadge variant="warning">
            {t("quickCheck.summaryInvalid", {
              count: templateBySmsState.summary.invalidRegexCount,
            })}
          </StatusBadge>
          <StatusBadge variant="warning">
            {t("quickCheck.summaryMissingRegex", {
              count: templateBySmsState.summary.missingRegexCount,
            })}
          </StatusBadge>
          <StatusBadge variant="warning">
            {t("quickCheck.summaryLoadErrors", {
              count: templateBySmsState.summary.loadErrorsCount,
            })}
          </StatusBadge>
          <StatusBadge variant="modified">
            {t("quickCheck.summaryCache", {
              cached: templateBySmsState.summary.cachedCount,
              fetched: templateBySmsState.summary.remoteFetchedCount,
            })}
          </StatusBadge>
        </div>
      )}

      {smsByTemplateState && (
        <div
          aria-live="polite"
          className="mt-4 flex flex-wrap gap-1"
          role="status"
        >
          <StatusBadge variant="info">
            {t("quickCheck.summaryCheckedSms", {
              checked: smsByTemplateState.summary.checkedSmsCount,
              total: smsByTemplateState.summary.totalFormats,
            })}
          </StatusBadge>
          <StatusBadge variant="success">
            {t("quickCheck.summaryMatchedSms", {
              count: smsByTemplateState.summary.matchedSmsCount,
            })}
          </StatusBadge>
          <StatusBadge variant="success">
            {t("quickCheck.summaryMatchedFormats", {
              count: smsByTemplateState.summary.matchedFormatsCount,
            })}
          </StatusBadge>
          <StatusBadge variant="warning">
            {t("quickCheck.summaryMissingExamples", {
              count: smsByTemplateState.summary.missingExamplesCount,
            })}
          </StatusBadge>
          <StatusBadge variant="warning">
            {t("quickCheck.summaryLoadErrors", {
              count: smsByTemplateState.summary.loadErrorsCount,
            })}
          </StatusBadge>
          <StatusBadge variant="modified">
            {t("quickCheck.summaryCache", {
              cached: smsByTemplateState.summary.cachedCount,
              fetched: smsByTemplateState.summary.remoteFetchedCount,
            })}
          </StatusBadge>
        </div>
      )}

      <div className="mt-4 flex max-h-[420px] flex-col gap-2 overflow-y-auto">
        {templateBySmsState && templateBySmsState.results.length === 0 && (
          <div className="text-[color:var(--c-text-muted)] text-sm">
            {t("quickCheck.noRegexes")}
          </div>
        )}

        {templateBySmsState?.results.map((result) => (
          <div
            className="rounded-[var(--radius-sm)] border border-[color:var(--c-border)] bg-[color:var(--c-bg-elevated)] p-2"
            key={result.filePath}
          >
            <div className="mb-1 flex items-center gap-1">
              <span className="font-mono text-sm">{result.fileName}</span>
              <StatusBadge
                variant={
                  result.status === "match"
                    ? "success"
                    : result.status === "invalid"
                      ? "warning"
                      : "info"
                }
              >
                {result.status === "match"
                  ? t("quickCheck.resultMatch")
                  : result.status === "invalid"
                    ? t("quickCheck.resultInvalid")
                    : t("quickCheck.resultNoMatch")}
              </StatusBadge>
              <StatusBadge variant="info">
                {result.source === "draft"
                  ? t("quickCheck.sourceDraft")
                  : t("quickCheck.sourceRemote")}
              </StatusBadge>
            </div>
            <pre className="m-0 whitespace-pre-wrap break-words font-mono text-[color:var(--c-text)] text-xs leading-6">
              {result.regex}
            </pre>
            {result.status === "match" && sourceRefName && (
              <div className="mt-1 flex items-center gap-2">
                <button
                  className="border-0 bg-transparent p-0 text-[color:var(--c-accent)] text-xs hover:underline"
                  onClick={() => handleOpenInApp(result.filePath)}
                  type="button"
                >
                  {t("quickCheck.openInApp")}
                </button>
                <a
                  className="text-[color:var(--c-accent)] text-xs no-underline hover:underline"
                  href={buildGitHubFileLink({
                    filePath: result.filePath,
                    repository,
                    refName: sourceRefName,
                  })}
                  rel="noreferrer"
                  target="_blank"
                >
                  {t("quickCheck.openInGitHub")}
                </a>
              </div>
            )}
            {result.errorMessage && (
              <div className="text-[color:var(--c-text-muted)] text-sm">
                {result.errorMessage}
              </div>
            )}
          </div>
        ))}

        {smsByTemplateState && smsByTemplateState.results.length === 0 && (
          <div className="text-[color:var(--c-text-muted)] text-sm">
            {t("quickCheck.noFormats")}
          </div>
        )}

        {smsByTemplateState?.results.map((result) => (
          <div
            className="rounded-[var(--radius-sm)] border border-[color:var(--c-border)] bg-[color:var(--c-bg-elevated)] p-2"
            key={result.filePath}
          >
            <div className="mb-1 flex items-center gap-1">
              <span className="font-mono text-sm">{result.fileName}</span>
              <StatusBadge
                variant={result.status === "match" ? "success" : "info"}
              >
                {result.status === "match"
                  ? t("quickCheck.resultMatch")
                  : t("quickCheck.resultNoMatch")}
              </StatusBadge>
              <StatusBadge variant="info">
                {t("quickCheck.smsMatchesInFormat", {
                  matched: result.matchedExamples,
                  total: result.totalExamples,
                })}
              </StatusBadge>
              <StatusBadge variant="info">
                {result.source === "draft"
                  ? t("quickCheck.sourceDraft")
                  : t("quickCheck.sourceRemote")}
              </StatusBadge>
            </div>
            {result.firstMatchedExample && (
              <pre className="m-0 whitespace-pre-wrap break-words font-mono text-[color:var(--c-text)] text-xs leading-6">
                {result.firstMatchedExample}
              </pre>
            )}
            {result.status === "match" && sourceRefName && (
              <div className="mt-1 flex items-center gap-2">
                <button
                  className="border-0 bg-transparent p-0 text-[color:var(--c-accent)] text-xs hover:underline"
                  onClick={() => handleOpenInApp(result.filePath)}
                  type="button"
                >
                  {t("quickCheck.openInApp")}
                </button>
                <a
                  className="text-[color:var(--c-accent)] text-xs no-underline hover:underline"
                  href={buildGitHubFileLink({
                    filePath: result.filePath,
                    repository,
                    refName: sourceRefName,
                  })}
                  rel="noreferrer"
                  target="_blank"
                >
                  {t("quickCheck.openInGitHub")}
                </a>
              </div>
            )}
          </div>
        ))}
      </div>

      <div className="mt-6 flex justify-end gap-2">
        <Button onClick={onClose} type="button" variant="default">
          {t("app.close")}
        </Button>
        <Button
          disabled={isChecking}
          onClick={() => void runQuickCheck()}
          type="button"
          variant="primary"
        >
          {isChecking ? (
            <>
              <Spinner />
              {t("quickCheck.running")}
            </>
          ) : (
            t("quickCheck.run")
          )}
        </Button>
      </div>
    </ModalDialog>
  );
}
