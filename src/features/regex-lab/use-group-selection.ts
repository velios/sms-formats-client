import { useCallback, useEffect, useMemo, useReducer } from "react";
import type { RegexPatternToken } from "@/domain/format";
import { resolveCaptureGroupRange } from "@/domain/format";
import {
  initialGroupSelectionState,
  reduceGroupSelection,
} from "./group-selection";

export interface UseGroupSelectionParams {
  // Pattern tokens of the current regex; the hook resolves the selected group's
  // bracket range from them.
  tokens: RegexPatternToken[];
  // Group selection is a "groups" mode affordance — leaving the mode resets it.
  highlightMode: string;
  // The regex string; a change resets the selection unless a replace is armed.
  regex: string;
  // The active example; switching it always resets the selection.
  activeExample: string;
}

export interface UseGroupSelectionResult {
  // The selected capture group (1-based), or null. RegexLab mixes this with its
  // token fallback into the synchronized highlight (ADR-0015).
  selectedIndex: number | null;
  // The selected group's bracket span, for the real CM selection and the
  // snippet insert; null when no group is selected or it has vanished.
  range: { start: number; end: number } | null;
  // Group N resolved by the caller (field click via the token map, or table
  // icon); re-toggling the same group collapses the selection.
  toggle: (groupIndex: number) => void;
  deselect: () => void;
  // Arm the next regex change as an iterative replace, called right before the
  // snippet insert into the selected group.
  armReplace: () => void;
}

// Thin hook over the pure group-selection reducer (ADR-0015). The reducer owns
// the reset rules and the armed flag; the hook wires them to React effects and
// resolves the bracket range from tokens. Mode gating and the token→N resolve
// stay with the caller (RegexLab).
export function useGroupSelection(
  params: UseGroupSelectionParams
): UseGroupSelectionResult {
  const { tokens, highlightMode, regex, activeExample } = params;
  const [state, dispatch] = useReducer(
    reduceGroupSelection,
    initialGroupSelectionState
  );
  const { selectedIndex } = state;

  // Bracket span of the selected group on the current tokens (re-resolved after
  // every insert so the selection follows the group, ADR-0010).
  const range = useMemo(
    () =>
      selectedIndex == null
        ? null
        : resolveCaptureGroupRange(tokens, selectedIndex),
    [selectedIndex, tokens]
  );

  // A regex change resets the selection unless a replace was armed (our own
  // snippet insert), which keeps it for iterative swaps.
  useEffect(() => {
    dispatch({ type: "regexChanged" });
  }, [regex]);

  // Switching the active example always drops the selection.
  useEffect(() => {
    dispatch({ type: "exampleChanged" });
  }, [activeExample]);

  // Group selection is a groups-mode affordance; drop it when leaving the mode.
  useEffect(() => {
    if (highlightMode !== "groups") {
      dispatch({ type: "modeLeft" });
    }
  }, [highlightMode]);

  // "Group N disappeared": the index is still live but resolves to no range
  // (snippet without brackets, group count fell below N) — softly collapse to a
  // caret with a plain deselect. The reducer stays token-agnostic (ADR-0015).
  useEffect(() => {
    if (selectedIndex != null && range == null) {
      dispatch({ type: "deselect" });
    }
  }, [selectedIndex, range]);

  const toggle = useCallback((groupIndex: number) => {
    dispatch({ type: "toggle", index: groupIndex });
  }, []);

  const deselect = useCallback(() => {
    dispatch({ type: "deselect" });
  }, []);

  const armReplace = useCallback(() => {
    dispatch({ type: "armReplace" });
  }, []);

  return { selectedIndex, range, toggle, deselect, armReplace };
}
