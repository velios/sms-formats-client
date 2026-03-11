import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/store", () => ({
  useDraftStore: () => ({}),
  useSourceStore: () => ({}),
}));

import {
  collectAllFormatFiles,
  FormatsPanel,
  resolveAutoSelectFile,
  resolveVisibleDeletedFormatFiles,
  resolveWorkspaceEntryMode,
} from "@/pages/BankWorkspace";

function renderFormatsPanel(params: {
  intersectingOtherFormats: number;
  deletedFormatFiles?: Set<string>;
}) {
  const { intersectingOtherFormats, deletedFormatFiles = new Set() } = params;
  const handleSelectFile = vi.fn();
  const onOpenSmsByTemplateForIntersection = vi.fn();

  render(
    <FormatsPanel
      createFormatDisabled={false}
      deletedFormatFiles={deletedFormatFiles}
      formatIntersectionStats={
        new Map([
          [
            "banks/pumb/formats/example.txt",
            {
              filePath: "banks/pumb/formats/example.txt",
              totalExamples: 8,
              ownMatchedExamples: 8,
              intersectingOtherFormats,
            },
          ],
        ])
      }
      formatSearch=""
      formatTab="all"
      handleSelectFile={handleSelectFile}
      handleSelectSenders={vi.fn()}
      localChangedFormatFiles={new Set()}
      localSendersChanged={false}
      onFocusedFilePathHandled={vi.fn()}
      onOpenSmsByTemplateForIntersection={onOpenSmsByTemplateForIntersection}
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
      sourceChangedFormatFiles={new Set()}
      sourceSendersChanged={false}
      t={(key) => key}
      totalFilesCount={1}
      tTemplate={(key, options) =>
        `${key}:${String(options?.file)}:${String(options?.count)}`
      }
      visibleFormats={["banks/pumb/formats/example.txt"]}
    />
  );

  return { handleSelectFile, onOpenSmsByTemplateForIntersection };
}

describe("FormatsPanel intersections", () => {
  it("opens SMS-by-template quick check from active intersections badge", () => {
    const { handleSelectFile, onOpenSmsByTemplateForIntersection } =
      renderFormatsPanel({ intersectingOtherFormats: 2 });

    fireEvent.click(
      screen.getByRole("button", {
        name: "quickCheck.openIntersectingSmsByTemplate:example.txt:2",
      })
    );

    expect(onOpenSmsByTemplateForIntersection).toHaveBeenCalledWith(
      "banks/pumb/formats/example.txt"
    );
    expect(handleSelectFile).not.toHaveBeenCalled();
  });

  it("does not render intersection action when there are no intersections", () => {
    renderFormatsPanel({ intersectingOtherFormats: 0 });

    expect(
      screen.queryByRole("button", {
        name: /quickCheck\.openIntersectingSmsByTemplate/,
      })
    ).not.toBeInTheDocument();
  });

  it("does not render intersection indicators for deleted files", () => {
    renderFormatsPanel({
      intersectingOtherFormats: 2,
      deletedFormatFiles: new Set(["banks/pumb/formats/example.txt"]),
    });

    expect(
      screen.queryByRole("button", {
        name: /quickCheck\.openIntersectingSmsByTemplate/,
      })
    ).not.toBeInTheDocument();
    expect(
      screen.queryByText(/\b8\s*\/\s*8\s*\/\s*2\b/)
    ).not.toBeInTheDocument();
  });

  it("includes PR-deleted format files in the combined file list", () => {
    expect(
      collectAllFormatFiles(
        "banks/pumb",
        ["banks/pumb/formats/existing.txt"],
        [],
        new Set(["banks/pumb/formats/deleted-in-pr.txt"])
      )
    ).toEqual([
      "banks/pumb/formats/deleted-in-pr.txt",
      "banks/pumb/formats/existing.txt",
    ]);
  });

  it("keeps source-deleted files struck through until a local draft overrides them", () => {
    expect(
      Array.from(
        resolveVisibleDeletedFormatFiles({
          localDeletedFormatFiles: new Set(),
          sourceDeletedFormatFiles: new Set([
            "banks/pumb/formats/deleted-in-pr.txt",
          ]),
          localChangedFormatFiles: new Set(),
        })
      )
    ).toEqual(["banks/pumb/formats/deleted-in-pr.txt"]);

    expect(
      Array.from(
        resolveVisibleDeletedFormatFiles({
          localDeletedFormatFiles: new Set(),
          sourceDeletedFormatFiles: new Set([
            "banks/pumb/formats/deleted-in-pr.txt",
          ]),
          localChangedFormatFiles: new Set([
            "banks/pumb/formats/deleted-in-pr.txt",
          ]),
        })
      )
    ).toEqual([]);

    expect(
      Array.from(
        resolveVisibleDeletedFormatFiles({
          localDeletedFormatFiles: new Set([
            "banks/pumb/formats/deleted-in-pr.txt",
          ]),
          sourceDeletedFormatFiles: new Set([
            "banks/pumb/formats/deleted-in-pr.txt",
          ]),
          localChangedFormatFiles: new Set([
            "banks/pumb/formats/deleted-in-pr.txt",
          ]),
        })
      )
    ).toEqual(["banks/pumb/formats/deleted-in-pr.txt"]);
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
