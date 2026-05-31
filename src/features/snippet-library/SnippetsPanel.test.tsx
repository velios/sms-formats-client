import { fireEvent, render, screen } from "@testing-library/react";
import type * as React from "react";
import { describe, expect, it, vi } from "vitest";
import { SnippetsPanel } from "./SnippetsPanel";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { resolvedLanguage: "ru" },
  }),
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

describe("SnippetsPanel", () => {
  it("renders insertable snippet cards", () => {
    render(<SnippetsPanel onInsert={() => undefined} />);
    expect(getInsertButtons().length).toBeGreaterThan(0);
    expect(screen.getByText("([A-Z]{3})")).toBeInTheDocument();
  });

  it("filters snippets by the search query", () => {
    render(<SnippetsPanel onInsert={() => undefined} />);
    const before = getInsertButtons().length;

    fireEvent.change(screen.getByPlaceholderText("snippets.search"), {
      target: { value: "balance" },
    });

    const after = getInsertButtons().length;
    expect(after).toBeLessThan(before);
    expect(after).toBe(2);
  });

  it("inserts the snippet pattern without any close side effect", () => {
    const onInsert = vi.fn();
    render(<SnippetsPanel onInsert={onInsert} />);

    fireEvent.change(screen.getByPlaceholderText("snippets.search"), {
      target: { value: "([A-Z]{3})" },
    });
    fireEvent.click(getInsertButtons()[0]!);

    expect(onInsert).toHaveBeenCalledWith("([A-Z]{3})");
  });
});
