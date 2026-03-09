import type { RepoRef, SourceRef } from "@/domain/types";

export type BankRouteSource =
  | { type: "branch"; name: string }
  | { type: "pr"; prNumber: number; sha?: string };

interface BankWorkspacePathParams {
  bankPath: string;
  repository: RepoRef;
  source: BankRouteSource;
  filePath?: string | null;
}

interface ParseBankRouteParamsInput {
  bankKey?: string;
  repoSlug?: string;
  branchOrPr?: string;
  commit?: string | null;
}

export interface ParsedBankRouteParams {
  bankPath: string;
  repoSlug: string | null;
  source: BankRouteSource | null;
  isStructuredRoute: boolean;
}

function decodePathSegment(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function normalizePathValue(value: string): string {
  return value.trim().replace(/^\/+|\/+$/g, "");
}

export function bankPathToRouteKey(bankPath: string): string {
  const normalized = normalizePathValue(bankPath);
  if (!normalized) {
    return "";
  }
  if (normalized.startsWith("src/")) {
    return normalized.slice(4);
  }
  const parts = normalized.split("/").filter(Boolean);
  return parts.at(-1) ?? normalized;
}

export function routeKeyToBankPath(bankKey: string): string {
  const decoded = normalizePathValue(decodePathSegment(bankKey));
  if (!decoded) {
    return "";
  }
  if (decoded.startsWith("src/")) {
    return decoded;
  }
  return `src/${decoded}`;
}

export function parseBranchOrPrSegment(
  branchOrPr: string | undefined
): BankRouteSource | null {
  if (!branchOrPr) {
    return null;
  }
  const decoded = decodePathSegment(branchOrPr).trim();
  if (!decoded) {
    return null;
  }
  if (/^\d+$/.test(decoded)) {
    const prNumber = Number.parseInt(decoded, 10);
    if (Number.isSafeInteger(prNumber) && prNumber > 0) {
      return { type: "pr", prNumber };
    }
  }
  return { type: "branch", name: decoded };
}

export function parseBankRouteParams(
  input: ParseBankRouteParamsInput
): ParsedBankRouteParams {
  const repoSlug = input.repoSlug?.trim()
    ? decodePathSegment(input.repoSlug).trim()
    : null;
  const source = parseBranchOrPrSegment(input.branchOrPr);
  const commit = input.commit?.trim()
    ? decodePathSegment(input.commit).trim()
    : undefined;
  return {
    bankPath: input.bankKey ? routeKeyToBankPath(input.bankKey) : "",
    repoSlug,
    source:
      source?.type === "pr" && commit ? { ...source, sha: commit } : source,
    isStructuredRoute: Boolean(input.bankKey),
  };
}

export function sourceRefToRouteSource(
  sourceRef: SourceRef | null | undefined,
  defaultBranch: string
): BankRouteSource {
  if (sourceRef?.type === "pr" && sourceRef.prNumber) {
    return { type: "pr", prNumber: sourceRef.prNumber, sha: sourceRef.sha };
  }
  if (sourceRef?.type === "branch" && sourceRef.name) {
    return { type: "branch", name: sourceRef.name };
  }
  return { type: "branch", name: defaultBranch };
}

export function resolveRouteRepository(
  routeRepoSlug: string | null
): RepoRef | null {
  if (!routeRepoSlug) {
    return null;
  }
  const decoded = routeRepoSlug.trim();
  if (!decoded) {
    return null;
  }

  const [owner, repo] = decoded.split("/");
  if (owner && repo) {
    return { owner, repo };
  }
  return null;
}

export function isRouteSourceMatched(
  currentSource: SourceRef | null,
  targetSource: BankRouteSource | null
): boolean {
  if (!targetSource) {
    return true;
  }
  if (!currentSource) {
    return false;
  }
  if (targetSource.type === "pr") {
    return (
      currentSource.type === "pr" &&
      currentSource.prNumber === targetSource.prNumber &&
      (!targetSource.sha || currentSource.sha === targetSource.sha)
    );
  }
  return (
    currentSource.type === "branch" && currentSource.name === targetSource.name
  );
}

export function buildBankWorkspacePath({
  bankPath,
  repository,
  source,
  filePath,
}: BankWorkspacePathParams): string {
  const bankKey = bankPathToRouteKey(bankPath);
  const branchOrPr =
    source.type === "pr" ? String(source.prNumber) : source.name;
  const repoSlug = `${repository.owner}/${repository.repo}`;
  const path = `/bank/${encodeURIComponent(bankKey)}/repo/${encodeURIComponent(repoSlug)}/branch-or-pr/${encodeURIComponent(branchOrPr)}`;
  const searchParams = new URLSearchParams();
  if (filePath) {
    searchParams.set("file", filePath);
  }
  if (source.type === "pr" && source.sha) {
    searchParams.set("commit", source.sha);
  }
  const search = searchParams.toString();
  if (!search) {
    return path;
  }
  return `${path}?${search}`;
}
