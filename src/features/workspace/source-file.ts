import { get, update } from "idb-keyval";
import type { CheckedSourceHead, RepoRef, SourceTarget } from "@/domain/types";
import { loadFileContent } from "@/infrastructure/file-content";
import {
  fetchSourceHead,
  getGitHubAuthChangeVersion,
  getGitHubUserToken,
} from "@/infrastructure/github";

export const SOURCE_HEAD_TTL = 30 * 60_000;
const headGenerations = new Map<string, number>();

export interface SourceFileRequest {
  repository: RepoRef;
  source: SourceTarget;
  filePath: string;
  forceFresh?: boolean;
}

export interface PreparedSourceFile {
  head: CheckedSourceHead;
  filePath: string;
  content: string | null;
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
  request: Pick<SourceFileRequest, "repository" | "source" | "forceFresh">
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

// Preparing never touches documents, their baseline, or PR workspace sessions.
export async function prepareSourceFile(
  request: SourceFileRequest
): Promise<PreparedSourceFile> {
  const head = await resolveSourceHead(request);
  let content: string | null;
  try {
    content = await loadFileContent({
      repository: request.repository,
      filePath: request.filePath,
      commitSha: head.sourceRef.sha,
    });
  } catch (error) {
    if ((error as { status?: number }).status !== 404) {
      throw error;
    }
    content = null;
  }
  return { head, filePath: request.filePath, content };
}

// A generation distinguishes even repeated openings of exactly the same source.
export class SourceFileLoader {
  private generation = 0;

  invalidate(): void {
    this.generation += 1;
  }

  async prepare(
    request: SourceFileRequest
  ): Promise<PreparedSourceFile | null> {
    const generation = ++this.generation;
    const authVersion = getGitHubAuthChangeVersion();
    try {
      const prepared = await prepareSourceFile(request);
      return generation === this.generation &&
        authVersion === getGitHubAuthChangeVersion()
        ? prepared
        : null;
    } catch (error) {
      if (
        generation !== this.generation ||
        authVersion !== getGitHubAuthChangeVersion()
      ) {
        return null;
      }
      throw error;
    }
  }
}
