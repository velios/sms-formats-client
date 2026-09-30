import { parseFormatFile } from "./parser";

export type ExamplePositions = Array<number | null>;

export interface RawEditRange {
  start: number;
  end: number;
}

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

function unchangedMarkerOffset(
  offset: number,
  start: number,
  suffixStart: number,
  lengthDifference: number,
  sameCount: boolean
): number {
  if (offset >= suffixStart) {
    return offset + lengthDifference;
  }
  return sameCount && offset < start ? offset : -1;
}

function alignChangedSections(
  oldCount: number,
  newCount: number,
  matches: Map<number, number>,
  positions: ExamplePositions
): ExamplePositions {
  const result = Array.from(
    { length: newCount },
    (_, index) => positions[matches.get(index) ?? -1] ?? null
  );
  const used = new Set(matches.values());
  let start = 0;
  for (let end = 0; end <= newCount; end++) {
    if (end < newCount && !matches.has(end)) {
      continue;
    }
    const oldStart = (matches.get(start - 1) ?? -1) + 1;
    const oldEnd = matches.get(end) ?? oldCount;
    const remaining = Array.from(
      { length: Math.max(0, oldEnd - oldStart) },
      (_, index) => oldStart + index
    ).filter((index) => !used.has(index));
    // Align edits within their retained neighbours; surplus insertions stay local.
    const shift = Math.max(0, end - start - remaining.length);
    for (let index = start; index < end; index++) {
      result[index] = positions[remaining[index - start - shift] ?? -1] ?? null;
    }
    start = end + 1;
  }
  return result;
}

// Known edit ranges preserve unchanged section boundaries exactly. Whole-document
// replacements and operations without a range fall back to content alignment.
export function reconcileExamplePositions(
  previous: string,
  next: string,
  positions: ExamplePositions,
  edit?: RawEditRange
): ExamplePositions {
  if (previous === next) {
    return [...positions];
  }
  const nextEnd = edit ? edit.end + next.length - previous.length : -1;
  if (
    edit &&
    !(edit.start === 0 && edit.end === previous.length) &&
    edit.start >= 0 &&
    edit.end >= edit.start &&
    edit.end <= previous.length &&
    nextEnd >= edit.start &&
    previous.slice(0, edit.start) === next.slice(0, edit.start) &&
    previous.slice(edit.end) === next.slice(nextEnd)
  ) {
    const previousMarkers = markerOffsets(previous);
    return markerOffsets(next).map((offset) => {
      const oldOffset =
        offset < edit.start
          ? offset
          : offset >= nextEnd
            ? offset + previous.length - next.length
            : -1;
      return positions[previousMarkers.indexOf(oldOffset)] ?? null;
    });
  }
  const { start, end } = changedRange(previous, next);
  const oldMarkers = markerOffsets(previous);
  const newMarkers = markerOffsets(next);
  const oldExamples = parseFormatFile(previous).examples;
  const newExamples = parseFormatFile(next).examples;
  const used = new Set<number>();
  const assigned = new Map<number, number>();
  for (let index = newMarkers.length - 1; index >= 0; index--) {
    const offset = newMarkers[index]!;
    const oldOffset = unchangedMarkerOffset(
      offset,
      start,
      next.length - end,
      previous.length - next.length,
      oldMarkers.length === newMarkers.length
    );
    const oldIndex = oldMarkers.indexOf(oldOffset);
    if (oldIndex < 0 || used.has(oldIndex)) {
      continue;
    }
    used.add(oldIndex);
    assigned.set(index, oldIndex);
  }
  for (let index = newExamples.length - 1; index >= 0; index--) {
    if (assigned.has(index)) {
      continue;
    }
    const oldIndex = oldExamples.findLastIndex(
      (example, candidate) =>
        !used.has(candidate) && example === newExamples[index]
    );
    if (oldIndex >= 0) {
      used.add(oldIndex);
      assigned.set(index, oldIndex);
    }
  }
  return alignChangedSections(
    oldExamples.length,
    newExamples.length,
    assigned,
    positions
  );
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
