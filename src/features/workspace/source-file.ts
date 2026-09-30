import { get, update } from "idb-keyval";
import type { CheckedSourceHead, RepoRef, SourceTarget } from "@/domain/types";
import {
  fetchSourceHead,
  getGitHubAuthChangeVersion,
  getGitHubUserToken,
} from "@/infrastructure/github";

export const SOURCE_HEAD_TTL = 30 * 60_000;
const headGenerations = new Map<string, number>();

interface SourceHeadRequest {
  repository: RepoRef;
  source: SourceTarget;
  forceFresh?: boolean;
}

function headStorageKey(repository: RepoRef, source: SourceTarget): string {
  return JSON.stringify([
    "sms-formats-source-head",
    repository.owner,
    repository.repo,
    source.type,
    source.type === "pr" ? source.prNumber : null,
  ]);
}

export async function getCheckedSourceHead(
  repository: RepoRef,
  source: SourceTarget
): Promise<CheckedSourceHead | undefined> {
  return await Promise.resolve()
    .then(() => get<CheckedSourceHead>(headStorageKey(repository, source)))
    .catch(() => undefined);
}

export async function resolveSourceHead(
  request: SourceHeadRequest
): Promise<CheckedSourceHead> {
  const authVersion = getGitHubAuthChangeVersion();
  const key = headStorageKey(request.repository, request.source);
  const generation = (headGenerations.get(key) ?? 0) + 1;
  headGenerations.set(key, generation);
  const stored = await getCheckedSourceHead(request.repository, request.source);
  const useStored =
    !(request.forceFresh || getGitHubUserToken()) &&
    stored &&
    Date.now() - stored.checkedAt < SOURCE_HEAD_TTL;
  const head = useStored
    ? stored
    : await fetchSourceHead(request.source, request.repository, {
        forceFresh: true,
      });
  if (
    !useStored &&
    authVersion === getGitHubAuthChangeVersion() &&
    headGenerations.get(key) === generation
  ) {
    await update<CheckedSourceHead | undefined>(key, (previous) =>
      headGenerations.get(key) !== generation ||
      authVersion !== getGitHubAuthChangeVersion() ||
      (previous && previous.checkedAt > head.checkedAt)
        ? previous
        : head
    );
  }
  return head;
}
