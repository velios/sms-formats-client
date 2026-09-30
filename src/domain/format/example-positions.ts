import { parseFormatFile } from "./parser";

export type ExamplePositions = Array<number | null>;

export function initialExamplePositions(
  content: string | null
): ExamplePositions {
  return content === null
    ? []
    : parseFormatFile(content).examples.map((_, index) => index + 1);
}

function markerOffsets(content: string): number[] {
  return Array.from(
    content.matchAll(/^[^\S\n]*-----EXAMPLE-----[^\S\n]*$/gm),
    (match) => match.index
  );
}

// Preserve section markers outside the single changed text range. Exact sections
// inside a replacement retain their positions; new sections have no source position.
export function reconcileExamplePositions(
  previous: string,
  next: string,
  positions: ExamplePositions
): ExamplePositions {
  if (previous === next) {
    return [...positions];
  }
  const { start, end } = changedRange(previous, next);
  const oldMarkers = markerOffsets(previous);
  const newMarkers = markerOffsets(next);
  const oldExamples = parseFormatFile(previous).examples;
  const newExamples = parseFormatFile(next).examples;
  const used = new Set<number>();
  const result: ExamplePositions = newMarkers.map(() => null);
  const assigned = new Set<number>();
  for (let index = newMarkers.length - 1; index >= 0; index--) {
    if (oldMarkers.length !== newMarkers.length) {
      continue;
    }
    const offset = newMarkers[index]!;
    const oldOffset =
      offset >= next.length - end
        ? offset + previous.length - next.length
        : offset < start
          ? offset
          : -1;
    const oldIndex = oldMarkers.indexOf(oldOffset);
    if (oldIndex < 0 || used.has(oldIndex)) {
      continue;
    }
    used.add(oldIndex);
    assigned.add(index);
    result[index] = positions[oldIndex] ?? null;
  }
  for (let index = 0; index < newExamples.length; index++) {
    if (assigned.has(index)) {
      continue;
    }
    const oldIndex = oldExamples.findIndex(
      (example, candidate) =>
        !used.has(candidate) && example === newExamples[index]
    );
    if (oldIndex >= 0) {
      used.add(oldIndex);
      assigned.add(index);
      result[index] = positions[oldIndex] ?? null;
    }
  }
  return result;
}

function changedRange(previous: string, next: string) {
  let start = 0;
  while (
    start < previous.length &&
    start < next.length &&
    previous[start] === next[start]
  ) {
    start++;
  }
  let end = 0;
  while (
    end < previous.length - start &&
    end < next.length - start &&
    previous.at(-1 - end) === next.at(-1 - end)
  ) {
    end++;
  }
  return { start, end };
}
