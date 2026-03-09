import { config } from "@/config";
import { buildBankWorkspacePath } from "@/domain/bank-route";
import type { RepoRef, SourceRef } from "@/domain/types";

export type PullRequestShortcutNoticeReason =
  | "same-pr-drafts"
  | "other-drafts"
  | "open-failed";

export interface PullRequestShortcutNotice {
  prNumber: number;
  githubUrl: string;
  reason: PullRequestShortcutNoticeReason;
}

function collectChangedBankPaths(paths: string[]): string[] {
  const banks = new Set<string>();
  for (const path of paths) {
    if (!path.startsWith("src/")) {
      continue;
    }
    const bankFolder = path.split("/")[1];
    if (bankFolder) {
      banks.add(`src/${bankFolder}`);
    }
  }
  return Array.from(banks).sort((a, b) =>
    a.localeCompare(b, undefined, { sensitivity: "base" })
  );
}

function getSingleChangedBankPath(paths: string[]): string | null {
  const bankPaths = collectChangedBankPaths(paths);
  if (bankPaths.length !== 1) {
    return null;
  }
  return bankPaths[0] ?? null;
}

function getPreferredChangedFilePath(
  paths: string[],
  bankPath: string
): string | null {
  const bankPaths = paths.filter((path) => path.startsWith(`${bankPath}/`));
  return (
    bankPaths.find(
      (path) => path.startsWith(`${bankPath}/formats/`) && path.endsWith(".txt")
    ) ??
    bankPaths[0] ??
    null
  );
}

export function getUpstreamRepository(): RepoRef {
  return {
    owner: config.sourceOwner,
    repo: config.sourceRepo,
  };
}

export function isSameRepository(left: RepoRef, right: RepoRef): boolean {
  return left.owner === right.owner && left.repo === right.repo;
}

export function getPullRequestGitHubUrl(
  prNumber: number,
  repository: RepoRef
): string {
  return `https://github.com/${repository.owner}/${repository.repo}/pull/${prNumber}`;
}

export function getPullRequestWorkspacePath(params: {
  changedPaths: string[];
  prNumber: number;
  repository: RepoRef;
  sourceSha: string;
}): string {
  const { changedPaths, prNumber, repository, sourceSha } = params;
  const bankPath = getSingleChangedBankPath(changedPaths);
  if (!bankPath) {
    return "/workspace";
  }

  return buildBankWorkspacePath({
    bankPath,
    filePath: getPreferredChangedFilePath(changedPaths, bankPath),
    repository,
    source: { type: "pr", prNumber, sha: sourceSha },
  });
}

export function getPullRequestShortcutConflict(params: {
  currentRepository: RepoRef;
  currentSource: SourceRef | null;
  hasDrafts: boolean;
  prNumber: number;
  targetRepository: RepoRef;
}): PullRequestShortcutNoticeReason | null {
  const {
    currentRepository,
    currentSource,
    hasDrafts,
    prNumber,
    targetRepository,
  } = params;
  if (!hasDrafts) {
    return null;
  }
  if (
    isSameRepository(currentRepository, targetRepository) &&
    currentSource?.type === "pr" &&
    currentSource.prNumber === prNumber
  ) {
    return "same-pr-drafts";
  }
  return "other-drafts";
}
