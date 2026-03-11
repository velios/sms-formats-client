import type { RepoRef } from "@/domain/types";

export interface PullRequestWorkspacePathParams {
  repository: RepoRef;
  prNumber: number;
  filePath?: string | null;
}

export interface PullRequestRouteParams {
  owner?: string;
  repo?: string;
  prNumber?: string;
}

function decodePathSegment(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function parsePositiveInteger(value: string | undefined): number | null {
  if (!value) {
    return null;
  }

  const normalized = decodePathSegment(value).trim();
  if (!/^\d+$/.test(normalized)) {
    return null;
  }

  const parsed = Number.parseInt(normalized, 10);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

export function buildPullRequestWorkspacePath({
  repository,
  prNumber,
  filePath,
}: PullRequestWorkspacePathParams): string {
  const path = `/repo/${encodeURIComponent(repository.owner)}/${encodeURIComponent(repository.repo)}/pr/${encodeURIComponent(String(prNumber))}`;
  if (!filePath) {
    return path;
  }

  const searchParams = new URLSearchParams();
  searchParams.set("file", filePath);
  return `${path}?${searchParams.toString()}`;
}

export function parsePullRequestRouteParams(params: PullRequestRouteParams): {
  repository: RepoRef;
  prNumber: number;
} | null {
  const owner = params.owner ? decodePathSegment(params.owner).trim() : "";
  const repo = params.repo ? decodePathSegment(params.repo).trim() : "";
  const prNumber = parsePositiveInteger(params.prNumber);
  if (!(owner && repo && prNumber)) {
    return null;
  }

  return {
    repository: { owner, repo },
    prNumber,
  };
}

export function getLegacyRouteRedirectPath(
  pathname: string,
  search = ""
): string | null {
  const searchParams = new URLSearchParams(search);
  if (searchParams.has("commit")) {
    return "/";
  }
  if (pathname === "/workspace") {
    return "/";
  }
  if (/^\/pr\/[^/]+\/?$/.test(pathname)) {
    return "/";
  }
  if (/^\/bank\/.+\/repo\/.+\/branch-or-pr\/.+/.test(pathname)) {
    return "/";
  }
  return null;
}
