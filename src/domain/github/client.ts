import { Octokit } from "@octokit/rest";
import { config } from "@/config";
import type { BankInfo, FileEntry, PullRequestLabel, RepoRef } from "../types";
import { decodeBase64Utf8, encodeBase64Utf8 } from "./encoding";

const defaultRepoRef: RepoRef = {
  owner: config.defaultSourceOwner,
  repo: config.defaultSourceRepo,
};

const sourceRepoRef: RepoRef = {
  owner: config.sourceOwner,
  repo: config.sourceRepo,
};

const GITHUB_USER_TOKEN_STORAGE_KEY = "sms-formats-github-user-token";
const PR_APPROVAL_PERMISSION_STORAGE_KEY =
  "sms-formats-pr-approval-permissions";

interface PullRequestApprovalPermissionEntry {
  canApprove: boolean;
}

interface ValidatorCheckOutput {
  title?: string | null;
  summary?: string | null;
  text?: string | null;
}

interface ValidatorCheckRun {
  id?: number;
  name?: string | null;
  conclusion?: string | null;
  output?: ValidatorCheckOutput | null;
  html_url?: string | null;
  details_url?: string | null;
}

type PullRequestApprovalPermissionCache = Record<
  string,
  PullRequestApprovalPermissionEntry
>;

type GitHubAuthChangeListener = () => void;

const VALIDATOR_CHECK_NAME_FRAGMENT = "validate";
const MAX_VALIDATOR_ERROR_LINES = 6;
const VALIDATE_FORMATS_STEP_NAME = "validate formats";

interface ValidatorFailureResult {
  failedValidationCount: number;
  validationErrors: string[];
  validationUrl: string | null;
}

interface CommitAuthorIdentity {
  login?: string | null;
  name?: string | null;
}

interface CommitAuthorMetadata {
  author?: CommitAuthorIdentity | null;
  committer?: CommitAuthorIdentity | null;
}

export interface PullRequestChangedFile {
  kind: "add" | "modify" | "delete" | "rename";
  path: string;
  oldPath?: string;
}

export type PullRequestWorkspaceResolution =
  | {
      status: "supported";
      repository: RepoRef;
      prNumber: number;
      headSha: string;
      baseSha: string;
      bankPath: string;
      writable: boolean;
      readOnlyReason: "no-write-access" | null;
      changedFiles: PullRequestChangedFile[];
    }
  | {
      status: "unsupported";
      reason: "no-bank-changes" | "multiple-banks" | "outside-bank-scope";
    }
  | {
      status: "unavailable";
      reason: "not-found" | "closed" | "merged" | "inaccessible";
    }
  | {
      status: "transient-error";
      reason: "network" | "timeout" | "rate-limit" | "unknown";
    };

interface PullRequestWorkspaceSnapshot {
  repository: RepoRef;
  prNumber: number;
  state: "open" | "closed";
  merged: boolean;
  headSha: string;
  baseSha: string;
  canWriteRepository: boolean;
  maintainerCanModify: boolean | null;
  headRepository: RepoRef | null;
  changedFiles: PullRequestChangedFile[];
}

function resolveRepo(repoRef?: RepoRef): RepoRef {
  return repoRef ?? defaultRepoRef;
}

function isSameRepository(left: RepoRef, right: RepoRef): boolean {
  return left.owner === right.owner && left.repo === right.repo;
}

function resolveBankPathFromFilePath(path: string | undefined): string | null {
  if (!path?.startsWith("src/")) {
    return null;
  }
  const [root, bank] = path.split("/");
  if (!(root === "src" && bank)) {
    return null;
  }
  return `src/${bank}`;
}

function resolvePullRequestBankPath(changedFiles: PullRequestChangedFile[]):
  | { status: "supported"; bankPath: string }
  | {
      status: "unsupported";
      reason: "no-bank-changes" | "multiple-banks" | "outside-bank-scope";
    } {
  if (changedFiles.length === 0) {
    return {
      status: "unsupported",
      reason: "no-bank-changes",
    };
  }

  const bankPaths = new Set<string>();
  for (const file of changedFiles) {
    const bankPath = resolveBankPathFromFilePath(file.path);
    if (!bankPath) {
      return {
        status: "unsupported",
        reason: "outside-bank-scope",
      };
    }
    if (file.kind === "rename") {
      const oldBankPath = resolveBankPathFromFilePath(file.oldPath);
      if (!(oldBankPath && oldBankPath === bankPath)) {
        return {
          status: "unsupported",
          reason: "outside-bank-scope",
        };
      }
    }
    bankPaths.add(bankPath);
  }

  if (bankPaths.size !== 1) {
    return {
      status: "unsupported",
      reason: "multiple-banks",
    };
  }

  return {
    status: "supported",
    bankPath: Array.from(bankPaths)[0] ?? "",
  };
}

function normalizePullRequestChangedFile(file: {
  filename?: string | null;
  status?: string | null;
  previous_filename?: string | null;
}): PullRequestChangedFile | null {
  const path = file.filename?.trim();
  if (!path) {
    return null;
  }

  switch (file.status) {
    case "added":
      return { kind: "add", path };
    case "removed":
      return { kind: "delete", path };
    case "renamed":
      return {
        kind: "rename",
        path,
        oldPath: file.previous_filename?.trim() || undefined,
      };
    default:
      return { kind: "modify", path };
  }
}

function resolvePullRequestWritable(
  snapshot: PullRequestWorkspaceSnapshot
): boolean {
  if (!snapshot.canWriteRepository) {
    return false;
  }
  if (
    snapshot.headRepository &&
    isSameRepository(snapshot.headRepository, snapshot.repository)
  ) {
    return true;
  }
  return snapshot.maintainerCanModify === true;
}

export function resolvePullRequestWorkspaceSnapshot(
  snapshot: PullRequestWorkspaceSnapshot
): PullRequestWorkspaceResolution {
  if (snapshot.merged) {
    return {
      status: "unavailable",
      reason: "merged",
    };
  }
  if (snapshot.state !== "open") {
    return {
      status: "unavailable",
      reason: "closed",
    };
  }

  const bankResolution = resolvePullRequestBankPath(snapshot.changedFiles);
  if (bankResolution.status !== "supported") {
    return bankResolution;
  }

  const writable = resolvePullRequestWritable(snapshot);
  return {
    status: "supported",
    repository: snapshot.repository,
    prNumber: snapshot.prNumber,
    headSha: snapshot.headSha,
    baseSha: snapshot.baseSha,
    bankPath: bankResolution.bankPath,
    writable,
    readOnlyReason: writable ? null : "no-write-access",
    changedFiles: snapshot.changedFiles,
  };
}

