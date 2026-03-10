import type { RepoRef, SourceRef } from "@/domain/types";

const WORKSPACE_SELECTION_STORAGE_KEY = "sms-formats-workspace-selection";

export interface WorkspaceSelection {
  repository: RepoRef;
  sourceRef: SourceRef;
}

function isRepoRef(value: unknown): value is RepoRef {
  if (!(value && typeof value === "object")) {
    return false;
  }

  const candidate = value as Partial<RepoRef>;
  return (
    typeof candidate.owner === "string" && typeof candidate.repo === "string"
  );
}

function isSourceRef(value: unknown): value is SourceRef {
  if (!(value && typeof value === "object")) {
    return false;
  }

  const candidate = value as Partial<SourceRef>;
  if (
    (candidate.type !== "branch" && candidate.type !== "pr") ||
    typeof candidate.name !== "string" ||
    typeof candidate.sha !== "string"
  ) {
    return false;
  }

  if (candidate.type === "pr") {
    return typeof candidate.prNumber === "number";
  }

  return true;
}

export function loadWorkspaceSelection(): WorkspaceSelection | null {
  try {
    const raw = localStorage.getItem(WORKSPACE_SELECTION_STORAGE_KEY);
    if (!raw) {
      return null;
    }

    const parsed = JSON.parse(raw) as Partial<WorkspaceSelection>;
    if (!(isRepoRef(parsed.repository) && isSourceRef(parsed.sourceRef))) {
      return null;
    }

    return {
      repository: parsed.repository,
      sourceRef: parsed.sourceRef,
    };
  } catch {
    return null;
  }
}

export function saveWorkspaceSelection(selection: WorkspaceSelection): void {
  try {
    localStorage.setItem(
      WORKSPACE_SELECTION_STORAGE_KEY,
      JSON.stringify(selection)
    );
  } catch {
    // Ignore storage failures in restricted browser profiles.
  }
}

export function clearWorkspaceSelection(): void {
  try {
    if (typeof localStorage.removeItem === "function") {
      localStorage.removeItem(WORKSPACE_SELECTION_STORAGE_KEY);
      return;
    }
    localStorage.setItem(WORKSPACE_SELECTION_STORAGE_KEY, "");
  } catch {
    // Ignore storage failures in restricted browser profiles.
  }
}
