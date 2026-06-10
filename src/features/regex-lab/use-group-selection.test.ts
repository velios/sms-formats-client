import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { explainRegex } from "@/domain/format";
import {
  type UseGroupSelectionParams,
  useGroupSelection,
} from "./use-group-selection";

function paramsFor(
  regex: string,
  overrides: Partial<UseGroupSelectionParams> = {}
): UseGroupSelectionParams {
  return {
    tokens: explainRegex(regex, "en").patternTokens,
    highlightMode: "groups",
    regex,
    activeExample: "PAY 100",
    ...overrides,
  };
}

function renderGroupSelection(initial: UseGroupSelectionParams) {
  return renderHook(
    (params: UseGroupSelectionParams) => useGroupSelection(params),
    {
      initialProps: initial,
    }
  );
}

describe("useGroupSelection", () => {
  it("resolves the bracket range of the toggled group from tokens", () => {
    const regex = "^(\\d+) (\\w+)$";
    const { result } = renderGroupSelection(paramsFor(regex));

    act(() => result.current.toggle(2));

    expect(result.current.selectedIndex).toBe(2);
    const { range } = result.current;
    expect(range).not.toBeNull();
    expect(regex.slice(range!.start, range!.end)).toBe("(\\w+)");
  });

  it("collapses the selection on re-toggle and on deselect", () => {
    const { result } = renderGroupSelection(paramsFor("^(\\d+)$"));

    act(() => result.current.toggle(1));
    act(() => result.current.toggle(1));
    expect(result.current.selectedIndex).toBeNull();
    expect(result.current.range).toBeNull();

    act(() => result.current.toggle(1));
    act(() => result.current.deselect());
    expect(result.current.selectedIndex).toBeNull();
  });

  it("resets the selection when the regex changes without an armed replace", () => {
    const { result, rerender } = renderGroupSelection(paramsFor("^(\\d+)$"));
    act(() => result.current.toggle(1));

    rerender(paramsFor("^(\\d+)x$"));

    expect(result.current.selectedIndex).toBeNull();
  });

  // The contract RegexLab relies on for iterative snippet swaps (ADR-0010):
  // armReplace() fires in the insert handler, the insert synchronously flips the
  // regex prop, and both land in one React batch. The armed flag must be applied
  // before the regexChanged effect reads it, so the selection survives and the
  // range re-resolves on the new tokens.
  it("keeps the selection across an armed regex change and re-resolves the range", () => {
    const before = "^(\\d+) (\\w+)$";
    const after = "^(\\d+) ([a-z]+)$";
    const { result, rerender } = renderGroupSelection(paramsFor(before));
    act(() => result.current.toggle(2));

    act(() => {
      result.current.armReplace();
      rerender(paramsFor(after));
    });

    expect(result.current.selectedIndex).toBe(2);
    const { range } = result.current;
    expect(range).not.toBeNull();
    expect(after.slice(range!.start, range!.end)).toBe("([a-z]+)");
  });

  it("survives repeated armed swaps of the same group", () => {
    const versions = ["^(\\d+) (\\w+)$", "^(\\d+) (\\d{4})$", "^(\\d+) (.*)$"];
    const { result, rerender } = renderGroupSelection(paramsFor(versions[0]!));
    act(() => result.current.toggle(2));

    for (const next of versions.slice(1)) {
      act(() => {
        result.current.armReplace();
        rerender(paramsFor(next));
      });
      expect(result.current.selectedIndex).toBe(2);
    }
  });

  // "Group N disappeared" commutes with the armed survival (ADR-0015): an armed
  // insert that drops the group's brackets keeps the index through regexChanged,
  // then the range watch sees no range and softly collapses to a caret.
  it("softly deselects when an armed insert makes the group vanish", () => {
    const { result, rerender } = renderGroupSelection(
      paramsFor("^(\\d+) (\\w+)$")
    );
    act(() => result.current.toggle(2));

    act(() => {
      result.current.armReplace();
      rerender(paramsFor("^(\\d+) \\w+$"));
    });

    expect(result.current.selectedIndex).toBeNull();
    expect(result.current.range).toBeNull();
  });

  it("resets the selection when the active example switches", () => {
    const regex = "^(\\d+)$";
    const { result, rerender } = renderGroupSelection(paramsFor(regex));
    act(() => result.current.toggle(1));

    rerender(paramsFor(regex, { activeExample: "PAY 200" }));

    expect(result.current.selectedIndex).toBeNull();
  });

  it("resets the selection when leaving groups mode", () => {
    const regex = "^(\\d+)$";
    const { result, rerender } = renderGroupSelection(paramsFor(regex));
    act(() => result.current.toggle(1));

    rerender(paramsFor(regex, { highlightMode: "parts" }));

    expect(result.current.selectedIndex).toBeNull();
  });
});
