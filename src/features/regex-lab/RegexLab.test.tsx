import * as React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { RegexLab } from "./RegexLab";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { resolvedLanguage: "ru" },
  }),
}));

vi.mock("@/components/ModalDialog", () => ({
  ModalDialog: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
}));

vi.mock("@/components/ui/button", () => ({
  Button: ({
    asChild,
    children,
    ...props
  }: React.ButtonHTMLAttributes<HTMLButtonElement> & {
    asChild?: boolean;
  }) => {
    if (asChild) {
      return children;
    }
    return <button {...props}>{children}</button>;
  },
}));

vi.mock("@/components/ui/input", () => ({
  Input: (props: React.InputHTMLAttributes<HTMLInputElement>) => (
    <input {...props} />
  ),
}));

vi.mock("@/components/ui/status-badge", () => ({
  StatusBadge: ({
    children,
    ...props
  }: React.HTMLAttributes<HTMLDivElement>) => <div {...props}>{children}</div>,
}));

vi.mock("@/features/quick-reference/QuickReference", () => ({
  QuickReference: () => <div>quick-reference</div>,
}));

vi.mock("@/features/regex-lab/UnifiedRegexEditor", () => ({
  UnifiedRegexEditor: ({
    regex,
    onBlur,
    onRegexChange,
  }: {
    regex: string;
    onBlur?: () => void;
    onRegexChange: (value: string) => void;
  }) => (
    <input
      aria-label="regex"
      onBlur={onBlur}
      onChange={(event) => onRegexChange(event.target.value)}
      value={regex}
    />
  ),
}));

vi.mock("@/lib/utils", () => ({
  cn: (...values: Array<string | false | null | undefined>) =>
    values.filter(Boolean).join(" "),
}));

function RegexLabHarness() {
  const [activeExampleIndex, setActiveExampleIndex] = React.useState(0);
  const [examples, setExamples] = React.useState(["PAY 100", "PAY 200"]);
  const handleOpenIntersectionFileInApp = vi.fn();

  return (
    <RegexLab
      activeExampleIndex={activeExampleIndex}
      columns={[]}
      examples={examples}
      intersectionExamples={[
        {
          fileName: "another.txt",
          filePath: "banks/pumb/formats/another.txt",
          text: "PAY 300",
        },
        {
          fileName: "third.txt",
          filePath: "banks/pumb/formats/third.txt",
          text: "PAY 400",
        },
      ]}
      onActiveExampleChange={setActiveExampleIndex}
      onAddExample={() => undefined}
      onColumnsChange={() => undefined}
      onExampleChange={(index, value) =>
        setExamples((prev) =>
          prev.map((item, itemIndex) =>
            itemIndex === index ? value : item
          )
        )
      }
      onRegexChange={() => undefined}
      onOpenIntersectionFileInApp={handleOpenIntersectionFileInApp}
      onRemoveExample={() => undefined}
      regex="^PAY (\\d+)$"
    />
  );
}

beforeAll(() => {
  window.HTMLElement.prototype.scrollIntoView = vi.fn();
});

describe("RegexLab intersection example toggle", () => {
  it("switches between editable own examples and read-only intersection examples", () => {
    render(<RegexLabHarness />);

    const textarea = screen.getByDisplayValue("PAY 100");

    expect(
      screen.getByRole("button", { name: "editor.showIntersections" })
    ).toBeInTheDocument();
    expect(textarea).toHaveValue("PAY 100");
    expect(textarea).not.toHaveAttribute("readonly");

    fireEvent.click(
      screen.getByRole("button", { name: "editor.showIntersections" })
    );

    expect(
      screen.getByRole("button", { name: "editor.showExamples" })
    ).toBeInTheDocument();
    expect(textarea).toHaveValue("PAY 300");
    expect(textarea).toHaveAttribute("readonly");

    fireEvent.click(screen.getByRole("button", { name: "#2" }));

    expect(textarea).toHaveValue("PAY 400");

    fireEvent.click(screen.getByRole("button", { name: "editor.showExamples" }));

    expect(textarea).toHaveValue("PAY 100");
    expect(textarea).not.toHaveAttribute("readonly");
  });

  it("opens the linked file from an intersection tab action", () => {
    const handleOpenIntersectionFileInApp = vi.fn();

    render(
      <RegexLab
        activeExampleIndex={0}
        columns={[]}
        examples={["PAY 100"]}
        intersectionExamples={[
          {
            fileName: "another.txt",
            filePath: "banks/pumb/formats/another.txt",
            text: "PAY 300",
          },
        ]}
        onActiveExampleChange={() => undefined}
        onAddExample={() => undefined}
        onColumnsChange={() => undefined}
        onExampleChange={() => undefined}
        onOpenIntersectionFileInApp={handleOpenIntersectionFileInApp}
        onRegexChange={() => undefined}
        onRemoveExample={() => undefined}
        regex="^PAY (\\d+)$"
      />
    );

    fireEvent.click(
      screen.getByRole("button", { name: "editor.showIntersections" })
    );
    fireEvent.click(
      screen.getByRole("button", {
        name: "quickCheck.openInApp: another.txt",
      })
    );

    expect(handleOpenIntersectionFileInApp).toHaveBeenCalledWith(
      "banks/pumb/formats/another.txt"
    );
  });
});