export function classifyPullRequestResolverError(
  error: unknown
): Extract<
  PullRequestWorkspaceResolution,
  { status: "unavailable" } | { status: "transient-error" }
> {
  const candidate =
    error && typeof error === "object"
      ? (error as {
          status?: number;
          message?: string;
        })
      : {};
  const message = candidate.message?.toLowerCase() ?? "";

  if (candidate.status === 404) {
    return {
      status: "unavailable",
      reason: "not-found",
    };
  }
  if (candidate.status === 403 && !message.includes("rate limit")) {
    return {
      status: "unavailable",
      reason: "inaccessible",
    };
  }
  if (candidate.status === 429 || message.includes("rate limit")) {
    return {
      status: "transient-error",
      reason: "rate-limit",
    };
  }
  if (message.includes("timeout")) {
    return {
      status: "transient-error",
      reason: "timeout",
    };
  }
  if (
    message.includes("network") ||
    message.includes("fetch failed") ||
    message.includes("failed to fetch")
  ) {
    return {
      status: "transient-error",
      reason: "network",
    };
  }
  return {
    status: "transient-error",
    reason: "unknown",
  };
}

export function describeGraphqlBlobError(error: unknown): string {
  const candidate =
    error && typeof error === "object"
      ? (error as {
          errors?: Array<{ message?: string | null } | null> | null;
          message?: string;
        })
      : {};

  const graphqlMessages = (candidate.errors ?? [])
    .map((entry) => entry?.message?.trim())
    .filter((message): message is string => !!message);
  if (graphqlMessages.length > 0) {
    return graphqlMessages.join("; ");
  }
  return candidate.message?.trim() || "Unknown GraphQL error";
}

export function resolveCommitAuthorLabel(commit: {
  author?: CommitAuthorIdentity | null;
  committer?: CommitAuthorIdentity | null;
  commit?: CommitAuthorMetadata | null;
}): string | null {
  return (
    commit.author?.login ??
    commit.committer?.login ??
    commit.commit?.author?.name ??
    commit.commit?.committer?.name ??
    null
  );
}

function countApprovedReviews(
  reviews: Array<{
    user?: { login?: string } | null;
    state?: string | null;
  }>
): number {
  const latestStateByReviewer = resolveLatestReviewStateByReviewer(reviews);

  let approvedCount = 0;
  for (const state of latestStateByReviewer.values()) {
    if (state === "APPROVED") {
      approvedCount += 1;
    }
  }
  return approvedCount;
}

function resolveLatestReviewStateByReviewer(
  reviews: Array<{
    user?: { login?: string } | null;
    state?: string | null;
  }>
): Map<string, string> {
  const latestStateByReviewer = new Map<string, string>();
  for (const review of reviews) {
    const login = review.user?.login;
    if (!login) {
      continue;
    }
    latestStateByReviewer.set(login, review.state ?? "");
  }
  return latestStateByReviewer;
}

function stripAnsiCodes(value: string): string {
  let output = "";
  let skippingAnsiSequence = false;

  for (const char of value) {
    if (char === "\u001b") {
      skippingAnsiSequence = true;
      continue;
    }
    if (skippingAnsiSequence) {
      if (char === "m") {
        skippingAnsiSequence = false;
      }
      continue;
    }
    output += char;
  }

  return output;
}

function normalizeValidatorLine(line: string): string {
  return line
    .split("\n")
    .map((part) => stripAnsiCodes(part))
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}

function stripActionsLogPrefix(line: string): string {
  return line
    .replace(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z\s+/, "")
    .replace(/^\d+\s+/, "")
    .trim();
}

function canonicalizeValidatorMessage(line: string): string {
  return normalizeValidatorLine(stripActionsLogPrefix(line)).toLowerCase();
}

function uniqueValidatorMessages(lines: string[]): string[] {
  const unique = new Map<string, string>();
  for (const rawLine of lines) {
    const line = normalizeValidatorLine(stripActionsLogPrefix(rawLine));
    if (!line) {
      continue;
    }
    const canonical = canonicalizeValidatorMessage(line);
    if (!unique.has(canonical)) {
      unique.set(canonical, line);
    }
  }
  return Array.from(unique.values());
}

function isLikelyValidatorLine(line: string): boolean {
  const normalized = line.toLowerCase();
  if (!normalized) {
    return false;
  }
  if (
    normalized.startsWith("run ") ||
    normalized.startsWith("process completed") ||
    normalized.startsWith("set up job") ||
    normalized.startsWith("post ")
  ) {
    return false;
  }
  return (
    normalized.includes("validation failed") ||
    normalized.includes("error") ||
    normalized.includes(".txt:") ||
    normalized.includes("example ") ||
    normalized.includes("matches ")
  );
}

function isGenericValidatorFailureLine(line: string): boolean {
  const normalized = line.toLowerCase();
  return (
    normalized.includes("process completed with exit code") ||
    normalized.includes(".github/workflows/")
  );
}

function extractValidatorErrorMessages(
  output: ValidatorCheckOutput | null | undefined
): string[] {
  const combined = [output?.title, output?.summary, output?.text]
    .filter((item): item is string => Boolean(item))
    .join("\n");

  if (!combined.trim()) {
    return [];
  }

  const lines = combined
    .split("\n")
    .map((line) => normalizeValidatorLine(line))
    .filter(Boolean);
  const likelyErrors = lines.filter((line) => isLikelyValidatorLine(line));
  const selected = likelyErrors.length > 0 ? likelyErrors : lines;
  return uniqueValidatorMessages(selected)
    .filter((line) => !isGenericValidatorFailureLine(line))
    .slice(0, MAX_VALIDATOR_ERROR_LINES);
}

function isFailedValidatorRun(checkRun: ValidatorCheckRun): boolean {
  const name = checkRun.name?.toLowerCase() ?? "";
  return (
    checkRun.conclusion === "failure" &&
    name.includes(VALIDATOR_CHECK_NAME_FRAGMENT)
  );
}

function formatValidatorErrorLines(
  failedRuns: ValidatorCheckRun[],
  perRunErrors: string[][]
): string[] {
  const lines = failedRuns.flatMap((_, index) => perRunErrors[index] ?? []);
  return uniqueValidatorMessages(lines).slice(0, MAX_VALIDATOR_ERROR_LINES);
}

