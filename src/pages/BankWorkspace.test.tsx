import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/store", () => ({
  useDraftStore: () => ({}),
  useSourceStore: () => ({}),
}));

import type { BankFileRecord } from "@/features/bank-inventory/core";
import {
  FormatsPanel,
  resolveAutoSelectFile,
  resolveSourceChangeFacts,
  resolveWorkspaceEntryMode,
} from "@/pages/BankWorkspace";

function fileRecord(
  path: string,
  overrides: Partial<Omit<BankFileRecord, "path">> = {}
): [string, BankFileRecord] {
  return [
    path,
    {
      path,
      fileClass: "format",
      local: "unchanged",
      source: "unchanged",
      isVisibleDeleted: false,
      ...overrides,
    },
  ];
}

function renderFormatsPanel(params: {
  intersectingOtherFormats: number;
  fileRecords?: Map<string, BankFileRecord>;
  unsupportedSourceFiles?: string[];
  visibleFormats?: string[];
}) {
  const {
    intersectingOtherFormats,
    fileRecords = new Map(),
    unsupportedSourceFiles = [],
    visibleFormats = ["banks/pumb/formats/example.txt"],
  } = params;
  const handleSelectFile = vi.fn();
  const onScopeIntersections = vi.fn();

  const view = render(
    <FormatsPanel
      createFormatDisabled={false}
      fileRecords={fileRecords}
      formatIntersectionStats={
        new Map([
          [
            "banks/pumb/formats/example.txt",
            {
              filePath: "banks/pumb/formats/example.txt",
              totalExamples: 8,
              ownMatchedExamples: 8,
              intersectingOtherFormats,
              intersectingFormatPaths: [],
              intersectingExamples: [],
              ownUnmatchedExamples: [],
            },
          ],
        ])
      }
      formatSearch=""
      formatTab="all"
      handleSelectFile={handleSelectFile}
      handleSelectSenders={vi.fn()}
      intersectionScopeFiles={null}
      onFocusedFilePathHandled={vi.fn()}
      onScopeIntersections={onScopeIntersections}
      pendingFocusedFilePath={null}
      recentFiles={[]}
      refName="main"
      repository={{ owner: "flocktory", repo: "sms-formats-client" }}
      searchIndexingLabel=""
      selectedFile={null}
      sendersMissing={false}
      sendersPath="banks/pumb/senders.txt"
      setFormatSearch={vi.fn()}
      setFormatTab={vi.fn()}
      setShowCreateFormat={vi.fn()}
      showSearchIndexStatus={false}
      showSenders={false}
      t={(key) => key}
      totalFilesCount={visibleFormats.length + unsupportedSourceFiles.length}
      tTemplate={(key, options) =>
        `${key}:${String(options?.file)}:${String(options?.count)}`
      }
      unsupportedSourceFiles={unsupportedSourceFiles}
      visibleFormats={visibleFormats}
    />
  );

  return { ...view, handleSelectFile, onScopeIntersections };
}

