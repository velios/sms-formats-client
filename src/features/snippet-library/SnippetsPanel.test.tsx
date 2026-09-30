import { describe, expect, it, mock } from "bun:test";
import { fireEvent, render, screen, within } from "@testing-library/react";
import type * as React from "react";

mock.module("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { resolvedLanguage: "ru" },
  }),
}));

mock.module("@/components/ui/button", () => ({
  Button: ({
    children,
    ...props
  }: React.ButtonHTMLAttributes<HTMLButtonElement>) => (
    <button {...props}>{children}</button>
  ),
}));

mock.module("@/components/ui/status-badge", () => ({
  StatusBadge: ({ children }: { children: React.ReactNode }) => (
    <span>{children}</span>
  ),
}));

mock.module("@/lib/utils", () => ({
  cn: (...values: Array<string | false | null | undefined>) =>
    values.filter(Boolean).join(" "),
}));

const { SnippetsPanel } = await import("./SnippetsPanel");

function getInsertButtons() {
  return screen.getAllByRole("button", { name: "snippets.insert" });
}

describe("SnippetsPanel", () => {
  it("renders insertable snippet cards", () => {
    render(<SnippetsPanel onInsert={() => undefined} />);
    expect(getInsertButtons().length).toBeGreaterThan(0);
    expect(screen.getByText("([A-Z]{3})")).toBeInTheDocument();
  });

  it("filters snippets by the selected group pill", () => {
    render(<SnippetsPanel onInsert={() => undefined} />);
    const before = getInsertButtons().length;

    fireEvent.click(
      screen.getByRole("button", { name: "snippets.groups.balance" })
    );

    const after = getInsertButtons().length;
    expect(after).toBeLessThan(before);
    expect(after).toBeGreaterThan(0);
  });

  it("shows all snippets again on the all-groups pill", () => {
    render(<SnippetsPanel onInsert={() => undefined} />);
    const before = getInsertButtons().length;

    fireEvent.click(
      screen.getByRole("button", { name: "snippets.groups.balance" })
    );
    fireEvent.click(screen.getByRole("button", { name: "snippets.allGroups" }));

    expect(getInsertButtons().length).toBe(before);
  });

  it("shows the gotcha line on cards that define one", () => {
    render(<SnippetsPanel onInsert={() => undefined} />);
    const gotchaLabels = screen.getAllByText("snippets.gotcha:", {
      exact: false,
    });
    expect(gotchaLabels.length).toBeGreaterThan(0);
  });

  it("inserts the snippet pattern without any close side effect", () => {
    const onInsert = mock();
    render(<SnippetsPanel onInsert={onInsert} />);

    fireEvent.click(
      screen.getByRole("button", { name: "snippets.groups.currency" })
    );
    const card = screen.getByText("([A-Z]{3})").closest("div")!;
    fireEvent.click(
      within(card).getByRole("button", { name: "snippets.insert" })
    );

    expect(onInsert).toHaveBeenCalledWith("([A-Z]{3})");
  });
});
