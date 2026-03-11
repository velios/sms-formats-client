import { describe, expect, it, vi } from "vitest";
import { confirmSourceSwitch } from "./source-switch";

describe("confirmSourceSwitch", () => {
  it("proceeds without touching drafts when there are no drafts", () => {
    const clearAll = vi.fn();
    const confirm = vi.fn(() => true);

    const result = confirmSourceSwitch({
      confirm,
      confirmMessage: "confirm",
      draftStore: {
        clearAll,
        hasDrafts: () => false,
      },
    });

    expect(result).toBe(true);
    expect(confirm).not.toHaveBeenCalled();
    expect(clearAll).not.toHaveBeenCalled();
  });

  it("does not ask for confirmation or clear drafts when switching PRs with drafts", () => {
    const clearAll = vi.fn();
    const confirm = vi.fn(() => false);

    const result = confirmSourceSwitch({
      confirm,
      confirmMessage: "confirm",
      draftStore: {
        clearAll,
        hasDrafts: () => true,
      },
    });

    expect(result).toBe(true);
    expect(confirm).not.toHaveBeenCalled();
    expect(clearAll).not.toHaveBeenCalled();
  });
});
