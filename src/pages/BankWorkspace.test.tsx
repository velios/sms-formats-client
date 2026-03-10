import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/store", () => ({
  useDraftStore: () => ({}),
  useSourceStore: () => ({}),
}));

import { collectAllFormatFiles, FormatsPanel } from "@/pages/BankWorkspace";

function renderFormatsPanel(intersectingOtherFormats: number) {
  const handleSelectFile = vi.fn();
  const onOpenSmsByTemplateForIntersection = vi.fn();

  render(
    <FormatsPanel
      deletedFormatFiles={new Set()}
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
      onOpenSmsByTemplateForIntersection={onOpenSmsByTemplateForIntersection}
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
      tTemplate={(key, options) =>
        `${key}:${String(options?.file)}:${String(options?.count)}`
      }
      totalFilesCount={1}
      visibleFormats={["banks/pumb/formats/example.txt"]}
    />
  );

  return { handleSelectFile, onOpenSmsByTemplateForIntersection };
}

describe("FormatsPanel intersections", () => {
  it("opens SMS-by-template quick check from active intersections badge", () => {
    const { handleSelectFile, onOpenSmsByTemplateForIntersection } =
      renderFormatsPanel(2);

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
    renderFormatsPanel(0);

    expect(
      screen.queryByRole("button", {
        name: /quickCheck\.openIntersectingSmsByTemplate/,
      })
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
});
