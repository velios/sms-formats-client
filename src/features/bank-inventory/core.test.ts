import { describe, expect, it } from "vitest";
import {
  type BankInventoryInput,
  buildBankInventory,
} from "@/features/bank-inventory/core";

const BANK_PATH = "banks/pumb";
const SENDERS_PATH = "banks/pumb/senders.txt";

function buildInventory(overrides: Partial<BankInventoryInput> = {}) {
  return buildBankInventory({
    bankPath: BANK_PATH,
    sendersPath: SENDERS_PATH,
    remoteFormatFiles: [],
    draftPaths: [],
    localChanges: [],
    sourceChanges: [],
    ...overrides,
  });
}

function localChange(params: {
  filePath: string;
  content?: string;
  remoteContent?: string;
  isDeleted?: boolean;
}) {
  return {
    filePath: params.filePath,
    content: params.content ?? "draft",
    remoteContent: params.remoteContent ?? "remote",
    isDeleted: params.isDeleted ?? false,
  };
}

describe("buildBankInventory records", () => {
  it("classifies every bank file: unsupported and senders alongside formats", () => {
    const inventory = buildInventory({
      remoteFormatFiles: ["banks/pumb/formats/existing.txt"],
      sourceChanges: [
        { path: "banks/pumb/notes.md", kind: "modify" },
        { path: SENDERS_PATH, kind: "modify" },
      ],
    });

    expect(
      Array.from(inventory.recordsByPath.values()).map((record) => [
        record.path,
        record.fileClass,
      ])
    ).toEqual([
      ["banks/pumb/notes.md", "unsupported"],
      [SENDERS_PATH, "senders"],
      ["banks/pumb/formats/existing.txt", "format"],
    ]);
  });

  it("marks a draft with empty remote content as locally created", () => {
    const inventory = buildInventory({
      draftPaths: ["banks/pumb/formats/new.txt"],
      localChanges: [
        localChange({
          filePath: "banks/pumb/formats/new.txt",
          remoteContent: "",
        }),
      ],
    });

    expect(
      inventory.recordsByPath.get("banks/pumb/formats/new.txt")?.local
    ).toBe("created");
  });

  it("keeps a file added in the PR as source-added, not locally created", () => {
    const inventory = buildInventory({
      sourceChanges: [{ path: "banks/pumb/formats/added.txt", kind: "add" }],
    });

    const record = inventory.recordsByPath.get("banks/pumb/formats/added.txt");
    expect(record?.local).toBe("unchanged");
    expect(record?.source).toBe("added");
  });

  it("degrades a source change without kind to plain changed", () => {
    const inventory = buildInventory({
      sourceChanges: [{ path: "banks/pumb/formats/from-fallback.txt" }],
    });

    expect(
      inventory.recordsByPath.get("banks/pumb/formats/from-fallback.txt")
        ?.source
    ).toBe("changed");
  });

  it("keeps the local dimension of unsupported records unchanged", () => {
    const inventory = buildInventory({
      localChanges: [localChange({ filePath: "banks/pumb/notes.md" })],
      sourceChanges: [{ path: "banks/pumb/notes.md", kind: "modify" }],
    });

    const record = inventory.recordsByPath.get("banks/pumb/notes.md");
    expect(record?.fileClass).toBe("unsupported");
    expect(record?.local).toBe("unchanged");
    expect(record?.source).toBe("unsupported");
  });

  it("tracks senders status in both dimensions like any other record", () => {
    const localOnly = buildInventory({
      localChanges: [localChange({ filePath: SENDERS_PATH })],
    });
    expect(localOnly.recordsByPath.get(SENDERS_PATH)).toMatchObject({
      fileClass: "senders",
      local: "changed",
      source: "unchanged",
    });

    const sourceOnly = buildInventory({
      sourceChanges: [{ path: SENDERS_PATH, kind: "modify" }],
    });
    expect(sourceOnly.recordsByPath.get(SENDERS_PATH)).toMatchObject({
      local: "unchanged",
      source: "changed",
    });
  });
});

describe("buildBankInventory deleted-file visibility", () => {
  it("keeps a source-deleted file visible until a local draft overrides it", () => {
    const sourceDeleted = buildInventory({
      sourceChanges: [
        { path: "banks/pumb/formats/deleted-in-pr.txt", kind: "delete" },
      ],
    });
    expect(
      sourceDeleted.recordsByPath.get("banks/pumb/formats/deleted-in-pr.txt")
        ?.isVisibleDeleted
    ).toBe(true);
    expect(Array.from(sourceDeleted.visibleDeletedFormatFiles)).toEqual([
      "banks/pumb/formats/deleted-in-pr.txt",
    ]);

    const locallyOverridden = buildInventory({
      sourceChanges: [
        { path: "banks/pumb/formats/deleted-in-pr.txt", kind: "delete" },
      ],
      localChanges: [
        localChange({
          filePath: "banks/pumb/formats/deleted-in-pr.txt",
          remoteContent: "",
        }),
      ],
    });
    expect(
      locallyOverridden.recordsByPath.get(
        "banks/pumb/formats/deleted-in-pr.txt"
      )?.isVisibleDeleted
    ).toBe(false);
    expect(Array.from(locallyOverridden.visibleDeletedFormatFiles)).toEqual([]);
  });

  it("always shows a locally deleted file as deleted", () => {
    const inventory = buildInventory({
      remoteFormatFiles: ["banks/pumb/formats/gone.txt"],
      localChanges: [
        localChange({
          filePath: "banks/pumb/formats/gone.txt",
          isDeleted: true,
        }),
      ],
    });

    const record = inventory.recordsByPath.get("banks/pumb/formats/gone.txt");
    expect(record?.local).toBe("deleted");
    expect(record?.isVisibleDeleted).toBe(true);
  });
});

