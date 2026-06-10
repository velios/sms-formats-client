import { describe, expect, it } from "vitest";
import {
  type GroupSelectionState,
  initialGroupSelectionState,
  reduceGroupSelection,
} from "./group-selection";

// Apply a sequence of events from the initial state — the reducer is a pure
// state machine, so an invariant is just a fold over events (ADR-0015).
function reduce(
  state: GroupSelectionState,
  ...events: Parameters<typeof reduceGroupSelection>[1][]
): GroupSelectionState {
  return events.reduce(reduceGroupSelection, state);
}

const SELECTED_2: GroupSelectionState = { selectedIndex: 2, armed: false };

describe("reduceGroupSelection / toggle", () => {
  it("selects a group from nothing", () => {
    expect(
      reduce(initialGroupSelectionState, { type: "toggle", index: 3 })
    ).toEqual({ selectedIndex: 3, armed: false });
  });

  it("collapses on a repeated toggle of the same group", () => {
    expect(reduce(SELECTED_2, { type: "toggle", index: 2 })).toEqual({
      selectedIndex: null,
      armed: false,
    });
  });

  it("switches to another group on a different toggle", () => {
    expect(reduce(SELECTED_2, { type: "toggle", index: 5 })).toEqual({
      selectedIndex: 5,
      armed: false,
    });
  });
});

describe("reduceGroupSelection / resets", () => {
  it("deselect drops the index", () => {
    expect(reduce(SELECTED_2, { type: "deselect" })).toEqual({
      selectedIndex: null,
      armed: false,
    });
  });

  it("a plain regex change (typing / external sync) clears the selection", () => {
    expect(reduce(SELECTED_2, { type: "regexChanged" })).toEqual({
      selectedIndex: null,
      armed: false,
    });
  });

  it("an example change always clears the selection", () => {
    expect(reduce(SELECTED_2, { type: "exampleChanged" })).toEqual({
      selectedIndex: null,
      armed: false,
    });
  });

  it("leaving groups mode clears the selection", () => {
    expect(reduce(SELECTED_2, { type: "modeLeft" })).toEqual({
      selectedIndex: null,
      armed: false,
    });
  });
});

describe("reduceGroupSelection / selection survives the snippet insert", () => {
  // The central ADR-0010 invariant, now a pure transition: arming a replace
  // before the insert lets the very next regex change keep the index alive so
  // the operator can swap snippets of one entity iteratively (ADR-0015).
  it("keeps the index through the regex change that the insert triggers", () => {
    const after = reduce(
      SELECTED_2,
      { type: "armReplace" },
      { type: "regexChanged" }
    );
    expect(after).toEqual({ selectedIndex: 2, armed: false });
  });

  it("disarms after one regex change — a second change resets as usual", () => {
    const after = reduce(
      SELECTED_2,
      { type: "armReplace" },
      { type: "regexChanged" },
      { type: "regexChanged" }
    );
    expect(after).toEqual({ selectedIndex: null, armed: false });
  });

  it("arming alone does not change the selected index", () => {
    expect(reduce(SELECTED_2, { type: "armReplace" })).toEqual({
      selectedIndex: 2,
      armed: true,
    });
  });
});
