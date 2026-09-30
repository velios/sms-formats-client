export interface GroupSelectionState {
  selectedIndex: number | null;
  armed: boolean;
}

export type GroupSelectionEvent =
  | { type: "toggle"; index: number }
  | { type: "deselect" }
  | { type: "armReplace" }
  | { type: "regexChanged" }
  | { type: "exampleChanged" }
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
