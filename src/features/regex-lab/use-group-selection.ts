import { useCallback, useEffect, useMemo, useReducer } from "react";
import type { RegexPatternToken } from "@/domain/format";
import { resolveCaptureGroupRange } from "@/domain/format";
import {
  initialGroupSelectionState,
  reduceGroupSelection,
} from "./group-selection";

export interface UseGroupSelectionParams {
  tokens: RegexPatternToken[];
  highlightMode: string;
  regex: string;
  activeExample: string;
}

export interface UseGroupSelectionResult {
  selectedIndex: number | null;
  range: { start: number; end: number } | null;
  toggle: (groupIndex: number) => void;
  deselect: () => void;
  armReplace: () => void;
}

export function useGroupSelection(
  params: UseGroupSelectionParams
): UseGroupSelectionResult {
  const { tokens, highlightMode, regex, activeExample } = params;
  const [state, dispatch] = useReducer(
    reduceGroupSelection,
    initialGroupSelectionState
  );
  const { selectedIndex } = state;

  const range = useMemo(
    () =>
      selectedIndex == null
        ? null
        : resolveCaptureGroupRange(tokens, selectedIndex),
    [selectedIndex, tokens]
  );

  useEffect(() => {
    dispatch({ type: "regexChanged" });
  }, [regex]);

  useEffect(() => {
    dispatch({ type: "exampleChanged" });
  }, [activeExample]);

  useEffect(() => {
    if (highlightMode !== "groups") {
      dispatch({ type: "modeLeft" });
    }
  }, [highlightMode]);

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
