import { describe, expect, it, vi } from "vitest";
import { confirmSourceSwitch } from "./source-switch";

describe("confirmSourceSwitch", () => {
  it("proceeds without confirmation when there are no drafts", () => {
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

  it("cancels switch when user rejects confirmation", () => {
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

    expect(result).toBe(false);
    expect(confirm).toHaveBeenCalledWith("confirm");
    expect(clearAll).not.toHaveBeenCalled();
  });

  it("clears drafts after confirmed switch", () => {
    const clearAll = vi.fn();
    const confirm = vi.fn(() => true);

    const result = confirmSourceSwitch({
      confirm,
      confirmMessage: "confirm",
      draftStore: {
        clearAll,
        hasDrafts: () => true,
      },
    });

    expect(result).toBe(true);
    expect(confirm).toHaveBeenCalledWith("confirm");
    expect(clearAll).toHaveBeenCalledTimes(1);
  });
});
