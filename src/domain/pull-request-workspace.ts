import type { RepoRef } from "./types";

export interface PullRequestChangedFile {
  kind: "add" | "modify" | "delete" | "rename";
  path: string;
  oldPath?: string;
}

export type PullRequestWorkspaceResolution =
  | {
      status: "supported";
      repository: RepoRef;
      prNumber: number;
      headSha: string;
      baseSha: string;
      bankPath: string;
      writable: boolean;
      readOnlyReason: "no-write-access" | null;
      changedFiles: PullRequestChangedFile[];
    }
  | {
      status: "unsupported";
      reason: "no-bank-changes" | "multiple-banks" | "outside-bank-scope";
    }
  | {
      status: "unavailable";
      reason: "not-found" | "closed" | "merged" | "inaccessible";
    }
  | {
      status: "transient-error";
      reason: "network" | "timeout" | "rate-limit" | "unknown";
    };

interface PullRequestWorkspaceSnapshot {
  repository: RepoRef;
  prNumber: number;
  state: "open" | "closed";
  merged: boolean;
  headSha: string;
  baseSha: string;
  canWriteRepository: boolean;
  maintainerCanModify: boolean | null;
  headRepository: RepoRef | null;
  changedFiles: PullRequestChangedFile[];
}

function isSameRepository(left: RepoRef, right: RepoRef): boolean {
  return left.owner === right.owner && left.repo === right.repo;
}

function resolveBankPathFromFilePath(path: string | undefined): string | null {
  if (!path?.startsWith("src/")) {
    return null;
  }
  const [root, bank] = path.split("/");
  if (!(root === "src" && bank)) {
    return null;
  }
  return `src/${bank}`;
}

function resolvePullRequestBankPath(changedFiles: PullRequestChangedFile[]):
  | { status: "supported"; bankPath: string }
  | {
      status: "unsupported";
      reason: "no-bank-changes" | "multiple-banks" | "outside-bank-scope";
    } {
  if (changedFiles.length === 0) {
    return {
      status: "unsupported",
      reason: "no-bank-changes",
    };
  }

  const bankPaths = new Set<string>();
  for (const file of changedFiles) {
    const bankPath = resolveBankPathFromFilePath(file.path);
    if (!bankPath) {
      return {
        status: "unsupported",
        reason: "outside-bank-scope",
      };
    }
    if (file.kind === "rename") {
      const oldBankPath = resolveBankPathFromFilePath(file.oldPath);
      if (!(oldBankPath && oldBankPath === bankPath)) {
        return {
          status: "unsupported",
          reason: "outside-bank-scope",
        };
      }
    }
    bankPaths.add(bankPath);
  }

  if (bankPaths.size !== 1) {
    return {
      status: "unsupported",
      reason: "multiple-banks",
    };
  }

  return {
    status: "supported",
    bankPath: Array.from(bankPaths)[0] ?? "",
  };
}

function resolvePullRequestWritable(
  snapshot: PullRequestWorkspaceSnapshot
): boolean {
  if (!snapshot.canWriteRepository) {
    return false;
  }
  if (
    snapshot.headRepository &&
    isSameRepository(snapshot.headRepository, snapshot.repository)
  ) {
    return true;
  }
  return snapshot.maintainerCanModify === true;
}

export function resolvePullRequestWorkspaceSnapshot(
  snapshot: PullRequestWorkspaceSnapshot
): PullRequestWorkspaceResolution {
  if (snapshot.merged) {
    return {
      status: "unavailable",
      reason: "merged",
    };
  }
  if (snapshot.state !== "open") {
    return {
      status: "unavailable",
      reason: "closed",
    };
  }

  const bankResolution = resolvePullRequestBankPath(snapshot.changedFiles);
  if (bankResolution.status !== "supported") {
    return bankResolution;
  }

  const writable = resolvePullRequestWritable(snapshot);
  return {
    status: "supported",
    repository: snapshot.repository,
    prNumber: snapshot.prNumber,
    headSha: snapshot.headSha,
    baseSha: snapshot.baseSha,
    bankPath: bankResolution.bankPath,
    writable,
    readOnlyReason: writable ? null : "no-write-access",
    changedFiles: snapshot.changedFiles,
  };
}
