// Pure state machine behind the "Group selection" editor tool (ADR-0015).
// It tames what used to be a fragile `insertionIsReplacingGroupRef` flag plus
// four reset effects scattered across RegexLab: the race detail "the next regex
// change is our own insert, do not reset" becomes the `armed` field, and every
// reset rule becomes a transition testable as data — without React or
// CodeMirror. Semantics are frozen by ADR-0010; this is form, not behavior.

export interface GroupSelectionState {
  // The capture group (1-based) currently selected, or null for none.
  selectedIndex: number | null;
  // One-shot: armed right before a snippet insert into the selected group so
  // the regex change that insert triggers keeps the selection alive.
  armed: boolean;
}

export type GroupSelectionEvent =
  // Click in the field / table icon resolved to group N; re-toggling the same
  // group collapses the selection.
  | { type: "toggle"; index: number }
  // Click off a group, or the explanation list activating a single token.
  | { type: "deselect" }
  // Arm the next regex change as an iterative replace (insert into the group).
  | { type: "armReplace" }
  // The regex prop changed: typing / external file sync / format switch reset,
  // unless armed (our own insert), in which case the index survives.
  | { type: "regexChanged" }
  // The active example switched — always resets (a separate trigger).
  | { type: "exampleChanged" }
  // Left the "groups" highlight mode — the selection is a groups-mode affordance.
  | { type: "modeLeft" };

export const initialGroupSelectionState: GroupSelectionState = {
  selectedIndex: null,
  armed: false,
};

export function reduceGroupSelection(
  state: GroupSelectionState,
  event: GroupSelectionEvent
): GroupSelectionState {
  switch (event.type) {
    case "toggle":
      return {
        selectedIndex: state.selectedIndex === event.index ? null : event.index,
        armed: false,
      };
    case "deselect":
      return { selectedIndex: null, armed: false };
    case "armReplace":
      return { ...state, armed: true };
    case "regexChanged":
      return state.armed
        ? { selectedIndex: state.selectedIndex, armed: false }
        : { selectedIndex: null, armed: false };
    case "exampleChanged":
      return { selectedIndex: null, armed: false };
    case "modeLeft":
      return { selectedIndex: null, armed: false };
    default:
      return state;
  }
}
