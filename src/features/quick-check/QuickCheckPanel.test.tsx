import { fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { prepareFormatEntriesMock } = vi.hoisted(() => ({
  prepareFormatEntriesMock: vi.fn(),
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) =>
      key === "quickCheck.title"
        ? `quickCheck.title:${String(options?.bank ?? "")}`
        : key,
  }),
}));

vi.mock("@/components/ModalDialog", () => ({
  ModalDialog: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));

vi.mock("@/store", () => ({
  useDraftStore: () => ({
    getDraft: vi.fn(),
  }),
  useSourceStore: (selector: (state: unknown) => unknown) =>
    selector({
      repository: { owner: "flocktory", repo: "sms-formats-client" },
      sourceRef: { type: "pr", name: "pr-123", sha: "head-sha", prNumber: 123 },
    }),
}));

vi.mock("@/features/quick-check/format-entries", () => ({
  prepareFormatEntries: prepareFormatEntriesMock,
}));

import { QuickCheckPanel } from "@/features/quick-check/QuickCheckPanel";

describe("QuickCheckPanel", () => {
  beforeEach(() => {
    prepareFormatEntriesMock.mockReset();
  });

  it("opens a matched file in app and closes the panel", async () => {
    prepareFormatEntriesMock.mockResolvedValue({
      entries: [
        {
          examples: ["Matched SMS text"],
          fileName: "match.txt",
          filePath: "banks/pumb/formats/match.txt",
          fingerprint: "remote:main",
          regex: "Matched SMS text",
          source: "remote",
        },
      ],
      loadErrorsCount: 0,
      remoteFetchedCount: 1,
      cachedCount: 0,
    });
    const onClose = vi.fn();
    const onOpenFileInApp = vi.fn();

    render(
      <QuickCheckPanel
        activeFormatContext={{
          activeExampleIndex: 0,
          activeSmsText: "Matched SMS text",
          filePath: "banks/pumb/formats/source.txt",
          regex: "Matched SMS text",
        }}
        bankName="ПУМБ-ua"
        formatPaths={["banks/pumb/formats/match.txt"]}
        initialMode="sms-by-template"
        onClose={onClose}
        onOpenFileInApp={onOpenFileInApp}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "quickCheck.run" }));

    fireEvent.click(
      await screen.findByRole("button", { name: "quickCheck.openInApp" })
    );

    expect(onOpenFileInApp).toHaveBeenCalledWith(
      "banks/pumb/formats/match.txt"
    );
    expect(onClose).toHaveBeenCalled();
  });
});