function extractValidatorAnnotationMessages(
  annotations: Array<{
    path?: string | null;
    start_line?: number | null;
    title?: string | null;
    message?: string | null;
  }>
): string[] {
  return annotations
    .map((annotation) => {
      const path = annotation.path?.trim() || "";
      const line = annotation.start_line ? `:${annotation.start_line}` : "";
      const title = annotation.title?.trim() || "";
      const message = annotation.message?.trim() || "";
      const combined = [title, message].filter(Boolean).join(" — ");
      if (!combined) {
        return "";
      }
      const location = path ? `${path}${line}: ` : "";
      return normalizeValidatorLine(`${location}${combined}`);
    })
    .filter((line) => line && !isGenericValidatorFailureLine(line))
    .map((line) => stripActionsLogPrefix(line))
    .filter(Boolean)
    .filter((line) => !isGenericValidatorFailureLine(line))
    .filter((line) => line.toLowerCase() !== "validate")
    .filter((line) => !isValidationDelimiterLine(line))
    .filter((line) => !line.toLowerCase().includes(VALIDATE_FORMATS_STEP_NAME))
    .filter((line) => !line.toLowerCase().includes("validation failed"))
    .filter((line) => !line.toLowerCase().includes("error(s) in"))
    .filter((line) => !line.toLowerCase().startsWith("run "))
    .filter((line) => !line.toLowerCase().includes("example "))
    .filter((line) => !line.toLowerCase().includes("matches "))
    .slice(0, MAX_VALIDATOR_ERROR_LINES);
}

