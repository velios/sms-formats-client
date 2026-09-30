import { Octokit } from "@octokit/rest";
import { config } from "@/config";
import {
  type PullRequestChangedFile,
  type PullRequestWorkspaceResolution,
  resolvePullRequestWorkspaceSnapshot,
} from "@/domain/pull-request-workspace";
import type {
  CheckedSourceHead,
  FileEntry,
  PullRequestLabel,
  RepoRef,
  SourceTarget,
} from "@/domain/types";
import { queryClient } from "@/lib/query-client";
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
  checkedAt: number;
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

interface ValidatorFailureResult {
  failedValidationCount: number | null;
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

function resolveRepo(repoRef?: RepoRef): RepoRef {
  return repoRef ?? defaultRepoRef;
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

async function fetchValidatorFailuresByHeadSha(
  headSha: string,
  repo: RepoRef
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

    const perRunErrors = failedRuns.map((run) =>
      extractValidatorErrorMessages(run.output)
    );

    return {
      failedValidationCount: failedRuns.length,
      validationErrors: formatValidatorErrorLines(failedRuns, perRunErrors),
      validationUrl:
        failedRuns.find((run) => run.html_url)?.html_url?.trim() || null,
    };
  } catch {
    return {
      failedValidationCount: null,
      validationErrors: [],
      validationUrl: null,
    };
  }
}

const sharedToken = config.issueToken.trim();

function createPublicOctokit(token: string): Octokit {
  return token ? new Octokit({ auth: token }) : new Octokit();
}

function cacheBustParam(forceFresh?: boolean): { _cb?: number } {
  return forceFresh ? { _cb: Date.now() } : {};
}

function readStoredGitHubUserToken(): string {
  if (typeof localStorage === "undefined") {
    return "";
  }
  try {
    return localStorage.getItem(GITHUB_USER_TOKEN_STORAGE_KEY)?.trim() ?? "";
  } catch {
    return "";
  }
}

function persistGitHubUserToken(token: string): void {
  if (typeof localStorage === "undefined") {
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
    // Browser storage may be unavailable.
  }
}

function getRepoSlug(repoRef?: RepoRef): string {
  const repo = resolveRepo(repoRef);
  return `${repo.owner}/${repo.repo}`;
}

function readPullRequestApprovalPermissionCache(): PullRequestApprovalPermissionCache {
  if (typeof localStorage === "undefined") {
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
  if (typeof localStorage === "undefined") {
    return;
  }
  try {
    localStorage.setItem(
      PR_APPROVAL_PERMISSION_STORAGE_KEY,
      JSON.stringify(value)
    );
  } catch {
    // Browser storage may be unavailable.
  }
}

function clearPullRequestApprovalPermissionCache(): void {
  if (typeof localStorage === "undefined") {
    return;
  }
  try {
    if (typeof localStorage.removeItem === "function") {
      localStorage.removeItem(PR_APPROVAL_PERMISSION_STORAGE_KEY);
      return;
    }
    localStorage.setItem(PR_APPROVAL_PERMISSION_STORAGE_KEY, "{}");
  } catch {
    // Browser storage may be unavailable.
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
    checkedAt: Date.now(),
  };
  writePullRequestApprovalPermissionCache(cache);
}

export function getCachedPullRequestApprovalPermission(
  repoRef?: RepoRef
): boolean {
  const slug = getRepoSlug(repoRef);
  const cache = readPullRequestApprovalPermissionCache();
  return (
    cache[slug]?.canApprove === true &&
    Date.now() - cache[slug].checkedAt < 60_000
  );
}

export async function refreshPullRequestApprovalPermission(
  repoRef?: RepoRef,
  options?: { forceFresh?: boolean }
): Promise<boolean> {
  const slug = getRepoSlug(repoRef);
  const cache = readPullRequestApprovalPermissionCache();
  const cached = cache[slug];
  if (
    !options?.forceFresh &&
    cached &&
    Date.now() - cached.checkedAt < 60_000
  ) {
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
    throw new Error("Unable to verify GitHub repository permissions");
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

export interface OpenPullRequest {
  number: number;
  title: string;
  headRef: string;
  headSha: string;
  headOwner: string;
  headRepo: string;
  approvedCount: number | null;
  failedValidationCount: number | null;
  validationErrors: string[];
  validationUrl: string | null;
  lastCommitAuthorLogin: string | null;
  labels: PullRequestLabel[];
}

export async function fetchOpenPRs(
  repoRef?: RepoRef,
  options?: { forceFresh?: boolean }
): Promise<OpenPullRequest[]> {
  const repo = resolveRepo(repoRef);
  const res = await publicOctokit.pulls.list({
    owner: repo.owner,
    repo: repo.repo,
    state: "open",
    per_page: 100,
    ...cacheBustParam(options?.forceFresh),
  });
  return res.data.map((pr) => {
    const headRepo = {
      owner: pr.head.repo?.owner?.login ?? repo.owner,
      repo: pr.head.repo?.name ?? repo.repo,
    };
    return {
      number: pr.number,
      title: pr.title,
      headRef: pr.head.ref,
      headSha: pr.head.sha,
      headOwner: headRepo.owner,
      headRepo: headRepo.repo,
      approvedCount: null,
      failedValidationCount: null,
      validationErrors: [],
      validationUrl: null,
      lastCommitAuthorLogin: null,
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
  });
}

export async function fetchPullRequestMetadata(
  pr: OpenPullRequest,
  repo: RepoRef
): Promise<OpenPullRequest> {
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
      return null;
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

  const cached = <T>(
    kind: string,
    identity: number | string,
    loader: () => Promise<T>,
    staleTime = 30_000
  ) =>
    queryClient.fetchQuery({
      queryKey: [
        "pr-metadata",
        repo.owner,
        repo.repo,
        getGitHubAuthChangeVersion(),
        kind,
        identity,
      ],
      queryFn: loader,
      staleTime,
      retry: false,
    });
  const [approvedCount, validation, lastCommitAuthorLogin] = await Promise.all([
    cached("reviews", pr.number, () => fetchApprovedCount(pr.number, repo)),
    cached("checks", pr.headSha, () =>
      fetchValidatorFailuresByHeadSha(pr.headSha, repo)
    ),
    cached(
      "author",
      pr.headSha,
      () =>
        fetchLastCommitAuthorLogin(pr.headSha, {
          owner: pr.headOwner,
          repo: pr.headRepo,
        }),
      Number.POSITIVE_INFINITY
    ),
  ]);
  return { ...pr, approvedCount, ...validation, lastCommitAuthorLogin };
}

export async function resolvePullRequestWorkspace(
  prNumber: number,
  repoRef?: RepoRef,
  options?: { forceFresh?: boolean }
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
      refreshPullRequestApprovalPermission(repo, options),
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

    const headSha = pullRequest.data.head.sha;
    const comparison = await publicOctokit.repos.compareCommitsWithBasehead({
      owner: repo.owner,
      repo: repo.repo,
      basehead: `${pullRequest.data.base.sha}...${headSha}`,
      per_page: 1,
    });

    return resolvePullRequestWorkspaceSnapshot({
      repository: repo,
      prNumber,
      state: pullRequest.data.state === "open" ? "open" : "closed",
      merged: pullRequest.data.merged === true,
      headSha,
      // PR files describe the diff from the merge base, not current main.
      baseSha: comparison.data.merge_base_commit.sha,
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

export class GitHubRateLimitError extends Error {
  readonly retryAt: number;

  constructor(retryAt: number) {
    super("GitHub request limit reached");
    this.retryAt = retryAt;
    this.name = "GitHubRateLimitError";
  }
}

const blockedRequests = new Map<number, number>();

function isRateLimitResponse(
  candidate: { status?: number; message?: string },
  headers: Record<string, string>
): boolean {
  return (
    candidate.status === 429 ||
    (candidate.status === 403 &&
      (headers["x-ratelimit-remaining"] === "0" ||
        !!candidate.message?.toLowerCase().includes("rate limit")))
  );
}

async function sourceRequest<T>(request: () => Promise<T>): Promise<T> {
  const authVersion = getGitHubAuthChangeVersion();
  const retryAt = blockedRequests.get(authVersion) ?? 0;
  if (Date.now() < retryAt) {
    throw new GitHubRateLimitError(retryAt);
  }
  try {
    const response = await request();
    const headers = (response as { headers?: Record<string, string> }).headers;
    if (headers?.["x-ratelimit-remaining"] === "0") {
      blockedRequests.set(
        authVersion,
        Number(headers["x-ratelimit-reset"]) * 1000 || Date.now() + 60_000
      );
    }
    return response;
  } catch (error) {
    const candidate = error as {
      status?: number;
      message?: string;
      response?: { headers?: Record<string, string> };
    };
    const headers = candidate.response?.headers ?? {};
    if (isRateLimitResponse(candidate, headers)) {
      const retryAfter = headers["retry-after"];
      const retrySeconds = Number(retryAfter);
      const retryTime =
        retryAfter && Number.isFinite(retrySeconds)
          ? Date.now() + retrySeconds * 1000
          : Date.parse(retryAfter ?? "");
      const resetTime = Number(headers["x-ratelimit-reset"]) * 1000;
      const blockedUntil = Math.max(
        Date.now() + 60_000,
        Number.isFinite(retryTime) ? retryTime : 0,
        Number.isFinite(resetTime) ? resetTime : 0
      );
      blockedRequests.set(authVersion, blockedUntil);
      throw new GitHubRateLimitError(blockedUntil);
    }
    throw error;
  }
}

export async function fetchSourceHead(
  source: SourceTarget,
  repository: RepoRef,
  options?: { forceFresh?: boolean }
): Promise<CheckedSourceHead> {
  if (source.type === "main") {
    const response = await sourceRequest(() =>
      publicOctokit.repos.getBranch({
        owner: repository.owner,
        repo: repository.repo,
        branch: "main",
        ...cacheBustParam(options?.forceFresh),
      })
    );
    return {
      sourceRef: { type: "main", name: "main", sha: response.data.commit.sha },
      checkedAt: Date.now(),
    };
  }
  const response = await sourceRequest(() =>
    publicOctokit.pulls.get({
      owner: repository.owner,
      repo: repository.repo,
      pull_number: source.prNumber,
      ...cacheBustParam(options?.forceFresh),
    })
  );
  return {
    sourceRef: {
      type: "pr",
      name: response.data.head.ref,
      sha: response.data.head.sha,
      prNumber: source.prNumber,
    },
    checkedAt: Date.now(),
    prState: response.data.merged
      ? "merged"
      : response.data.state === "closed"
        ? "closed"
        : "open",
  };
}

export async function fetchFileContent(
  path: string,
  ref: string,
  repoRef?: RepoRef
): Promise<string> {
  const repo = resolveRepo(repoRef);
  const res = await sourceRequest(() =>
    publicOctokit.repos.getContent({
      owner: repo.owner,
      repo: repo.repo,
      path,
      ref,
    })
  );
  const data = res.data as { content?: string; encoding?: string };
  if (typeof data.content === "string" && data.encoding === "base64") {
    return decodeBase64Utf8(data.content.replace(/\n/g, ""));
  }
  throw new Error(`Unexpected content format for ${path}`);
}

export type BlobFetchResult =
  | { path: string; status: "loaded"; text: string }
  | { path: string; status: "missing" }
  | { path: string; status: "binary" }
  | { path: string; status: "truncated" };

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
  expectedHeadSha: string,
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
  if (pr.data.head.sha !== expectedHeadSha) {
    throw new Error(
      "Pull request head changed after validation. Refresh the workspace."
    );
  }
  const title = pr.data.title;
  const message = commitMessage?.trim() ? commitMessage : title;
  const result = await octokit.graphql<CreateCommitOnBranchResponse>(
    CREATE_COMMIT_ON_BRANCH_MUTATION,
    {
      input: {
        branch: {
          repositoryNameWithOwner: `${headOwner}/${headRepo}`,
          branchName: headRef,
        },
        expectedHeadOid: expectedHeadSha,
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

export async function validateToken(token: string): Promise<string> {
  const octokit = createAuthenticatedOctokit(token);
  const user = await octokit.users.getAuthenticated();
  return user.data.login;
}
