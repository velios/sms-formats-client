import type { ParsedFormat, ValidationIssue } from "../types";

const COLUMNS_MARKER = "-----COLUMNS-----";
const EXAMPLE_MARKER = "-----EXAMPLE-----";

function findExampleIndices(lines: string[]): number[] {
  const indices: number[] = [];
  lines.forEach((line, index) => {
    if (line.trim() === EXAMPLE_MARKER) {
      indices.push(index);
    }
  });
  return indices;
}

function collectRegex(
  lines: string[],
  columnsIdx: number,
  filePath: string,
  issues: ValidationIssue[]
): string {
  if (columnsIdx === -1) {
    issues.push({
      code: "MISSING_COLUMNS",
      level: "error",
      filePath,
    });
    return lines[0] ?? "";
  }

  const regexLines = lines.slice(0, columnsIdx);
  // Remove the format separator, not whitespace typed into the pattern.
  if (regexLines.at(-1) === "") {
    regexLines.pop();
  }
  return regexLines.join("\n");
}

function collectColumns(lines: string[], columnsIdx: number): string[] {
  if (columnsIdx === -1) {
    return [];
  }

  const colLine = lines[columnsIdx + 1]?.trim() ?? "";
  return colLine
    .split(";")
    .map((column) => column.trim())
    .filter(Boolean);
}

function collectExamplesBetween(
  lines: string[],
  start: number,
  end: number
): string {
  const exLines = lines.slice(start, end);
  // One blank line separates sections; the final newline terminates the file.
  if (exLines.at(-1) === "") {
    exLines.pop();
  }
  return exLines.join("\n");
}

function collectExamples(
  lines: string[],
  exampleIndices: number[],
  filePath: string,
  issues: ValidationIssue[]
): string[] {
  if (exampleIndices.length === 0) {
    issues.push({
      code: "MISSING_EXAMPLE",
      level: "error",
      filePath,
    });
    return [];
  }

  const examples: string[] = [];
  for (let index = 0; index < exampleIndices.length; index++) {
    const start = (exampleIndices[index] ?? -1) + 1;
    const nextStart = exampleIndices[index + 1] ?? lines.length;
    const exampleText = collectExamplesBetween(lines, start, nextStart);
    examples.push(exampleText);
  }
  return examples;
}

export function parseFormatFile(raw: string, filePath = ""): ParsedFormat {
  const issues: ValidationIssue[] = [];
  const lines = raw.split("\n");
  const columnsIdx = lines.findIndex((l) => l.trim() === COLUMNS_MARKER);
  const exampleIndices = findExampleIndices(lines);
  const regex = collectRegex(lines, columnsIdx, filePath, issues);

  if (!regex.trim()) {
    issues.push({
      code: "MISSING_REGEX",
      level: "error",
      filePath,
    });
  }

  const columns = collectColumns(lines, columnsIdx);
  const examples = collectExamples(lines, exampleIndices, filePath, issues);

  return { regex, columns, examples, raw, parseIssues: issues };
}

export function serializeFormat(
  regex: string,
  columns: string[],
  examples: string[]
): string {
  const parts: string[] = [];
  parts.push(regex);
  parts.push("");
  parts.push(COLUMNS_MARKER);
  parts.push(columns.join(";"));

  for (const ex of examples) {
    parts.push("");
    parts.push(EXAMPLE_MARKER);
    parts.push(ex);
  }

  return `${parts.join("\n")}\n`;
}

export const FORMAT_TEMPLATE = serializeFormat(
  "^(.*)$",
  ["comment"],
  ["Sample SMS text"]
);
