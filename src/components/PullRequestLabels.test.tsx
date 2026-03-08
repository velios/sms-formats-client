import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { PullRequestLabels } from "@/components/PullRequestLabels";

describe("PullRequestLabels", () => {
  it("collapses extra labels and expands them on click", () => {
    render(
      <PullRequestLabels
        labels={[
          { name: "bank", color: "0e8a16" },
          { name: "needs review", color: "fbca04" },
          { name: "validator", color: "d73a4a" },
        ]}
      />
    );

    expect(screen.getByRole("button", { name: "bank" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "+2" })).toBeInTheDocument();
    expect(screen.queryByText("needs review")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "bank" }));

    expect(screen.getByText("needs review")).toBeInTheDocument();
    expect(screen.getByText("validator")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "+2" })
    ).not.toBeInTheDocument();
  });

  it("stops click propagation while expanding labels", () => {
    const handleRowClick = vi.fn();

    render(
      <div onClick={handleRowClick}>
        <PullRequestLabels
          labels={[
            { name: "bank", color: "0e8a16" },
            { name: "validator", color: "d73a4a" },
          ]}
        />
      </div>
    );

    fireEvent.click(screen.getByRole("button", { name: "bank" }));

    expect(handleRowClick).not.toHaveBeenCalled();
    expect(screen.getByText("validator")).toBeInTheDocument();
  });
});
