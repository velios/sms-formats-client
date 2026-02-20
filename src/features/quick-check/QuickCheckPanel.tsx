import { useCallback, useEffect, useId, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { parseFormatFile, testRegex } from "@/domain/format";
import { fetchFileContent } from "@/domain/github";
import type { RepoRef } from "@/domain/types";
import { useDraftStore, useSourceStore } from "@/store";

const QUICK_CHECK_PARALLELISM = 4;

export type QuickCheckMode = "template-by-sms" | "sms-by-template";

type RegexSource = "draft" | "remote";

type QuickCheckStatus = "match" | "no-match" | "invalid";

export interface QuickCheckActiveFormatContext {
  filePath: string;
  regex: string;
  activeExampleIndex: number;
  activeSmsText: string;
}

interface CachedFormatEntry {
  filePath: string;
  fileName: string;
  regex: string;
  examples: string[];
  source: RegexSource;
  fingerprint: string;
}

interface TemplateBySmsResult {
  filePath: string;
  fileName: string;
  regex: string;
  source: RegexSource;
  status: QuickCheckStatus;
  errorMessage: string | null;
}

interface SmsByTemplateResult {
  filePath: string;
  fileName: string;
  source: RegexSource;
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

interface RemoteLoadResult {
  entries: CachedFormatEntry[];
  loadErrorsCount: number;
}

interface DraftEntryLike {
  content: string;
  timestamp: number;
}

interface DraftStoreLike {
  getDraft: (filePath: string) => DraftEntryLike | undefined;
}

interface LocalFormatPreparation {
  preparedEntries: CachedFormatEntry[];
  remotePathsToLoad: string[];
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

function buildDraftFingerprint(timestamp: number): string {
  return `draft:${timestamp}`;
}

function buildRemoteFingerprint(refName: string): string {
  return `remote:${refName}`;
}

function buildCacheKey(repository: RepoRef, filePath: string): string {
  return `${repository.owner}/${repository.repo}:${filePath}`;
}

function normalizeExampleText(value: string): string {
  return value.trim();
}

function parseFormatEntry(params: {
  filePath: string;
  content: string;
  source: RegexSource;
  fingerprint: string;
}): CachedFormatEntry {
  const { filePath, content, source, fingerprint } = params;
  const parsed = parseFormatFile(content, filePath);

  return {
    filePath,
    fileName: extractFormatFileName(filePath),
    regex: parsed.regex.trim(),
    examples: parsed.examples.map(normalizeExampleText).filter(Boolean),
    source,
    fingerprint,
  };
}

function collectLocalFormatEntries(params: {
  filePaths: string[];
  draftStore: DraftStoreLike;
  cache: Map<string, CachedFormatEntry>;
  sourceRefName: string;
  repository: RepoRef;
}): LocalFormatPreparation {
  const { filePaths, draftStore, cache, sourceRefName, repository } = params;
  const preparedEntries: CachedFormatEntry[] = [];
  const remotePathsToLoad: string[] = [];
  let cachedCount = 0;

  for (const filePath of filePaths) {
    const cacheKey = buildCacheKey(repository, filePath);
    const draft = draftStore.getDraft(filePath);
    if (draft) {
      const draftFingerprint = buildDraftFingerprint(draft.timestamp);
      const cached = cache.get(cacheKey);
      if (cached && cached.fingerprint === draftFingerprint) {
        preparedEntries.push(cached);
        cachedCount += 1;
        continue;
      }

      const parsedDraftEntry = parseFormatEntry({
        filePath,
        content: draft.content,
        source: "draft",
        fingerprint: draftFingerprint,
      });
      cache.set(cacheKey, parsedDraftEntry);
      preparedEntries.push(parsedDraftEntry);
      continue;
    }

    const remoteFingerprint = buildRemoteFingerprint(sourceRefName);
    const cached = cache.get(cacheKey);
    if (cached && cached.fingerprint === remoteFingerprint) {
      preparedEntries.push(cached);
      cachedCount += 1;
      continue;
    }

    remotePathsToLoad.push(filePath);
  }

  return {
    preparedEntries,
    remotePathsToLoad,
    cachedCount,
  };
}

async function loadRemoteFormatEntries(params: {
  filePaths: string[];
  refName: string;
  repository: RepoRef;
}): Promise<RemoteLoadResult> {
  const { filePaths, refName, repository } = params;
  const fingerprint = buildRemoteFingerprint(refName);
  const queue = [...filePaths];
  const entries: CachedFormatEntry[] = [];
  let loadErrorsCount = 0;

  const workerCount = Math.min(QUICK_CHECK_PARALLELISM, queue.length);
  const workers = Array.from({ length: workerCount }, async () => {
    while (queue.length > 0) {
      const filePath = queue.shift();
      if (!filePath) {
        break;
      }

      try {
        const content = await fetchFileContent(filePath, refName, repository);
        entries.push(
          parseFormatEntry({
            filePath,
            content,
            source: "remote",
            fingerprint,
          })
        );
      } catch {
        loadErrorsCount += 1;
      }
    }
  });

  await Promise.all(workers);
  return { entries, loadErrorsCount };
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
  const evaluated: TemplateBySmsResult[] = [];
  let checkedRegexes = 0;
  let matchedCount = 0;
  let invalidRegexCount = 0;
  let missingRegexCount = 0;

  for (const entry of entries) {
    if (!entry.regex) {
      missingRegexCount += 1;
      continue;
    }

    checkedRegexes += 1;
    const match = testRegex(entry.regex, smsText);
    if (match.error) {
      invalidRegexCount += 1;
      evaluated.push({
        filePath: entry.filePath,
        fileName: entry.fileName,
        regex: entry.regex,
        source: entry.source,
        status: "invalid",
        errorMessage: match.error,
      });
      continue;
    }

    const status: QuickCheckStatus = match.matched ? "match" : "no-match";
    if (status === "match") {
      matchedCount += 1;
    }

    evaluated.push({
      filePath: entry.filePath,
      fileName: entry.fileName,
      regex: entry.regex,
      source: entry.source,
      status,
      errorMessage: null,
    });
  }

  return {
    summary: {
      checkedRegexes,
      matchedCount,
      invalidRegexCount,
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
    let matchedExamples = 0;
    let firstMatchedExample: string | null = null;

    for (const example of entry.examples) {
      const result = testRegex(regex, example);
      if (!result.matched) {
        continue;
      }

      matchedExamples += 1;
      if (!firstMatchedExample) {
        firstMatchedExample = example;
      }
    }

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

const sharedFormatCache = new Map<string, CachedFormatEntry>();

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

  const cacheRef = useRef(sharedFormatCache);
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
      const templateValidation = testRegex(templateRegex, "");
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
      const localPreparation = collectLocalFormatEntries({
        filePaths: formatPaths,
        draftStore,
        cache: cacheRef.current,
        sourceRefName,
        repository,
      });
      const remoteLoad = await loadRemoteFormatEntries({
        filePaths: localPreparation.remotePathsToLoad,
        refName: sourceRefName,
        repository,
      });

      const preparedEntries = [...localPreparation.preparedEntries];
      for (const entry of remoteLoad.entries) {
        cacheRef.current.set(buildCacheKey(repository, entry.filePath), entry);
        preparedEntries.push(entry);
      }

      if (mode === "template-by-sms") {
        const evaluated = evaluateTemplateBySms(preparedEntries, smsText);
        setRunState({
          mode,
          results: evaluated.results,
          summary: {
            totalFormats: formatPaths.length,
            checkedRegexes: evaluated.summary.checkedRegexes,
            matchedCount: evaluated.summary.matchedCount,
            invalidRegexCount: evaluated.summary.invalidRegexCount,
            missingRegexCount: evaluated.summary.missingRegexCount,
            loadErrorsCount: remoteLoad.loadErrorsCount,
            remoteFetchedCount: localPreparation.remotePathsToLoad.length,
            cachedCount: localPreparation.cachedCount,
          },
        });
        return;
      }

      const evaluated = evaluateSmsByTemplate(preparedEntries, templateRegex);
      setRunState({
        mode,
        results: evaluated.results,
        summary: {
          totalFormats: formatPaths.length,
          checkedSmsCount: evaluated.summary.checkedSmsCount,
          matchedSmsCount: evaluated.summary.matchedSmsCount,
          matchedFormatsCount: evaluated.summary.matchedFormatsCount,
          missingExamplesCount: evaluated.summary.missingExamplesCount,
          loadErrorsCount: remoteLoad.loadErrorsCount,
          remoteFetchedCount: localPreparation.remotePathsToLoad.length,
          cachedCount: localPreparation.cachedCount,
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
    <div className="modal-overlay" onClick={onClose}>
      <div
        aria-labelledby={dialogTitleId}
        aria-modal="true"
        className="modal quick-check-modal"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        style={{ minWidth: 760, maxWidth: 960 }}
      >
        <div className="modal__title" id={dialogTitleId}>
          {t("quickCheck.title", { bank: bankName })}
        </div>

        <div className="quick-check__mode-switch" role="tablist">
          <button
            className={`tab ${mode === "template-by-sms" ? "tab--active" : ""}`.trim()}
            onClick={() => handleSwitchMode("template-by-sms")}
            role="tab"
            type="button"
          >
            {t("quickCheck.openTemplateBySms")}
          </button>
          <button
            className={`tab ${mode === "sms-by-template" ? "tab--active" : ""}`.trim()}
            onClick={() => handleSwitchMode("sms-by-template")}
            role="tab"
            type="button"
          >
            {t("quickCheck.openSmsByTemplate")}
          </button>
        </div>

        {mode === "template-by-sms" ? (
          <div className="flex-col gap-xs">
            <label className="text-muted text-sm" htmlFor={inputId}>
              {t("quickCheck.smsLabel")}
            </label>
            <textarea
              className="textarea quick-check__input"
              id={inputId}
              onChange={(event) => setSmsText(event.target.value)}
              placeholder={t("quickCheck.smsPlaceholder")}
              value={smsText}
            />
            <div className="text-dim text-sm">
              {t("quickCheck.scopeInfo", { count: formatPaths.length })}
            </div>
            {activeFormatContext && (
              <div className="text-dim text-sm">
                {t("quickCheck.activeSmsSource", {
                  file: extractFormatFileName(activeFormatContext.filePath),
                  index: activeFormatContext.activeExampleIndex + 1,
                })}
              </div>
            )}
          </div>
        ) : (
          <div className="flex-col gap-xs">
            <label className="text-muted text-sm" htmlFor={inputId}>
              {t("quickCheck.templateRegexLabel")}
            </label>
            <textarea
              className="textarea quick-check__template-input"
              id={inputId}
              onChange={(event) => setTemplateRegex(event.target.value)}
              placeholder={t("quickCheck.templateRegexPlaceholder")}
              value={templateRegex}
            />
            <div className="text-dim text-sm">
              {t("quickCheck.scopeInfo", { count: formatPaths.length })}
            </div>
            {activeFormatContext && (
              <div className="text-dim text-sm">
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
            className="issue-item issue-item--error quick-check__feedback"
            role="alert"
          >
            {errorMessage}
          </div>
        )}

        {templateBySmsState && (
          <div
            aria-live="polite"
            className="quick-check__summary"
            role="status"
          >
            <span className="badge badge--info">
              {t("quickCheck.summaryChecked", {
                checked: templateBySmsState.summary.checkedRegexes,
                total: templateBySmsState.summary.totalFormats,
              })}
            </span>
            <span className="badge badge--success">
              {t("quickCheck.summaryMatched", {
                count: templateBySmsState.summary.matchedCount,
              })}
            </span>
            <span className="badge badge--warning">
              {t("quickCheck.summaryInvalid", {
                count: templateBySmsState.summary.invalidRegexCount,
              })}
            </span>
            <span className="badge badge--warning">
              {t("quickCheck.summaryMissingRegex", {
                count: templateBySmsState.summary.missingRegexCount,
              })}
            </span>
            <span className="badge badge--warning">
              {t("quickCheck.summaryLoadErrors", {
                count: templateBySmsState.summary.loadErrorsCount,
              })}
            </span>
            <span className="badge badge--modified">
              {t("quickCheck.summaryCache", {
                cached: templateBySmsState.summary.cachedCount,
                fetched: templateBySmsState.summary.remoteFetchedCount,
              })}
            </span>
          </div>
        )}

        {smsByTemplateState && (
          <div
            aria-live="polite"
            className="quick-check__summary"
            role="status"
          >
            <span className="badge badge--info">
              {t("quickCheck.summaryCheckedSms", {
                checked: smsByTemplateState.summary.checkedSmsCount,
                total: smsByTemplateState.summary.totalFormats,
              })}
            </span>
            <span className="badge badge--success">
              {t("quickCheck.summaryMatchedSms", {
                count: smsByTemplateState.summary.matchedSmsCount,
              })}
            </span>
            <span className="badge badge--success">
              {t("quickCheck.summaryMatchedFormats", {
                count: smsByTemplateState.summary.matchedFormatsCount,
              })}
            </span>
            <span className="badge badge--warning">
              {t("quickCheck.summaryMissingExamples", {
                count: smsByTemplateState.summary.missingExamplesCount,
              })}
            </span>
            <span className="badge badge--warning">
              {t("quickCheck.summaryLoadErrors", {
                count: smsByTemplateState.summary.loadErrorsCount,
              })}
            </span>
            <span className="badge badge--modified">
              {t("quickCheck.summaryCache", {
                cached: smsByTemplateState.summary.cachedCount,
                fetched: smsByTemplateState.summary.remoteFetchedCount,
              })}
            </span>
          </div>
        )}

        <div className="quick-check__results">
          {templateBySmsState && templateBySmsState.results.length === 0 && (
            <div className="text-muted text-sm">
              {t("quickCheck.noRegexes")}
            </div>
          )}

          {templateBySmsState?.results.map((result) => (
            <div className="quick-check__result" key={result.filePath}>
              <div className="quick-check__result-header">
                <span className="text-mono text-sm">{result.fileName}</span>
                <span
                  className={`badge ${
                    result.status === "match"
                      ? "badge--success"
                      : result.status === "invalid"
                        ? "badge--warning"
                        : "badge--info"
                  }`}
                >
                  {result.status === "match"
                    ? t("quickCheck.resultMatch")
                    : result.status === "invalid"
                      ? t("quickCheck.resultInvalid")
                      : t("quickCheck.resultNoMatch")}
                </span>
                <span className="badge badge--info">
                  {result.source === "draft"
                    ? t("quickCheck.sourceDraft")
                    : t("quickCheck.sourceRemote")}
                </span>
              </div>
              <pre className="quick-check__regex">{result.regex}</pre>
              {result.status === "match" && sourceRefName && (
                <div className="quick-check__links">
                  <button
                    className="quick-check__link"
                    onClick={() => handleOpenInApp(result.filePath)}
                    type="button"
                  >
                    {t("quickCheck.openInApp")}
                  </button>
                  <a
                    className="quick-check__link"
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
                <div className="text-muted text-sm">{result.errorMessage}</div>
              )}
            </div>
          ))}

          {smsByTemplateState && smsByTemplateState.results.length === 0 && (
            <div className="text-muted text-sm">
              {t("quickCheck.noFormats")}
            </div>
          )}

          {smsByTemplateState?.results.map((result) => (
            <div className="quick-check__result" key={result.filePath}>
              <div className="quick-check__result-header">
                <span className="text-mono text-sm">{result.fileName}</span>
                <span
                  className={`badge ${
                    result.status === "match" ? "badge--success" : "badge--info"
                  }`}
                >
                  {result.status === "match"
                    ? t("quickCheck.resultMatch")
                    : t("quickCheck.resultNoMatch")}
                </span>
                <span className="badge badge--info">
                  {t("quickCheck.smsMatchesInFormat", {
                    matched: result.matchedExamples,
                    total: result.totalExamples,
                  })}
                </span>
                <span className="badge badge--info">
                  {result.source === "draft"
                    ? t("quickCheck.sourceDraft")
                    : t("quickCheck.sourceRemote")}
                </span>
              </div>
              {result.firstMatchedExample && (
                <pre className="quick-check__regex">
                  {result.firstMatchedExample}
                </pre>
              )}
              {result.status === "match" && sourceRefName && (
                <div className="quick-check__links">
                  <button
                    className="quick-check__link"
                    onClick={() => handleOpenInApp(result.filePath)}
                    type="button"
                  >
                    {t("quickCheck.openInApp")}
                  </button>
                  <a
                    className="quick-check__link"
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

        <div className="modal__actions">
          <button className="btn" onClick={onClose}>
            {t("app.close")}
          </button>
          <button
            className="btn btn--primary"
            disabled={isChecking}
            onClick={() => void runQuickCheck()}
          >
            {isChecking ? (
              <>
                <span className="spinner" />
                {t("quickCheck.running")}
              </>
            ) : (
              t("quickCheck.run")
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
