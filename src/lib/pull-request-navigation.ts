import type { RepoRef } from "@/domain/types";

export function getPullRequestGitHubUrl(
  prNumber: number,
  repository: RepoRef
): string {
  return `https://github.com/${repository.owner}/${repository.repo}/pull/${prNumber}`;
}
