import { useCallback, useId, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { config } from "@/config";
import {
  buildBankWorkspacePath,
  sourceRefToRouteSource,
} from "@/domain/bank-route";
import { parseFormatFile, testRegex } from "@/domain/format";
import { fetchFileContent } from "@/domain/github";
import type { RepoRef, SourceRef } from "@/domain/types";
import { useDraftStore, useSourceStore } from "@/store";

const QUICK_CHECK_PARALLELISM = 4;

type RegexSource = "draft" | "remote";

type QuickCheckStatus = "match" | "no-match" | "invalid";

interface CachedRegexEntry {
  filePath: string;
  fileName: string;
  regex: string;
  source: RegexSource;
  fingerprint: string;
}

interface QuickCheckResult {
  filePath: string;
  fileName: string;
  regex: string;
  source: RegexSource;
  status: QuickCheckStatus;
  errorMessage: string | null;
}

interface QuickCheckSummary {
  totalFormats: number;
  checkedRegexes: number;
  matchedCount: number;
  invalidRegexCount: number;
  missingRegexCount: number;
  loadErrorsCount: number;
  remoteFetchedCount: number;
  cachedCount: number;
}

interface RemoteLoadResult {
  entries: CachedRegexEntry[];
  missingRegexCount: number;
  loadErrorsCount: number;
}

interface DraftEntryLike {
  content: string;
  timestamp: number;
}

interface DraftStoreLike {
  getDraft: (filePath: string) => DraftEntryLike | undefined;
}

interface LocalRegexPreparation {
  preparedEntries: CachedRegexEntry[];
  remotePathsToLoad: string[];
  missingRegexCount: number;
  cachedCount: number;
}

interface Props {
  bankName: string;
  bankPath: string;
  formatPaths: string[];
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

function parseRegexEntry(params: {
  filePath: string;
  content: string;
  source: RegexSource;
  fingerprint: string;
}): CachedRegexEntry | null {
  const { filePath, content, source, fingerprint } = params;
  const parsed = parseFormatFile(content, filePath);
  const regex = parsed.regex.trim();
  if (!regex) {
    return null;
  }

  return {
    filePath,
    fileName: extractFormatFileName(filePath),
    regex,
    source,
    fingerprint,
  };
}

function collectLocalRegexEntries(params: {
  filePaths: string[];
  draftStore: DraftStoreLike;
  cache: Map<string, CachedRegexEntry>;
  sourceRefName: string;
}): LocalRegexPreparation {
  const { filePaths, draftStore, cache, sourceRefName } = params;
  const preparedEntries: CachedRegexEntry[] = [];
  const remotePathsToLoad: string[] = [];
  let missingRegexCount = 0;
  let cachedCount = 0;

  for (const filePath of filePaths) {
    const draft = draftStore.getDraft(filePath);
    if (draft) {
      const draftFingerprint = buildDraftFingerprint(draft.timestamp);
      const cached = cache.get(filePath);
      if (cached && cached.fingerprint === draftFingerprint) {
        preparedEntries.push(cached);
        cachedCount += 1;
        continue;
      }

      const parsedDraftEntry = parseRegexEntry({
        filePath,
        content: draft.content,
        source: "draft",
        fingerprint: draftFingerprint,
      });
      if (!parsedDraftEntry) {
        cache.delete(filePath);
        missingRegexCount += 1;
        continue;
      }

      cache.set(filePath, parsedDraftEntry);
      preparedEntries.push(parsedDraftEntry);
      continue;
    }

    const remoteFingerprint = buildRemoteFingerprint(sourceRefName);
    const cached = cache.get(filePath);
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
    missingRegexCount,
    cachedCount,
  };
}

async function loadRemoteRegexEntries(params: {
  filePaths: string[];
  refName: string;
  repository: RepoRef;
}): Promise<RemoteLoadResult> {
  const { filePaths, refName, repository } = params;
  const fingerprint = buildRemoteFingerprint(refName);
  const queue = [...filePaths];
  const entries: CachedRegexEntry[] = [];
  let missingRegexCount = 0;
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
        const parsed = parseRegexEntry({
          filePath,
          content,
          source: "remote",
          fingerprint,
        });
        if (!parsed) {
          missingRegexCount += 1;
          continue;
        }
        entries.push(parsed);
      } catch {
        loadErrorsCount += 1;
      }
    }
  });

  await Promise.all(workers);
  return { entries, missingRegexCount, loadErrorsCount };
}

function evaluateQuickCheckResults(
  entries: CachedRegexEntry[],
  smsText: string
): QuickCheckResult[] {
  return entries.map((entry) => {
    const match = testRegex(entry.regex, smsText);
    if (match.error) {
      return {
        filePath: entry.filePath,
        fileName: entry.fileName,
        regex: entry.regex,
        source: entry.source,
        status: "invalid",
        errorMessage: match.error,
      };
    }

    return {
      filePath: entry.filePath,
      fileName: entry.fileName,
      regex: entry.regex,
      source: entry.source,
      status: match.matched ? "match" : "no-match",
      errorMessage: null,
    };
  });
}

