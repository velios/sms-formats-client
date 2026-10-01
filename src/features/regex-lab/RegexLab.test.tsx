import { beforeAll, describe, expect, it, mock } from "bun:test";
import { fireEvent, render, screen } from "@testing-library/react";
import * as React from "react";

mock.module("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { resolvedLanguage: "ru" },
  }),
}));

mock.module("@/components/ModalDialog", () => ({
  ModalDialog: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
}));

mock.module("@/components/ui/button", () => ({
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

mock.module("@/components/ui/input", () => ({
  Input: (props: React.InputHTMLAttributes<HTMLInputElement>) => (
    <input {...props} />
  ),
}));

mock.module("@/components/ui/status-badge", () => ({
  StatusBadge: ({
    children,
    ...props
  }: React.HTMLAttributes<HTMLDivElement>) => <div {...props}>{children}</div>,
}));

mock.module("@/features/quick-reference/QuickReference", () => ({
  QuickReference: () => <div>quick-reference</div>,
}));

mock.module("@/features/regex-lab/RegexPatternEditor", () => ({
  RegexPatternEditor: ({
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

mock.module("@/lib/utils", () => ({
  cn: (...values: Array<string | false | null | undefined>) =>
    values.filter(Boolean).join(" "),
}));

mock.module("@/store", () => {
  const uiState = {
    highlightMode: "groups" as const,
    setHighlightMode: mock(),
  };
  return {
    useUIStore: <T,>(selector?: (state: typeof uiState) => T) =>
      selector ? selector(uiState) : uiState,
  };
});

const { RegexLab } = await import("./RegexLab");

function RegexLabHarness() {
  const [activeExampleIndex, setActiveExampleIndex] = React.useState(0);
  const [examples, setExamples] = React.useState(["PAY 100", "PAY 200"]);
  const handleOpenIntersectionFileInApp = mock();

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
          prev.map((item, itemIndex) => (itemIndex === index ? value : item))
        )
      }
      onNormalizeExample={() => undefined}
      onOpenIntersectionFileInApp={handleOpenIntersectionFileInApp}
      onRegexChange={() => undefined}
      onRemoveExample={() => undefined}
      regex="^PAY (\\d+)$"
    />
  );
}

beforeAll(() => {
  window.HTMLElement.prototype.scrollIntoView = mock();
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

    fireEvent.click(
      screen.getByRole("button", { name: "editor.showExamples" })
    );

    expect(textarea).toHaveValue("PAY 100");
    expect(textarea).not.toHaveAttribute("readonly");
  });

  it("opens the linked file from an intersection tab action", () => {
    const handleOpenIntersectionFileInApp = mock();

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
        onNormalizeExample={() => undefined}
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

describe("NFC button availability", () => {
  it("tracks the selected example and blocks readonly and intersection examples", () => {
    const normalize = mock();
    const props = {
      activeExampleIndex: 0,
      columns: [],
      examples: ["е\u0308", "ё"],
      intersectionExamples: [
        { text: "и\u0306", filePath: "other.txt", fileName: "other.txt" },
      ],
      onActiveExampleChange: mock(),
      onAddExample: mock(),
      onColumnsChange: mock(),
      onExampleChange: mock(),
      onNormalizeExample: normalize,
      onRegexChange: mock(),
      onRemoveExample: mock(),
      regex: "^(.*)$",
    };
    const view = render(<RegexLab {...props} />);
    const button = screen.getByRole("button", {
      name: "editor.normalizeExample",
    });
    expect(button).not.toBeDisabled();
    fireEvent.click(button);
    expect(normalize).toHaveBeenCalledWith(0);
    view.rerender(<RegexLab {...props} activeExampleIndex={1} />);
    expect(button).toBeDisabled();
    view.rerender(<RegexLab {...props} readOnly />);
    expect(button).toBeDisabled();
    view.rerender(<RegexLab {...props} />);
    fireEvent.click(
      screen.getByRole("button", { name: "editor.showIntersections" })
    );
    expect(button).toBeDisabled();
  });
});
