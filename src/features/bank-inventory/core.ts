import { isBankFormatFilePath } from "@/domain/format";
import type { PullRequestChangedFile } from "@/domain/pull-request-workspace";

export interface SourceChangeRecord {
  path: string;
  kind?: PullRequestChangedFile["kind"];
  oldPath?: string;
}

export interface LocalDraftChange {
  filePath: string;
  content: string;
  headContent: string | null;
  isDeleted: boolean;
}

export type BankFileClass = "format" | "senders" | "unsupported";
export type LocalFileStatus = "created" | "changed" | "deleted" | "unchanged";
export type SourceFileStatus =
  | "added"
  | "changed"
  | "deleted"
  | "unsupported"
  | "unchanged";

export interface BankFileRecord {
  path: string;
  fileClass: BankFileClass;
  local: LocalFileStatus;
  source: SourceFileStatus;
  isVisibleDeleted: boolean;
}

export interface BankInventoryInput {
  bankPath: string;
  sendersPath: string;
  remoteFormatFiles: string[];
  draftPaths: string[];
  localChanges: LocalDraftChange[];
  sourceChanges: SourceChangeRecord[];
}

export interface BankInventory {
  recordsByPath: Map<string, BankFileRecord>;
  formatFiles: string[];
  unsupportedFiles: string[];
  visibleDeletedFormatFiles: Set<string>;
  liveFormatPaths: string[];
  changedFormatFiles: Set<string>;
  changedFormatPaths: string[];
  mainLayerPaths: string[];
  prLayerPaths: string[];
  hasLocalChangesInBank: boolean;
}

function isInBank(path: string, bankPath: string): boolean {
  return path.startsWith(`${bankPath}/`);
}

function extractFileName(path: string): string {
  return path.split("/").pop() ?? path;
}

function sortFormatPaths(
  formatPaths: string[],
  changedFormatFiles: Set<string>
): string[] {
  return [...formatPaths].sort((a, b) => {
    const aChanged = changedFormatFiles.has(a);
    const bChanged = changedFormatFiles.has(b);
    if (aChanged !== bChanged) {
      return aChanged ? -1 : 1;
    }
    return extractFileName(a).localeCompare(extractFileName(b), undefined, {
      sensitivity: "base",
    });
  });
}

function sortFilePathsByDisplayName(paths: string[]): string[] {
  return [...paths].sort((a, b) => {
    const byName = extractFileName(a).localeCompare(
      extractFileName(b),
      undefined,
      { sensitivity: "base" }
    );
    if (byName !== 0) {
      return byName;
    }
    return a.localeCompare(b, undefined, { sensitivity: "base" });
  });
}

function resolveLocalStatus(
  change: LocalDraftChange | undefined
): LocalFileStatus {
  if (!change) {
    return "unchanged";
  }
  if (change.isDeleted) {
    return "deleted";
  }
  return change.headContent === null ? "created" : "changed";
}

function resolveSourceStatus(
  change: SourceChangeRecord | undefined
): SourceFileStatus {
  if (!change) {
    return "unchanged";
  }
  switch (change.kind) {
    case "add":
      return "added";
    case "delete":
      return "deleted";
    default:
      return "changed";
  }
}