function sortQuickCheckResults(
  results: QuickCheckResult[]
): QuickCheckResult[] {
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

function countByStatus(
  results: QuickCheckResult[],
  status: QuickCheckStatus
): number {
  return results.filter((result) => result.status === status).length;
}

function buildAppFileLink(params: {
  bankPath: string;
  filePath: string;
  repository: RepoRef;
  sourceRef: SourceRef | null;
}): string {
  const { bankPath, filePath, repository, sourceRef } = params;
  return buildBankWorkspacePath({
    bankPath,
    repository,
    source: sourceRefToRouteSource(sourceRef, config.defaultBranch),
    filePath,
  });
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
  bankPath,
  formatPaths,
  onClose,
}: Props) {
  const { t } = useTranslation();
  const dialogTitleId = useId();
  const smsInputId = useId();
  const navigate = useNavigate();
  const draftStore = useDraftStore();
  const sourceRef = useSourceStore((s) => s.sourceRef);
  const repository = useSourceStore((s) => s.repository);
  const sourceRefName = sourceRef?.sha ?? sourceRef?.name;

  const cacheRef = useRef(new Map<string, CachedRegexEntry>());
  const [smsText, setSmsText] = useState("");
  const [isChecking, setIsChecking] = useState(false);
  const [results, setResults] = useState<QuickCheckResult[]>([]);
  const [summary, setSummary] = useState<QuickCheckSummary | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const handleOpenInApp = useCallback(
    (filePath: string) => {
      navigate(
        buildAppFileLink({
          bankPath,
          filePath,
          repository,
          sourceRef,
        })
      );
      onClose();
    },
    [bankPath, navigate, onClose, repository, sourceRef]
  );

  const runQuickCheck = useCallback(async () => {
    if (!smsText.trim()) {
      setErrorMessage(t("quickCheck.emptySms"));
      setSummary(null);
      setResults([]);
      return;
    }
    if (!sourceRefName) {
      setErrorMessage(t("quickCheck.noSource"));
      setSummary(null);
      setResults([]);
      return;
    }

    setIsChecking(true);
    setErrorMessage(null);

    try {
      const localPreparation = collectLocalRegexEntries({
        filePaths: formatPaths,
        draftStore,
        cache: cacheRef.current,
        sourceRefName,
      });
      const remoteLoad = await loadRemoteRegexEntries({
        filePaths: localPreparation.remotePathsToLoad,
        refName: sourceRefName,
        repository,
      });

      for (const entry of remoteLoad.entries) {
        cacheRef.current.set(entry.filePath, entry);
        localPreparation.preparedEntries.push(entry);
      }

      const missingRegexCount =
        localPreparation.missingRegexCount + remoteLoad.missingRegexCount;
      const rawResults = evaluateQuickCheckResults(
        localPreparation.preparedEntries,
        smsText
      );
      const sortedResults = sortQuickCheckResults(rawResults);

      setSummary({
        totalFormats: formatPaths.length,
        checkedRegexes: sortedResults.length,
        matchedCount: countByStatus(sortedResults, "match"),
        invalidRegexCount: countByStatus(sortedResults, "invalid"),
        missingRegexCount,
        loadErrorsCount: remoteLoad.loadErrorsCount,
        remoteFetchedCount: localPreparation.remotePathsToLoad.length,
        cachedCount: localPreparation.cachedCount,
      });
      setResults(sortedResults);
    } catch {
      setSummary(null);
      setResults([]);
      setErrorMessage(t("quickCheck.unexpectedError"));
    } finally {
      setIsChecking(false);
    }
  }, [draftStore, formatPaths, repository, smsText, sourceRefName, t]);

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

        <div className="flex-col gap-xs">
          <label className="text-muted text-sm" htmlFor={smsInputId}>
            {t("quickCheck.smsLabel")}
          </label>
          <textarea
            className="textarea quick-check__input"
            id={smsInputId}
            onChange={(event) => setSmsText(event.target.value)}
            placeholder={t("quickCheck.smsPlaceholder")}
            value={smsText}
          />
          <div className="text-dim text-sm">
            {t("quickCheck.scopeInfo", { count: formatPaths.length })}
          </div>
        </div>

        {errorMessage && (
          <div
            aria-live="assertive"
            className="issue-item issue-item--error quick-check__feedback"
            role="alert"
          >
            {errorMessage}
          </div>
        )}

        {summary && (
          <div
            aria-live="polite"
            className="quick-check__summary"
            role="status"
          >
            <span className="badge badge--info">
              {t("quickCheck.summaryChecked", {
                checked: summary.checkedRegexes,
                total: summary.totalFormats,
              })}
            </span>
            <span className="badge badge--success">
              {t("quickCheck.summaryMatched", { count: summary.matchedCount })}
            </span>
            <span className="badge badge--warning">
              {t("quickCheck.summaryInvalid", {
                count: summary.invalidRegexCount,
              })}
            </span>
            <span className="badge badge--warning">
              {t("quickCheck.summaryMissingRegex", {
                count: summary.missingRegexCount,
              })}
            </span>
            <span className="badge badge--warning">
              {t("quickCheck.summaryLoadErrors", {
                count: summary.loadErrorsCount,
              })}
            </span>
            <span className="badge badge--modified">
              {t("quickCheck.summaryCache", {
                cached: summary.cachedCount,
                fetched: summary.remoteFetchedCount,
              })}
            </span>
          </div>
        )}

        <div className="quick-check__results">
          {summary && results.length === 0 && (
            <div className="text-muted text-sm">
              {t("quickCheck.noRegexes")}
            </div>
          )}
          {results.map((result) => (
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
                  <a
                    className="quick-check__link"
                    href={buildAppFileLink({
                      bankPath,
                      filePath: result.filePath,
                      repository,
                      sourceRef,
                    })}
                    onClick={(event) => {
                      event.preventDefault();
                      handleOpenInApp(result.filePath);
                    }}
                  >
                    {t("quickCheck.openInApp")}
                  </a>
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