function extractActionsJobId(
  detailsUrl: string | null | undefined
): number | null {
  if (!detailsUrl) {
    return null;
  }
  const match = detailsUrl.match(/\/job\/(\d+)(?:[/?#]|$)/);
  if (!match?.[1]) {
    return null;
  }
  const parsed = Number.parseInt(match[1], 10);
  return Number.isInteger(parsed) ? parsed : null;
}

function extractActionsRunId(
  detailsUrl: string | null | undefined
): number | null {
  if (!detailsUrl) {
    return null;
  }
  const match = detailsUrl.match(/\/runs\/(\d+)(?:[/?#]|$)/);
  if (!match?.[1]) {
    return null;
  }
  const parsed = Number.parseInt(match[1], 10);
  return Number.isInteger(parsed) ? parsed : null;
}

function isValidationDelimiterLine(line: string): boolean {
  return /={10,}/.test(line);
}

function extractLinesBetweenValidationDelimiters(lines: string[]): string[] {
  const extracted: string[] = [];
  let insideBlock = false;

  for (const line of lines) {
    if (isValidationDelimiterLine(line)) {
      insideBlock = !insideBlock;
      continue;
    }
    if (!insideBlock) {
      continue;
    }
    extracted.push(line);
  }

  return extracted
    .map((line) => normalizeValidatorLine(stripActionsLogPrefix(line)))
    .filter(Boolean)
    .filter((line) => !isGenericValidatorFailureLine(line));
}

function extractValidatorMessagesFromActionsLog(logText: string): string[] {
  if (!logText.trim()) {
    return [];
  }
  const lines = logText
    .split("\n")
    .map((line) => normalizeValidatorLine(stripActionsLogPrefix(line)))
    .filter(Boolean)
    .filter((line) => !isGenericValidatorFailureLine(line))
    .filter((line) => line.toLowerCase() !== "validate");

  const validateStepStartIndex = lines.findIndex((line) =>
    line.toLowerCase().includes(VALIDATE_FORMATS_STEP_NAME)
  );

  const validationFailedIndex = lines.findIndex((line) =>
    line.toLowerCase().includes("validation failed")
  );

  const focusedLines = (() => {
    if (validateStepStartIndex >= 0) {
      return lines.slice(validateStepStartIndex);
    }
    if (validationFailedIndex >= 0) {
      const start = Math.max(0, validationFailedIndex - 4);
      const end = Math.min(lines.length, validationFailedIndex + 18);
      return lines.slice(start, end);
    }
    return lines;
  })();

  const delimitedLines = extractLinesBetweenValidationDelimiters(focusedLines);
  if (delimitedLines.length > 0) {
    return uniqueValidatorMessages(delimitedLines).slice(
      0,
      MAX_VALIDATOR_ERROR_LINES
    );
  }

  const likelyErrors = focusedLines.filter((line) =>
    isLikelyValidatorLine(line)
  );
  const structuredErrors = likelyErrors.filter((line) => {
    const normalized = line.toLowerCase();
    return (
      normalized.includes(".txt:") ||
      normalized.includes("validation failed") ||
      normalized.includes("error(s) in") ||
      normalized.includes("matches ")
    );
  });

  const selected =
    structuredErrors.length > 0 ? structuredErrors : likelyErrors;
  return uniqueValidatorMessages(selected).slice(0, MAX_VALIDATOR_ERROR_LINES);
}

async function readUnknownResponseAsText(data: unknown): Promise<string> {
  if (typeof data === "string") {
    return data;
  }
  if (data instanceof ArrayBuffer) {
    return new TextDecoder().decode(data);
  }
  if (typeof Blob !== "undefined" && data instanceof Blob) {
    return data.text();
  }
  if (
    typeof data === "object" &&
    data !== null &&
    "text" in data &&
    typeof (data as { text?: unknown }).text === "function"
  ) {
    try {
      return await (data as { text: () => Promise<string> }).text();
    } catch {
      return "";
    }
  }
  return "";
}

async function fetchActionsJobLogText(
  jobId: number,
  repo: RepoRef
): Promise<string> {
  try {
    const response = await publicOctokit.request(
      "GET /repos/{owner}/{repo}/actions/jobs/{job_id}/logs",
      {
        owner: repo.owner,
        repo: repo.repo,
        job_id: jobId,
      }
    );
    const direct = await readUnknownResponseAsText(response.data);
    if (direct.trim()) {
      return direct;
    }
    const location =
      (response.headers as Record<string, string | undefined>).location ?? "";
    if (!location) {
      return "";
    }
    const redirectedResponse = await fetch(location);
    if (!redirectedResponse.ok) {
      return "";
    }
    return redirectedResponse.text();
  } catch {
    return "";
  }
}

async function resolveFailedActionsJobId(
  checkRun: ValidatorCheckRun,
  repo: RepoRef
): Promise<number | null> {
  const fromDetails = extractActionsJobId(checkRun.details_url);
  if (fromDetails) {
    return fromDetails;
  }

  const runId = extractActionsRunId(checkRun.details_url);
  if (!runId) {
    return null;
  }
  try {
    const jobsResponse = await publicOctokit.actions.listJobsForWorkflowRun({
      owner: repo.owner,
      repo: repo.repo,
      run_id: runId,
      per_page: 100,
    });
    const failedValidateJob = jobsResponse.data.jobs.find((job) => {
      const name = job.name?.toLowerCase() ?? "";
      return job.conclusion === "failure" && name.includes("validate");
    });
    if (failedValidateJob?.id) {
      return failedValidateJob.id;
    }
    const firstFailedJob = jobsResponse.data.jobs.find(
      (job) => job.conclusion === "failure"
    );
    return firstFailedJob?.id ?? null;
  } catch {
    return null;
  }
}

async function fetchValidatorErrorsFromActionsLog(
  checkRun: ValidatorCheckRun,
  repo: RepoRef
): Promise<string[]> {
  const jobId = await resolveFailedActionsJobId(checkRun, repo);
  if (!jobId) {
    return [];
  }
  const logText = await fetchActionsJobLogText(jobId, repo);
  return extractValidatorMessagesFromActionsLog(logText);
}

async function fetchDetailedValidatorRunErrors(
  checkRun: ValidatorCheckRun,
  repo: RepoRef
): Promise<string[]> {
  const checkRunId = checkRun.id;
  if (!checkRunId) {
    return [];
  }

  try {
    const checkRunResponse = await publicOctokit.checks.get({
      owner: repo.owner,
      repo: repo.repo,
      check_run_id: checkRunId,
    });
    const detailedOutputErrors = extractValidatorErrorMessages(
      checkRunResponse.data.output
    );
    if (detailedOutputErrors.length > 0) {
      return detailedOutputErrors;
    }
  } catch {
    // Ignore and fallback to annotations.
  }

  try {
    const annotations = await publicOctokit.paginate(
      publicOctokit.checks.listAnnotations,
      {
        owner: repo.owner,
        repo: repo.repo,
        check_run_id: checkRunId,
        per_page: 100,
      }
    );
    const annotationErrors = extractValidatorAnnotationMessages(annotations);
    if (annotationErrors.length > 0) {
      return annotationErrors;
    }
  } catch {
    // Ignore annotation fetching errors and return empty list.
  }

  const actionLogErrors = await fetchValidatorErrorsFromActionsLog(
    checkRun,
    repo
  );
  if (actionLogErrors.length > 0) {
    return actionLogErrors;
  }

  return [];
}

async function fetchValidatorFailuresByHeadSha(
  headSha: string,
  repo: RepoRef,
  loadDetailedErrors = false
): Promise<ValidatorFailureResult> {
  try {
    const checks = await publicOctokit.checks.listForRef({
      owner: repo.owner,
      repo: repo.repo,
      ref: headSha,
      per_page: 100,
    });
    const failedRuns = checks.data.check_runs.filter((checkRun) =>
      isFailedValidatorRun(checkRun)
    );
    if (failedRuns.length === 0) {
      return {
        failedValidationCount: 0,
        validationErrors: [],
        validationUrl: null,
      };
    }

    const perRunErrors = await Promise.all(
      failedRuns.map(async (checkRun) => {
        const extractedErrors = extractValidatorErrorMessages(checkRun.output);
        if (extractedErrors.length > 0 || !loadDetailedErrors) {
          return extractedErrors;
        }
        return fetchDetailedValidatorRunErrors(checkRun, repo);
      })
    );

    return {
      failedValidationCount: failedRuns.length,
      validationErrors: formatValidatorErrorLines(failedRuns, perRunErrors),
      validationUrl:
        failedRuns.find((run) => run.html_url)?.html_url?.trim() || null,
    };
  } catch {
    return {
      failedValidationCount: 0,
      validationErrors: [],
      validationUrl: null,
    };
  }
}

// ─── Default API client (uses shared env token when provided) ───

const sharedToken = config.issueToken.trim();

function createPublicOctokit(token: string): Octokit {
  return token ? new Octokit({ auth: token }) : new Octokit();
}

// GitHub serves authenticated GETs with `Cache-Control: private, max-age=60`,
// so the browser HTTP cache (under Octokit's fetch) keeps returning the
// pre-write body for ~60s — even across page reloads. Appending a unique query
// param changes the cache key, forcing a fresh read right after we push.
function cacheBustParam(forceFresh?: boolean): { _cb?: number } {
  return forceFresh ? { _cb: Date.now() } : {};
}

function readStoredGitHubUserToken(): string {
  if (typeof window === "undefined") {
    return "";
  }
  try {
    return localStorage.getItem(GITHUB_USER_TOKEN_STORAGE_KEY)?.trim() ?? "";
  } catch {
    return "";
  }
}

function persistGitHubUserToken(token: string): void {
  if (typeof window === "undefined") {
    return;
  }
  try {
    if (token) {
      localStorage.setItem(GITHUB_USER_TOKEN_STORAGE_KEY, token);
      return;
    }
    if (typeof localStorage.removeItem === "function") {
      localStorage.removeItem(GITHUB_USER_TOKEN_STORAGE_KEY);
      return;
    }
    localStorage.setItem(GITHUB_USER_TOKEN_STORAGE_KEY, "");
  } catch {
    // Ignore localStorage errors (e.g. disabled storage in browser profile).
  }
}

function getRepoSlug(repoRef?: RepoRef): string {
  const repo = resolveRepo(repoRef);
  return `${repo.owner}/${repo.repo}`;
}

function readPullRequestApprovalPermissionCache(): PullRequestApprovalPermissionCache {
  if (typeof window === "undefined") {
    return {};
  }
  try {
    const raw = localStorage.getItem(PR_APPROVAL_PERMISSION_STORAGE_KEY);
    if (!raw) {
      return {};
    }
    const parsed = JSON.parse(raw) as PullRequestApprovalPermissionCache;
    if (typeof parsed !== "object" || parsed === null) {
      return {};
    }
    return parsed;
  } catch {
    return {};
  }
}

function writePullRequestApprovalPermissionCache(
  value: PullRequestApprovalPermissionCache
): void {
  if (typeof window === "undefined") {
    return;
  }
  try {
    localStorage.setItem(
      PR_APPROVAL_PERMISSION_STORAGE_KEY,
      JSON.stringify(value)
    );
  } catch {
    // Ignore localStorage errors (e.g. disabled storage in browser profile).
  }
}

function clearPullRequestApprovalPermissionCache(): void {
  if (typeof window === "undefined") {
    return;
  }
  try {
    if (typeof localStorage.removeItem === "function") {
      localStorage.removeItem(PR_APPROVAL_PERMISSION_STORAGE_KEY);
      return;
    }
    localStorage.setItem(PR_APPROVAL_PERMISSION_STORAGE_KEY, "{}");
  } catch {
    // Ignore localStorage errors (e.g. disabled storage in browser profile).
  }
}

function canApproveByRepositoryPermission(
  permissions:
    | {
        admin?: boolean;
        maintain?: boolean;
        push?: boolean;
      }
    | undefined
): boolean {
  if (!permissions) {
    return false;
  }
  return Boolean(permissions.admin || permissions.maintain || permissions.push);
}

let userToken = readStoredGitHubUserToken();
let publicOctokit = createPublicOctokit(userToken || sharedToken);
const githubAuthChangeListeners = new Set<GitHubAuthChangeListener>();
let githubAuthChangeVersion = 0;

function notifyGitHubAuthChange(): void {
  githubAuthChangeVersion += 1;
  for (const listener of githubAuthChangeListeners) {
    listener();
  }
}

export function createAuthenticatedOctokit(token: string): Octokit {
  return new Octokit({ auth: token });
}

export function getGitHubUserToken(): string | null {
  return userToken || null;
}

export function subscribeGitHubAuthChange(
  listener: GitHubAuthChangeListener
): () => void {
  githubAuthChangeListeners.add(listener);
  return () => {
    githubAuthChangeListeners.delete(listener);
  };
}

export function getGitHubAuthChangeVersion(): number {
  return githubAuthChangeVersion;
}

export function setGitHubUserToken(token: string | null): void {
  const nextToken = token?.trim() ?? "";
  const tokenChanged = nextToken !== userToken;
  userToken = nextToken;
  persistGitHubUserToken(userToken);
  publicOctokit = createPublicOctokit(userToken || sharedToken);
  if (tokenChanged) {
    clearPullRequestApprovalPermissionCache();
    notifyGitHubAuthChange();
  }
}

export function setCachedPullRequestApprovalPermission(
  canApprove: boolean,
  repoRef?: RepoRef
): void {
  const slug = getRepoSlug(repoRef);
  const cache = readPullRequestApprovalPermissionCache();
  cache[slug] = {
    canApprove,
  };
  writePullRequestApprovalPermissionCache(cache);
}

export function getCachedPullRequestApprovalPermission(
  repoRef?: RepoRef
): boolean {
  const slug = getRepoSlug(repoRef);
  const cache = readPullRequestApprovalPermissionCache();
  return cache[slug]?.canApprove === true;
}

export async function refreshPullRequestApprovalPermission(
  repoRef?: RepoRef
): Promise<boolean> {
  const slug = getRepoSlug(repoRef);
  const cache = readPullRequestApprovalPermissionCache();
  const cached = cache[slug];
  if (cached) {
    return cached.canApprove;
  }

  if (!userToken) {
    return false;
  }

  const repo = resolveRepo(repoRef);
  const octokit = createAuthenticatedOctokit(userToken);
  try {
    const response = await octokit.repos.get({
      owner: repo.owner,
      repo: repo.repo,
    });
    const canApprove = canApproveByRepositoryPermission(
      response.data.permissions
    );
    setCachedPullRequestApprovalPermission(canApprove, repoRef);
    return canApprove;
  } catch {
    setCachedPullRequestApprovalPermission(false, repoRef);
    return false;
  }
}

export async function approvePullRequest(
  prNumber: number,
  repoRef?: RepoRef
): Promise<void> {
  if (!userToken) {
    throw new Error("GitHub user token is not configured.");
  }
  const repo = resolveRepo(repoRef);
  const octokit = createAuthenticatedOctokit(userToken);
  await octokit.pulls.createReview({
    owner: repo.owner,
    repo: repo.repo,
    pull_number: prNumber,
    event: "APPROVE",
  });
}

export async function fetchPullRequestApprovalByCurrentUser(
  prNumber: number,
  repoRef?: RepoRef
): Promise<boolean> {
  if (!userToken) {
    return false;
  }

  const repo = resolveRepo(repoRef);
  const octokit = createAuthenticatedOctokit(userToken);
  const [user, reviews] = await Promise.all([
    octokit.users.getAuthenticated(),
    octokit.paginate(octokit.pulls.listReviews, {
      owner: repo.owner,
      repo: repo.repo,
      pull_number: prNumber,
      per_page: 100,
    }),
  ]);
  const login = user.data.login?.trim();
  if (!login) {
    return false;
  }

  return resolveLatestReviewStateByReviewer(reviews).get(login) === "APPROVED";
}

// ─── Source loading ───

export async function fetchBranches(
  repoRef?: RepoRef
): Promise<{ name: string; sha: string }[]> {
  const repo = resolveRepo(repoRef);
  const res = await publicOctokit.repos.listBranches({
    owner: repo.owner,
    repo: repo.repo,
    per_page: 100,
  });
  return res.data.map((b) => ({ name: b.name, sha: b.commit.sha }));
}

export async function fetchOpenPRs(
  repoRef?: RepoRef,
  options?: { forceFresh?: boolean }
): Promise<
  {
    number: number;
    title: string;
    headRef: string;
    headSha: string;
    headOwner: string;
    headRepo: string;
    approvedCount: number;
    failedValidationCount: number;
    validationErrors: string[];
    validationUrl: string | null;
    lastCommitAuthorLogin: string | null;
    labels: PullRequestLabel[];
  }[]
> {
  async function fetchApprovedCount(prNumber: number, repo: RepoRef) {
    try {
      const reviews = await publicOctokit.paginate(
        publicOctokit.pulls.listReviews,
        {
          owner: repo.owner,
          repo: repo.repo,
          pull_number: prNumber,
          per_page: 100,
        }
      );
      return countApprovedReviews(reviews);
    } catch {
      return 0;
    }
  }

  async function fetchLastCommitAuthorLogin(
    commitSha: string,
    repo: RepoRef
  ): Promise<string | null> {
    try {
      const commit = await publicOctokit.repos.getCommit({
        owner: repo.owner,
        repo: repo.repo,
        ref: commitSha,
      });
      return resolveCommitAuthorLabel(commit.data);
    } catch {
      return null;
    }
  }

  const repo = resolveRepo(repoRef);
  const res = await publicOctokit.pulls.list({
    owner: repo.owner,
    repo: repo.repo,
    state: "open",
    per_page: 100,
    ...cacheBustParam(options?.forceFresh),
  });
  const openPrs = res.data;
  return Promise.all(
    openPrs.map(async (pr) => {
      const headRepo: RepoRef = {
        owner: pr.head.repo?.owner?.login ?? repo.owner,
        repo: pr.head.repo?.name ?? repo.repo,
      };
      const [approvedCount, validation, lastCommitAuthorLogin] =
        await Promise.all([
          fetchApprovedCount(pr.number, repo),
          fetchValidatorFailuresByHeadSha(pr.head.sha, repo),
          fetchLastCommitAuthorLogin(pr.head.sha, headRepo),
        ]);

      return {
        number: pr.number,
        title: pr.title,
        headRef: pr.head.ref,
        headSha: pr.head.sha,
        headOwner: headRepo.owner,
        headRepo: headRepo.repo,
        approvedCount,
        failedValidationCount: validation.failedValidationCount,
        validationErrors: validation.validationErrors,
        validationUrl: validation.validationUrl,
        lastCommitAuthorLogin,
        labels: (pr.labels ?? [])
          .flatMap((label) => {
            if (typeof label === "string" || !label.name) {
              return [];
            }
            return [
              {
                name: label.name,
                color: label.color ?? "d1d9e0",
              },
            ];
          })
          .sort((a, b) =>
            a.name.localeCompare(b.name, undefined, { sensitivity: "base" })
          ),
      };
    })
  );
}

export async function fetchPullRequestValidationDetails(
  prNumber: number,
  repoRef?: RepoRef
): Promise<ValidatorFailureResult> {
  const repo = resolveRepo(repoRef);
  const pullRequest = await publicOctokit.pulls.get({
    owner: repo.owner,
    repo: repo.repo,
    pull_number: prNumber,
  });
  const details = await fetchValidatorFailuresByHeadSha(
    pullRequest.data.head.sha,
    repo,
    true
  );
  return {
    ...details,
    validationUrl:
      details.validationUrl?.trim() ||
      `https://github.com/${repo.owner}/${repo.repo}/pull/${prNumber}/checks`,
  };
}

export async function resolvePullRequestWorkspace(
  prNumber: number,
  repoRef?: RepoRef,
  options?: { forceFresh?: boolean; headShaOverride?: string }
): Promise<PullRequestWorkspaceResolution> {
  const repo = resolveRepo(repoRef);

  try {
    const [pullRequest, canWriteRepository, files] = await Promise.all([
      publicOctokit.pulls.get({
        owner: repo.owner,
        repo: repo.repo,
        pull_number: prNumber,
        ...cacheBustParam(options?.forceFresh),
      }),
      refreshPullRequestApprovalPermission(repo),
      publicOctokit.paginate(publicOctokit.pulls.listFiles, {
        owner: repo.owner,
        repo: repo.repo,
        pull_number: prNumber,
        per_page: 100,
        ...cacheBustParam(options?.forceFresh),
      }),
    ]);

    const headRepository =
      pullRequest.data.head.repo?.owner?.login &&
      pullRequest.data.head.repo?.name
        ? {
            owner: pullRequest.data.head.repo.owner.login,
            repo: pullRequest.data.head.repo.name,
          }
        : null;

    return resolvePullRequestWorkspaceSnapshot({
      repository: repo,
      prNumber,
      state: pullRequest.data.state === "open" ? "open" : "closed",
      merged: pullRequest.data.merged === true,
      headSha: options?.headShaOverride ?? pullRequest.data.head.sha,
      baseSha: pullRequest.data.base.sha,
      canWriteRepository,
      maintainerCanModify: pullRequest.data.maintainer_can_modify ?? null,
      headRepository,
      changedFiles: files
        .map((file) => normalizePullRequestChangedFile(file))
        .filter((file): file is PullRequestChangedFile => file != null),
    });
  } catch (error) {
    return classifyPullRequestResolverError(error);
  }
}

export async function fetchPullRequestHead(
  prNumber: number,
  repoRef?: RepoRef
): Promise<{ headRef: string; headSha: string }> {
  const repo = resolveRepo(repoRef);
  const pr = await publicOctokit.pulls.get({
    owner: repo.owner,
    repo: repo.repo,
    pull_number: prNumber,
  });

  return {
    headRef: pr.data.head.ref,
    headSha: pr.data.head.sha,
  };
}

export async function fetchPullRequestCommits(
  prNumber: number,
  repoRef?: RepoRef
): Promise<Array<{ sha: string; message: string }>> {
  const repo = resolveRepo(repoRef);
  const commits = await publicOctokit.paginate(
    publicOctokit.pulls.listCommits,
    {
      owner: repo.owner,
      repo: repo.repo,
      pull_number: prNumber,
      per_page: 100,
    }
  );

  return commits
    .map((commit) => ({
      sha: commit.sha ?? "",
      message: commit.commit?.message?.split("\n")[0]?.trim() ?? "",
    }))
    .filter((commit) => commit.sha.length > 0);
}

export async function fetchPullRequestFiles(
  prNumber: number,
  repoRef?: RepoRef
): Promise<string[]> {
  const repo = resolveRepo(repoRef);
  const files = await publicOctokit.paginate(publicOctokit.pulls.listFiles, {
    owner: repo.owner,
    repo: repo.repo,
    pull_number: prNumber,
    per_page: 100,
  });

  return files
    .map((file) => file.filename)
    .filter((path): path is string => !!path);
}

export async function fetchBranchSha(
  branch: string,
  repoRef?: RepoRef
): Promise<string> {
  const repo = resolveRepo(repoRef);
  const res = await publicOctokit.repos.getBranch({
    owner: repo.owner,
    repo: repo.repo,
    branch,
  });
  return res.data.commit.sha;
}

export async function fetchSourceRepoForks(): Promise<RepoRef[]> {
  const forks = await publicOctokit.paginate(publicOctokit.repos.listForks, {
    owner: sourceRepoRef.owner,
    repo: sourceRepoRef.repo,
    per_page: 100,
  });

  const bySlug = new Map<string, RepoRef>();
  const addRepo = (owner: string, repo: string) => {
    const slug = `${owner}/${repo}`;
    if (!bySlug.has(slug)) {
      bySlug.set(slug, { owner, repo });
    }
  };

  addRepo(sourceRepoRef.owner, sourceRepoRef.repo);
  addRepo(defaultRepoRef.owner, defaultRepoRef.repo);

  for (const fork of forks) {
    const owner = fork.owner?.login;
    const repo = fork.name;
    if (owner && repo) {
      addRepo(owner, repo);
    }
  }

  const items = Array.from(bySlug.values());
  const sourceSlug = `${sourceRepoRef.owner}/${sourceRepoRef.repo}`;

  return items.sort((a, b) => {
    const aSlug = `${a.owner}/${a.repo}`;
    const bSlug = `${b.owner}/${b.repo}`;
    if (aSlug === sourceSlug) {
      return -1;
    }
    if (bSlug === sourceSlug) {
      return 1;
    }
    return aSlug.localeCompare(bSlug, undefined, { sensitivity: "base" });
  });
}

// ─── Tree and file loading ───

export async function fetchRepoTree(
  sha: string,
  repoRef?: RepoRef
): Promise<FileEntry[]> {
  const repo = resolveRepo(repoRef);
  const res = await publicOctokit.git.getTree({
    owner: repo.owner,
    repo: repo.repo,
    tree_sha: sha,
    recursive: "true",
  });
  return (res.data.tree as { path?: string; sha?: string; type?: string }[])
    .filter(
      (item): item is { path: string; sha: string; type: string } =>
        !!item.path && !!item.sha && !!item.type
    )
    .map((item) => ({
      path: item.path,
      sha: item.sha,
      type: item.type as "blob" | "tree",
    }));
}

export async function fetchFileContent(
  path: string,
  ref: string,
  repoRef?: RepoRef
): Promise<string> {
  const repo = resolveRepo(repoRef);
  const res = await publicOctokit.repos.getContent({
    owner: repo.owner,
    repo: repo.repo,
    path,
    ref,
  });
  const data = res.data as { content?: string; encoding?: string };
  if (data.content && data.encoding === "base64") {
    return decodeBase64Utf8(data.content.replace(/\n/g, ""));
  }
  throw new Error(`Unexpected content format for ${path}`);
}

// ─── Blob loading by ref (GraphQL) ───

// Three distinct outcomes, never collapsed into one "no file":
// - missing: no object at `<ref>:<path>` — the file is absent in this layer;
// - binary: the object is a Blob without text;
// - truncated: GitHub returned a cut-off body.
export type BlobFetchResult =
  | { path: string; status: "loaded"; text: string }
  | { path: string; status: "missing" }
  | { path: string; status: "binary" }
  | { path: string; status: "truncated" };

// GitHub has an undocumented cap on the number of aliases and a 10s timeout:
// one oversized request loses the whole package, so batches stay separate.
const BLOB_BATCH_SIZE = 50;

interface BlobNode {
  text?: string | null;
  isTruncated?: boolean | null;
}

interface BlobBatchResponse {
  repository: Record<string, BlobNode | null> | null;
}

function buildBlobBatchQuery(
  ref: string,
  paths: string[]
): { query: string; variables: Record<string, string> } {
  const declarations = paths
    .map((_, index) => `$e${index}: String!`)
    .join(", ");
  const selections = paths
    .map(
      (_, index) =>
        `f${index}: object(expression: $e${index}) { ... on Blob { text isTruncated } }`
    )
    .join("\n      ");
  const variables: Record<string, string> = {};
  for (const [index, path] of paths.entries()) {
    variables[`e${index}`] = `${ref}:${path}`;
  }
  return {
    query: `query($owner: String!, $name: String!, ${declarations}) {
  repository(owner: $owner, name: $name) {
      ${selections}
  }
}`,
    variables,
  };
}

function readBlobNode(path: string, node: BlobNode | null): BlobFetchResult {
  if (!node) {
    return { path, status: "missing" };
  }
  if (node.isTruncated) {
    return { path, status: "truncated" };
  }
  if (typeof node.text !== "string") {
    return { path, status: "binary" };
  }
  return { path, status: "loaded", text: node.text };
}

async function fetchBlobBatch(
  repo: RepoRef,
  ref: string,
  paths: string[]
): Promise<BlobFetchResult[]> {
  const { query, variables } = buildBlobBatchQuery(ref, paths);
  const response = await publicOctokit.graphql<BlobBatchResponse>(query, {
    owner: repo.owner,
    name: repo.repo,
    ...variables,
  });
  const repository = response.repository;
  if (!repository) {
    throw new Error(`Repository ${repo.owner}/${repo.repo} is not accessible`);
  }
  return paths.map((path, index) =>
    readBlobNode(path, repository[`f${index}`] ?? null)
  );
}

export async function fetchBlobsByRef(
  ref: string,
  paths: string[],
  repoRef?: RepoRef
): Promise<BlobFetchResult[]> {
  const repo = resolveRepo(repoRef);
  const batches: string[][] = [];
  for (let start = 0; start < paths.length; start += BLOB_BATCH_SIZE) {
    batches.push(paths.slice(start, start + BLOB_BATCH_SIZE));
  }
  const results = await Promise.all(
    batches.map((batch) => fetchBlobBatch(repo, ref, batch))
  );
  return results.flat();
}

// ─── Bank indexing ───

const BANK_PATH_RE = /^src\/([^/]+)\/?$/;
const BANK_NAME_RE = /^(.+?)(?:_(\d+))?$/;
const BANK_FROM_BLOB_RE = /^src\/([^/]+)\/(?:formats\/.+\.txt|senders\.txt)$/;

export function indexBanksFromTree(tree: FileEntry[]): BankInfo[] {
  // Primary source: explicit tree folders src/<name>
  const bankFoldersFromTrees = tree
    .filter((e) => e.type === "tree" && BANK_PATH_RE.test(e.path))
    .map((e) => e.path);

  // Fallback source: infer bank folder from blob paths
  const bankFoldersFromBlobs = tree
    .filter((e) => e.type === "blob")
    .map((e) => BANK_FROM_BLOB_RE.exec(e.path)?.[1])
    .filter((folderName): folderName is string => !!folderName)
    .map((folderName) => `src/${folderName}`);

  const bankFolders = Array.from(
    new Set([...bankFoldersFromTrees, ...bankFoldersFromBlobs])
  );

  return bankFolders
    .map((folderPath) => {
      const folderName = folderPath.replace("src/", "");
      const nameMatch = BANK_NAME_RE.exec(folderName);
      const displayName = nameMatch?.[1] ?? folderName;
      const bankId = nameMatch?.[2] ?? null;

      const formatFiles = tree
        .filter(
          (e) =>
            e.type === "blob" &&
            e.path.startsWith(`${folderPath}/formats/`) &&
            e.path.endsWith(".txt")
        )
        .map((e) => e.path);

      const hasSenders = tree.some(
        (e) => e.type === "blob" && e.path === `${folderPath}/senders.txt`
      );

      return {
        displayName,
        folderPath,
        bankId,
        formatFiles: formatFiles.sort(),
        hasSenders,
      };
    })
    .sort((a, b) => a.displayName.localeCompare(b.displayName));
}

// ─── Publish operations (require auth) ───

export async function ensureFork(
  octokit: Octokit,
  repoRef?: RepoRef
): Promise<{ owner: string; repo: string }> {
  const target = resolveRepo(repoRef);
  try {
    const user = await octokit.users.getAuthenticated();
    const forkOwner = user.data.login;

    try {
      await octokit.repos.get({ owner: forkOwner, repo: target.repo });
      return { owner: forkOwner, repo: target.repo };
    } catch {
      // Fork doesn't exist — create it
      await octokit.repos.createFork({
        owner: target.owner,
        repo: target.repo,
      });
      // Wait a bit for fork to be ready
      await new Promise((resolve) => setTimeout(resolve, 3000));
      return { owner: forkOwner, repo: target.repo };
    }
  } catch (e) {
    throw new Error(
      `Failed to ensure fork: ${e instanceof Error ? e.message : String(e)}`
    );
  }
}

export async function createOrUpdateBranch(
  octokit: Octokit,
  forkOwner: string,
  branchName: string,
  baseSha: string,
  repoRef?: RepoRef
): Promise<void> {
  const target = resolveRepo(repoRef);
  const ref = `refs/heads/${branchName}`;
  try {
    await octokit.git.getRef({
      owner: forkOwner,
      repo: target.repo,
      ref: `heads/${branchName}`,
    });
    // Branch exists, update it
    await octokit.git.updateRef({
      owner: forkOwner,
      repo: target.repo,
      ref: `heads/${branchName}`,
      sha: baseSha,
      force: true,
    });
  } catch {
    // Branch doesn't exist, create it
    await octokit.git.createRef({
      owner: forkOwner,
      repo: target.repo,
      ref,
      sha: baseSha,
    });
  }
}

export async function createCommit(
  octokit: Octokit,
  forkOwner: string,
  branchName: string,
  parentSha: string,
  files: Array<{ path: string; content?: string; delete?: boolean }>,
  message: string,
  repoRef?: RepoRef
): Promise<string> {
  const target = resolveRepo(repoRef);

  const blobs = await Promise.all(
    files.map(async (f) => {
      if (f.delete) {
        return {
          path: f.path,
          sha: null,
          mode: "100644" as const,
          type: "blob" as const,
        };
      }
      if (typeof f.content !== "string") {
        throw new Error(`Missing content for file: ${f.path}`);
      }
      const blob = await octokit.git.createBlob({
        owner: forkOwner,
        repo: target.repo,
        content: encodeBase64Utf8(f.content),
        encoding: "base64",
      });
      return {
        path: f.path,
        sha: blob.data.sha,
        mode: "100644" as const,
        type: "blob" as const,
      };
    })
  );

  // Get base tree
  const parentCommit = await octokit.git.getCommit({
    owner: forkOwner,
    repo: target.repo,
    commit_sha: parentSha,
  });
  const baseTreeSha = parentCommit.data.tree.sha;

  // Create new tree
  const newTree = await octokit.git.createTree({
    owner: forkOwner,
    repo: target.repo,
    base_tree: baseTreeSha,
    tree: blobs,
  });

  // Create commit
  const commit = await octokit.git.createCommit({
    owner: forkOwner,
    repo: target.repo,
    message,
    tree: newTree.data.sha,
    parents: [parentSha],
  });

  // Update branch ref
  await octokit.git.updateRef({
    owner: forkOwner,
    repo: target.repo,
    ref: `heads/${branchName}`,
    sha: commit.data.sha,
  });

  return commit.data.sha;
}

interface CreateCommitOnBranchResponse {
  createCommitOnBranch: {
    commit: {
      oid: string;
    };
  } | null;
}

const CREATE_COMMIT_ON_BRANCH_MUTATION = `
  mutation CreateCommitOnBranch($input: CreateCommitOnBranchInput!) {
    createCommitOnBranch(input: $input) {
      commit {
        oid
      }
    }
  }
`;

function buildCommitMessageInput(message: string): {
  headline: string;
  body?: string;
} {
  const [headline = "", ...bodyLines] = message.trim().split("\n");
  const body = bodyLines.join("\n").trim();
  return body ? { headline, body } : { headline };
}

function buildCommitFileChanges(
  files: Array<{ path: string; content?: string; delete?: boolean }>
): {
  additions?: Array<{ path: string; contents: string }>;
  deletions?: Array<{ path: string }>;
} {
  const additions: Array<{ path: string; contents: string }> = [];
  const deletions: Array<{ path: string }> = [];

  for (const file of files) {
    if (file.delete) {
      deletions.push({ path: file.path });
      continue;
    }
    if (typeof file.content !== "string") {
      throw new Error(`Missing content for file: ${file.path}`);
    }
    additions.push({
      path: file.path,
      contents: encodeBase64Utf8(file.content),
    });
  }

  return {
    ...(additions.length > 0 ? { additions } : {}),
    ...(deletions.length > 0 ? { deletions } : {}),
  };
}

export async function updatePullRequestHead(
  token: string,
  prNumber: number,
  files: Array<{ path: string; content?: string; delete?: boolean }>,
  repoRef?: RepoRef,
  commitMessage?: string
): Promise<{ url: string; title: string; headSha: string }> {
  const repo = resolveRepo(repoRef);
  const octokit = createAuthenticatedOctokit(token);
  const pr = await octokit.pulls.get({
    owner: repo.owner,
    repo: repo.repo,
    pull_number: prNumber,
  });

  const headOwner = pr.data.head.repo?.owner?.login ?? repo.owner;
  const headRepo = pr.data.head.repo?.name ?? repo.repo;
  const headRef = pr.data.head.ref;
  const headSha = pr.data.head.sha;
  const title = pr.data.title;
  const message = commitMessage?.trim() ? commitMessage : title;
  // Git Data and Contents REST endpoints see maintainers as read-only on a
  // contributor's fork. This branch-aware mutation honors the PR author's
  // "Allow edits from maintainers" grant and keeps all file changes atomic.
  const result = await octokit.graphql<CreateCommitOnBranchResponse>(
    CREATE_COMMIT_ON_BRANCH_MUTATION,
    {
      input: {
        branch: {
          repositoryNameWithOwner: `${headOwner}/${headRepo}`,
          branchName: headRef,
        },
        expectedHeadOid: headSha,
        message: buildCommitMessageInput(message),
        fileChanges: buildCommitFileChanges(files),
      },
    }
  );
  const newHeadSha = result.createCommitOnBranch?.commit.oid;
  if (!newHeadSha) {
    throw new Error("GitHub did not return the updated pull request head.");
  }

  return {
    url: pr.data.html_url,
    title,
    headSha: newHeadSha,
  };
}

export async function createPullRequest(
  octokit: Octokit,
  forkOwner: string,
  branchName: string,
  title: string,
  body: string,
  repoRef?: RepoRef
): Promise<{ url: string; number: number }> {
  const target = resolveRepo(repoRef);
  const pr = await octokit.pulls.create({
    owner: target.owner,
    repo: target.repo,
    title,
    body,
    head: `${forkOwner}:${branchName}`,
    base: config.defaultBranch,
  });
  return { url: pr.data.html_url, number: pr.data.number };
}

export async function validateToken(token: string): Promise<string> {
  const octokit = createAuthenticatedOctokit(token);
  const user = await octokit.users.getAuthenticated();
  return user.data.login;
}
