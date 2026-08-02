import { isBankFormatFilePath } from "@/domain/format";
import type { PullRequestChangedFile } from "@/domain/github";

// A change in the source ref of the editor (origin/main ↔ head-ref). Fallback
// providers know only paths, so `kind` is optional: its absence degrades the
// source dimension to plain "changed" instead of being resolved silently
// (ADR-0014).
export interface SourceChangeRecord {
  path: string;
  kind?: PullRequestChangedFile["kind"];
  // The path a renamed file had in the `main` layer; unknown for fallback
  // providers, which do not know `kind` either.
  oldPath?: string;
}

// A local draft change (head-ref ↔ browser), as reported by the draft store.
export interface LocalDraftChange {
  filePath: string;
  content: string;
  remoteContent: string;
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

// One bank file with its class and status in two independent dimensions.
// Which dimension wins on screen when both carry a fact is the panel's
// rendering policy, not the inventory's (ADR-0014).
export interface BankFileRecord {
  path: string;
  fileClass: BankFileClass;
  local: LocalFileStatus;
  source: SourceFileStatus;
  // A deleted format file stays listed (struck through); a source deletion is
  // visible only while the file is not changed locally. Invariant of the
  // inventory: true only for format records.
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

// Records over the whole bank plus selections, each named after its real
// consumer; new selections require a named consumer (ADR-0014).
export interface BankInventory {
  // Ordered: unsupported files (by display name), senders, format files
  // (changed on top). Layout across classes stays with the panel.
  recordsByPath: Map<string, BankFileRecord>;
  // Format files including draft-only and source-changed ones; consumed by
  // search, rename, auto-select and intersections.
  formatFiles: string[];
  // Non-format non-senders files changed in the source; the panel lists them
  // read-only on top.
  unsupportedFiles: string[];
  // Filter for intersections badges and scope.
  visibleDeletedFormatFiles: Set<string>;
  // Living formats for quick-check and intersections snapshots.
  liveFormatPaths: string[];
  // Emphasis set for search and the changed-on-top ordering.
  changedFormatFiles: Set<string>;
  // Scope of the validation modal.
  changedFormatPaths: string[];
  // Living format files with local content for bank-level publish validation:
  // by construction without deleted, senders and unsupported files.
  formatContentsForValidation: Map<string, string>;
  // Bank files as they exist in the `main` layer (head-ref − `add` + `delete`),
  // derived offline. Consumer: the prompt package builder, which prints them as
  // `<files layer="main">` (ADR-0016). Only format files and senders.txt —
  // unsupported files are not bank content upstream.
  mainLayerPaths: string[];
  // Bank files touched by the source ref (added or changed there). Consumer:
  // the prompt package builder, which prints them as `<files layer="pr">`
  // (ADR-0016). Only format files and senders.txt — unsupported files are not
  // bank content upstream.
  prLayerPaths: string[];
  // Enables reset-to-source.
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
  return change.remoteContent === "" ? "created" : "changed";
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

  // A source deletion is visible only while the file is not changed locally;
  // a local deletion is always visible.
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
    // Unsupported files cannot be edited in the browser, so their local
    // dimension is always "unchanged" — a guarantee of the inventory.
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

  const formatContentsForValidation = new Map(
    localChangesInBank
      .filter(
        (change) =>
          !change.isDeleted && isBankFormatFilePath(change.filePath, bankPath)
      )
      .map((change) => [change.filePath, change.content])
  );

  // head-ref composition − files added in the source ref + files deleted there.
  // A rename swaps the pair: the new path is absent in `main`, the old one is
  // present. A change of unknown kind (fallback providers) counts as present in
  // both layers, matching the "changed" degradation of the source dimension; a
  // rename with unknown `oldPath` degrades the same way.
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
        record.fileClass !== "unsupported" &&
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
    formatContentsForValidation,
    mainLayerPaths,
    prLayerPaths,
    hasLocalChangesInBank: localChangesInBank.length > 0,
  };
}
