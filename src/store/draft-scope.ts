import type { RepoRef, SourceRef } from "@/domain/types";

type SourceDraftScopeRef =
  | Pick<SourceRef, "type" | "name" | "prNumber">
  | { type: "branch" | "pr"; name: string; prNumber?: number };

function makeSourceDraftScopeKey(sourceRef: SourceDraftScopeRef): string {
  if (sourceRef.type === "pr") {
    if (typeof sourceRef.prNumber === "number") {
      return `pr:${sourceRef.prNumber}`;
    }
    return `pr-name:${sourceRef.name}`;
  }

  return `branch:${sourceRef.name}`;
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

  return (
    makeSourceDraftScopeKey(currentSource) ===
    makeSourceDraftScopeKey(nextSource)
  );
}