describe("FormatsPanel intersections", () => {
  it("scopes the intersections tab from the active intersections badge", () => {
    const { handleSelectFile, onScopeIntersections } = renderFormatsPanel({
      intersectingOtherFormats: 2,
    });

    fireEvent.click(
      screen.getByRole("button", {
        name: "bank.scopeIntersections:example.txt:2",
      })
    );

    expect(onScopeIntersections).toHaveBeenCalledWith(
      "banks/pumb/formats/example.txt"
    );
    expect(handleSelectFile).not.toHaveBeenCalled();
  });

  it("does not render intersection action when there are no intersections", () => {
    renderFormatsPanel({ intersectingOtherFormats: 0 });

    expect(
      screen.queryByRole("button", {
        name: /bank\.scopeIntersections/,
      })
    ).not.toBeInTheDocument();
  });

  it("does not render intersection indicators for deleted files", () => {
    renderFormatsPanel({
      intersectingOtherFormats: 2,
      fileRecords: new Map([
        fileRecord("banks/pumb/formats/example.txt", {
          local: "deleted",
          isVisibleDeleted: true,
        }),
      ]),
    });

    expect(
      screen.queryByRole("button", {
        name: /bank\.scopeIntersections/,
      })
    ).not.toBeInTheDocument();
    expect(
      screen.queryByText(/\b8\s*\/\s*8\s*\/\s*2\b/)
    ).not.toBeInTheDocument();
  });

  it("renders unsupported PR files first and applies source/local status colors", () => {
    const { container } = renderFormatsPanel({
      intersectingOtherFormats: 0,
      fileRecords: new Map([
        fileRecord("banks/pumb/formats/local-draft.txt", {
          local: "changed",
          source: "changed",
        }),
        fileRecord("banks/pumb/formats/local-created.txt", {
          local: "created",
        }),
        fileRecord("banks/pumb/formats/source-added.txt", {
          source: "added",
        }),
        fileRecord("banks/pumb/formats/source-modified.txt", {
          source: "changed",
        }),
        fileRecord("banks/pumb/formats/unsupported", {
          fileClass: "unsupported",
          source: "unsupported",
        }),
      ]),
      unsupportedSourceFiles: ["banks/pumb/formats/unsupported"],
      visibleFormats: [
        "banks/pumb/formats/source-added.txt",
        "banks/pumb/formats/source-modified.txt",
        "banks/pumb/formats/local-draft.txt",
        "banks/pumb/formats/local-created.txt",
      ],
    });

    const renderedPaths = Array.from(
      container.querySelectorAll<HTMLElement>("[data-file-path]")
    ).map((element) => element.dataset.filePath);

    expect(renderedPaths).toEqual([
      "banks/pumb/formats/unsupported",
      "banks/pumb/senders.txt",
      "banks/pumb/formats/source-added.txt",
      "banks/pumb/formats/source-modified.txt",
      "banks/pumb/formats/local-draft.txt",
      "banks/pumb/formats/local-created.txt",
    ]);

    expect(
      container
        .querySelector(
          '[data-file-path="banks/pumb/formats/unsupported"] [data-slot="badge"]'
        )
        ?.getAttribute("data-variant")
    ).toBe("error");
    expect(
      container
        .querySelector(
          '[data-file-path="banks/pumb/formats/local-draft.txt"] [data-slot="badge"]'
        )
        ?.getAttribute("data-variant")
    ).toBe("modified");
    // A file created locally (absent from head-ref) is green.
    expect(
      container
        .querySelector(
          '[data-file-path="banks/pumb/formats/local-created.txt"] [data-slot="badge"]'
        )
        ?.getAttribute("data-variant")
    ).toBe("success");
    // A file added in the PR lives in head-ref → yellow, not green.
    expect(
      container
        .querySelector(
          '[data-file-path="banks/pumb/formats/source-added.txt"] [data-slot="badge"]'
        )
        ?.getAttribute("data-variant")
    ).toBe("warning");
    expect(
      container
        .querySelector(
          '[data-file-path="banks/pumb/formats/source-modified.txt"] [data-slot="badge"]'
        )
        ?.getAttribute("data-variant")
    ).toBe("warning");
  });

  it("prefers session records with kind over store and fetched paths", () => {
    expect(
      resolveSourceChangeFacts({
        sourceRefType: "pr",
        sessionChangedFiles: [
          { kind: "delete", path: "banks/pumb/formats/gone.txt" },
        ],
        storeChangedFilePaths: ["banks/pumb/formats/from-store.txt"],
        fetchedPrChangedFilePaths: ["banks/pumb/formats/from-fetch.txt"],
        isPrChangedFilesReady: false,
      })
    ).toEqual({
      records: [{ kind: "delete", path: "banks/pumb/formats/gone.txt" }],
      isSelectionReady: true,
    });
  });

  it("degrades fallback providers to kind-less records", () => {
    expect(
      resolveSourceChangeFacts({
        sourceRefType: "pr",
        sessionChangedFiles: [],
        storeChangedFilePaths: ["banks/pumb/formats/from-store.txt"],
        fetchedPrChangedFilePaths: [],
        isPrChangedFilesReady: false,
      })
    ).toEqual({
      records: [{ path: "banks/pumb/formats/from-store.txt" }],
      isSelectionReady: true,
    });

    expect(
      resolveSourceChangeFacts({
        sourceRefType: "pr",
        sessionChangedFiles: [],
        storeChangedFilePaths: [],
        fetchedPrChangedFilePaths: ["banks/pumb/formats/from-fetch.txt"],
        isPrChangedFilesReady: true,
      })
    ).toEqual({
      records: [{ path: "banks/pumb/formats/from-fetch.txt" }],
      isSelectionReady: true,
    });
  });

  it("holds selection readiness until the PR file fetch settles", () => {
    expect(
      resolveSourceChangeFacts({
        sourceRefType: "pr",
        sessionChangedFiles: [],
        storeChangedFilePaths: [],
        fetchedPrChangedFilePaths: [],
        isPrChangedFilesReady: false,
      }).isSelectionReady
    ).toBe(false);

    expect(
      resolveSourceChangeFacts({
        sourceRefType: "branch",
        sessionChangedFiles: [],
        storeChangedFilePaths: [],
        fetchedPrChangedFilePaths: [],
        isPrChangedFilesReady: false,
      }).isSelectionReady
    ).toBe(true);
  });

  it("prioritizes stale drafts over read-only when opening a PR workspace", () => {
    expect(
      resolveWorkspaceEntryMode({
        headSha: "new-head",
        persistedDrafts: [{ baseHeadSha: "old-head" }],
        writable: false,
      })
    ).toBe("stale");
  });

  it("opens read-only when the current head matches but the PR is not writable", () => {
    expect(
      resolveWorkspaceEntryMode({
        headSha: "same-head",
        persistedDrafts: [{ baseHeadSha: "same-head" }],
        writable: false,
      })
    ).toBe("read-only");
  });

  it("does not rewrite ?file before PR workspace route init becomes ready", () => {
    expect(
      resolveAutoSelectFile({
        workspaceReady: false,
        selectionReady: true,
        requestedFile: "src/TBank_123/formats/current.txt",
        allFormatFiles: [],
        sendersPath: "src/TBank_123/senders.txt",
        preferredFormatFile: null,
      })
    ).toBeUndefined();
  });
});