describe("buildBankInventory selections", () => {
  it("includes PR-deleted format files in the combined format list", () => {
    const inventory = buildInventory({
      remoteFormatFiles: ["banks/pumb/formats/existing.txt"],
      sourceChanges: [
        { path: "banks/pumb/formats/deleted-in-pr.txt", kind: "delete" },
      ],
    });

    expect(inventory.formatFiles).toEqual([
      "banks/pumb/formats/deleted-in-pr.txt",
      "banks/pumb/formats/existing.txt",
    ]);
  });

  it("sorts format files with changed on top, then by display name", () => {
    const inventory = buildInventory({
      remoteFormatFiles: [
        "banks/pumb/formats/b.txt",
        "banks/pumb/formats/a.txt",
        "banks/pumb/formats/z.txt",
      ],
      localChanges: [localChange({ filePath: "banks/pumb/formats/z.txt" })],
    });

    expect(inventory.formatFiles).toEqual([
      "banks/pumb/formats/z.txt",
      "banks/pumb/formats/a.txt",
      "banks/pumb/formats/b.txt",
    ]);
  });

  it("collects changed source files that do not match the format-file rule", () => {
    const inventory = buildInventory({
      sourceChanges: [
        { path: "banks/pumb/formats/existing.txt", kind: "add" },
        { path: "banks/pumb/formats/no-extension", kind: "add" },
        { path: "banks/pumb/notes.md", kind: "modify" },
        { path: SENDERS_PATH, kind: "modify" },
        { path: "banks/other/formats/skip.txt", kind: "modify" },
      ],
    });

    expect(inventory.unsupportedFiles).toEqual([
      "banks/pumb/formats/no-extension",
      "banks/pumb/notes.md",
    ]);
  });

  it("excludes visibly deleted files from live format paths", () => {
    const inventory = buildInventory({
      remoteFormatFiles: [
        "banks/pumb/formats/alive.txt",
        "banks/pumb/formats/gone.txt",
      ],
      localChanges: [
        localChange({
          filePath: "banks/pumb/formats/gone.txt",
          isDeleted: true,
        }),
      ],
    });

    expect(inventory.liveFormatPaths).toEqual(["banks/pumb/formats/alive.txt"]);
  });

  it("exposes changed format paths from both dimensions for validation", () => {
    const inventory = buildInventory({
      remoteFormatFiles: ["banks/pumb/formats/local.txt"],
      localChanges: [localChange({ filePath: "banks/pumb/formats/local.txt" })],
      sourceChanges: [
        { path: "banks/pumb/formats/source.txt", kind: "modify" },
      ],
    });

    expect(inventory.changedFormatFiles).toEqual(
      new Set(["banks/pumb/formats/local.txt", "banks/pumb/formats/source.txt"])
    );
    expect([...inventory.changedFormatPaths].sort()).toEqual([
      "banks/pumb/formats/local.txt",
      "banks/pumb/formats/source.txt",
    ]);
  });

  it("collects live local format contents without deleted, senders and unsupported files", () => {
    const inventory = buildInventory({
      localChanges: [
        localChange({
          filePath: "banks/pumb/formats/kept.txt",
          content: "kept-content",
        }),
        localChange({
          filePath: "banks/pumb/formats/gone.txt",
          isDeleted: true,
        }),
        localChange({ filePath: SENDERS_PATH, content: "senders-content" }),
        localChange({ filePath: "banks/pumb/notes.md" }),
        localChange({ filePath: "banks/other/formats/foreign.txt" }),
      ],
    });

    expect(inventory.formatContentsForValidation).toEqual(
      new Map([["banks/pumb/formats/kept.txt", "kept-content"]])
    );
  });

  it("reports local changes in the bank for reset-to-source", () => {
    expect(buildInventory().hasLocalChangesInBank).toBe(false);
    expect(
      buildInventory({
        localChanges: [localChange({ filePath: "banks/other/formats/x.txt" })],
      }).hasLocalChangesInBank
    ).toBe(false);
    expect(
      buildInventory({
        localChanges: [localChange({ filePath: SENDERS_PATH })],
      }).hasLocalChangesInBank
    ).toBe(true);
  });
});
