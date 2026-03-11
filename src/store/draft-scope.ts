import type { RepoRef, SourceRef } from "@/domain/types";

type SourceDraftScopeRef =
  | Pick<SourceRef, "type" | "name" | "prNumber">
  | { type: "pr"; name?: string; prNumber: number };

function makeSourceDraftScopeKey(sourceRef: SourceDraftScopeRef): string {
  if (sourceRef.type !== "pr" || typeof sourceRef.prNumber !== "number") {
    throw new Error("Unsupported legacy draft scope");
  }
  return `pr:${sourceRef.prNumber}`;
}

export function makeDraftSourceKey(
  sourceRef: SourceDraftScopeRef,
  repository: RepoRef
): string {
  return `${repository.owner}/${repository.repo}:${makeSourceDraftScopeKey(sourceRef)}`;
}

export function isSameDraftScope(
  currentSource: SourceRef | null,
  nextSource: SourceDraftScopeRef
): boolean {
  if (!currentSource) {
    return false;
  }
  if (currentSource.type !== "pr") {
    return false;
  }
  if (nextSource.type !== "pr" || typeof nextSource.prNumber !== "number") {
    return false;
  }

  return (
    makeSourceDraftScopeKey(currentSource) ===
    makeSourceDraftScopeKey(nextSource)
  );
}
