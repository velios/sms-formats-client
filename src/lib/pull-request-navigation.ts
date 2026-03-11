import { config } from "@/config";
import { buildPullRequestWorkspacePath } from "@/domain/bank-route";
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
  prNumber: number;
  repository: RepoRef;
  filePath?: string | null;
}): string {
  return buildPullRequestWorkspacePath(params);
}

export function getPullRequestShortcutConflict(params: {
  currentRepository: RepoRef;
  currentSource: SourceRef | null;
  hasDrafts: boolean;
  prNumber: number;
  targetRepository: RepoRef;
}): PullRequestShortcutNoticeReason | null {
  return null;
}
