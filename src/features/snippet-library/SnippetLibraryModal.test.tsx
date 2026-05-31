import { fireEvent, render, screen } from "@testing-library/react";
import type * as React from "react";
import { describe, expect, it, vi } from "vitest";
import { SnippetLibraryModal } from "./SnippetLibraryModal";

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
    children,
    ...props
  }: React.ButtonHTMLAttributes<HTMLButtonElement>) => (
    <button {...props}>{children}</button>
  ),
}));

vi.mock("@/components/ui/input", () => ({
  Input: (props: React.InputHTMLAttributes<HTMLInputElement>) => (
    <input {...props} />
  ),
}));

vi.mock("@/components/ui/status-badge", () => ({
  StatusBadge: ({ children }: { children: React.ReactNode }) => (
    <span>{children}</span>
  ),
}));

vi.mock("@/lib/utils", () => ({
  cn: (...values: Array<string | false | null | undefined>) =>
    values.filter(Boolean).join(" "),
}));

function getInsertButtons() {
  return screen.getAllByRole("button", { name: "snippets.insert" });
}

describe("SnippetLibraryModal", () => {
  it("renders insertable snippet cards", () => {
    render(
      <SnippetLibraryModal
        onClose={() => undefined}
        onInsert={() => undefined}
      />
    );
    expect(getInsertButtons().length).toBeGreaterThan(0);
    expect(screen.getByText("([A-Z]{3})")).toBeInTheDocument();
  });

  it("filters snippets by the search query", () => {
    render(
      <SnippetLibraryModal
        onClose={() => undefined}
        onInsert={() => undefined}
      />
    );
    const before = getInsertButtons().length;

    fireEvent.change(screen.getByPlaceholderText("snippets.search"), {
      target: { value: "balance" },
    });

    const after = getInsertButtons().length;
    expect(after).toBeLessThan(before);
    expect(after).toBe(2);
  });

  it("inserts the snippet pattern and closes on insert click", () => {
    const onInsert = vi.fn();
    const onClose = vi.fn();
    render(<SnippetLibraryModal onClose={onClose} onInsert={onInsert} />);

    fireEvent.change(screen.getByPlaceholderText("snippets.search"), {
      target: { value: "([A-Z]{3})" },
    });
    fireEvent.click(getInsertButtons()[0]!);

    expect(onInsert).toHaveBeenCalledWith("([A-Z]{3})");
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
