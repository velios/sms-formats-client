import {
  type ExamplePositions,
  initialExamplePositions,
  parseFormatFile,
  reconcileExamplePositions,
} from "@/domain/format";

export type ChangeMarker = "local" | "source" | null;

export interface FormatChangeMarkers {
  regex: ChangeMarker;
  columns: ChangeMarker;
  examples: ChangeMarker[];
}

export function getFormatChangeMarkers(
  content: string,
  headContent: string | null,
  sourceContent: string | null | undefined,
  positions: ExamplePositions
): FormatChangeMarkers {
  const current = parseFormatFile(content);
  const head = headContent === null ? null : parseFormatFile(headContent);
  const source =
    typeof sourceContent === "string" ? parseFormatFile(sourceContent) : null;
  const currentPositions =
    content === headContent ? initialExamplePositions(headContent) : positions;
  const sourcePositions =
    sourceContent === undefined
      ? []
      : reconcileExamplePositions(
          sourceContent ?? "",
          headContent ?? "",
          initialExamplePositions(sourceContent)
        );
  const marker = (local: boolean, published: boolean): ChangeMarker =>
    local ? "local" : published ? "source" : null;
  return {
    regex: marker(
      !head || current.regex !== head.regex,
      sourceContent !== undefined && (!source || head?.regex !== source.regex)
    ),
    columns: marker(
      !head || JSON.stringify(current.columns) !== JSON.stringify(head.columns),
      sourceContent !== undefined &&
        (!source ||
          JSON.stringify(head?.columns) !== JSON.stringify(source.columns))
    ),
    examples: current.examples.map((text, index) => {
      const headIndex = (currentPositions[index] ?? 0) - 1;
      const sourceIndex = (sourcePositions[headIndex] ?? 0) - 1;
      return marker(
        !head || text !== head.examples[headIndex],
        sourceContent !== undefined &&
          (!source ||
            head?.examples[headIndex] !== source.examples[sourceIndex])
      );
    }),
  };
}
