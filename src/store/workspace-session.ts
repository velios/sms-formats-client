import type { RepoRef } from "@/domain/types";

const WORKSPACE_SESSION_STORAGE_KEY = "sms-formats-workspace-session";

export interface WorkspaceSession {
  repository: RepoRef;
  prNumber: number;
  headSha: string;
  bankPath: string;
  writable: boolean;
  readOnlyReason: "no-write-access" | null;
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

function isReadOnlyReason(
  value: unknown
): value is WorkspaceSession["readOnlyReason"] {
  return value === null || value === "no-write-access";
}

function isWorkspaceSession(value: unknown): value is WorkspaceSession {
  if (!(value && typeof value === "object")) {
    return false;
  }

  const candidate = value as Partial<WorkspaceSession>;
  if (
    !(
      isRepoRef(candidate.repository) && Number.isInteger(candidate.prNumber)
    ) ||
    typeof candidate.headSha !== "string" ||
    typeof candidate.bankPath !== "string" ||
    typeof candidate.writable !== "boolean" ||
    !isReadOnlyReason(candidate.readOnlyReason)
  ) {
    return false;
  }
  const prNumber = candidate.prNumber;
  return typeof prNumber === "number" && prNumber > 0;
}

export function loadWorkspaceSession(): WorkspaceSession | null {
  try {
    const raw = localStorage.getItem(WORKSPACE_SESSION_STORAGE_KEY);
    if (!raw) {
      return null;
    }

    const parsed = JSON.parse(raw);
    if (!isWorkspaceSession(parsed)) {
      return null;
    }

    return parsed;
  } catch {
    return null;
  }
}

export function saveWorkspaceSession(session: WorkspaceSession): void {
  try {
    localStorage.setItem(
      WORKSPACE_SESSION_STORAGE_KEY,
      JSON.stringify(session)
    );
  } catch {
    // Ignore storage failures in restricted browser profiles.
  }
}

export function clearWorkspaceSession(): void {
  try {
    if (typeof localStorage.removeItem === "function") {
      localStorage.removeItem(WORKSPACE_SESSION_STORAGE_KEY);
      return;
    }
    localStorage.setItem(WORKSPACE_SESSION_STORAGE_KEY, "");
  } catch {
    // Ignore storage failures in restricted browser profiles.
  }
}