export function buildBankInventory(input: BankInventoryInput): BankInventory {
  const {
    bankPath,
    sendersPath,
    remoteFormatFiles,
    draftPaths,
    localChanges,
    sourceChanges,
  } = input;

  const localChangesInBank = localChanges.filter((change) =>
    isInBank(change.filePath, bankPath)
  );
  const localChangeByPath = new Map(
    localChangesInBank.map((change) => [change.filePath, change])
  );
  const sourceChangesInBank = sourceChanges.filter((change) =>
    isInBank(change.path, bankPath)
  );
  const sourceChangeByPath = new Map(
    sourceChangesInBank.map((change) => [change.path, change])
  );

  const localChangedFormatFiles = new Set(
    localChangesInBank
      .filter((change) => isBankFormatFilePath(change.filePath, bankPath))
      .map((change) => change.filePath)
  );
  const sourceFormatChanges = sourceChangesInBank.filter((change) =>
    isBankFormatFilePath(change.path, bankPath)
  );
  const changedFormatFiles = new Set([
    ...localChangedFormatFiles,
    ...sourceFormatChanges.map((change) => change.path),
  ]);

  const visibleDeletedFormatFiles = new Set(
    localChangesInBank
      .filter(
        (change) =>
          change.isDeleted && isBankFormatFilePath(change.filePath, bankPath)
      )
      .map((change) => change.filePath)
  );
  for (const change of sourceFormatChanges) {
    if (change.kind === "delete" && !localChangedFormatFiles.has(change.path)) {
      visibleDeletedFormatFiles.add(change.path);
    }
  }

  const draftFormatFiles = draftPaths.filter((path) =>
    isBankFormatFilePath(path, bankPath)
  );
  const formatFiles = sortFormatPaths(
    Array.from(
      new Set([
        ...remoteFormatFiles,
        ...draftFormatFiles,
        ...changedFormatFiles,
      ])
    ),
    changedFormatFiles
  );

  const unsupportedFiles = sortFilePathsByDisplayName(
    Array.from(
      new Set(
        sourceChangesInBank
          .filter(
            (change) =>
              change.path !== sendersPath &&
              !isBankFormatFilePath(change.path, bankPath)
          )
          .map((change) => change.path)
      )
    )
  );

  const recordsByPath = new Map<string, BankFileRecord>();
  for (const path of unsupportedFiles) {
    recordsByPath.set(path, {
      path,
      fileClass: "unsupported",
      local: "unchanged",
      source: "unsupported",
      isVisibleDeleted: false,
    });
  }
  recordsByPath.set(sendersPath, {
    path: sendersPath,
    fileClass: "senders",
    local: resolveLocalStatus(localChangeByPath.get(sendersPath)),
    source: resolveSourceStatus(sourceChangeByPath.get(sendersPath)),
    isVisibleDeleted: false,
  });
  for (const path of formatFiles) {
    recordsByPath.set(path, {
      path,
      fileClass: "format",
      local: resolveLocalStatus(localChangeByPath.get(path)),
      source: resolveSourceStatus(sourceChangeByPath.get(path)),
      isVisibleDeleted: visibleDeletedFormatFiles.has(path),
    });
  }

  const renamedInSource = sourceChangesInBank.filter(
    (change) => change.kind === "rename" && change.oldPath !== undefined
  );
  const renamedNewPaths = new Set(renamedInSource.map((change) => change.path));
  const mainLayerPaths = sortFilePathsByDisplayName(
    Array.from(
      new Set([
        ...[sendersPath, ...remoteFormatFiles].filter(
          (path) =>
            sourceChangeByPath.get(path)?.kind !== "add" &&
            !renamedNewPaths.has(path)
        ),
        ...sourceChangesInBank
          .filter(
            (change) =>
              change.kind === "delete" &&
              (change.path === sendersPath ||
                isBankFormatFilePath(change.path, bankPath))
          )
          .map((change) => change.path),
        ...renamedInSource.flatMap((change) =>
          change.oldPath !== undefined &&
          (change.oldPath === sendersPath ||
            isBankFormatFilePath(change.oldPath, bankPath))
            ? [change.oldPath]
            : []
        ),
      ])
    )
  );

  const prLayerPaths = Array.from(recordsByPath.values())
    .filter(
      (record) =>
        (record.fileClass === "format" || record.fileClass === "senders") &&
        (record.source === "added" || record.source === "changed")
    )
    .map((record) => record.path)
    .sort();

  return {
    recordsByPath,
    formatFiles,
    unsupportedFiles,
    visibleDeletedFormatFiles,
    liveFormatPaths: formatFiles.filter(
      (path) => !visibleDeletedFormatFiles.has(path)
    ),
    changedFormatFiles,
    changedFormatPaths: Array.from(changedFormatFiles),
    mainLayerPaths,
    prLayerPaths,
    hasLocalChangesInBank: localChangesInBank.length > 0,
  };
}
