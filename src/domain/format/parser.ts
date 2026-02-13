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
      message: "Missing -----COLUMNS----- marker",
    });
    return lines[0]?.trim() ?? "";
  }

  const regexLines: string[] = [];
  for (let i = 0; i < columnsIdx; i++) {
    const line = lines[i] ?? "";
    if (line.trim() === "") {
      break;
    }
    regexLines.push(line);
  }
  return regexLines.join("\n").trim();
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

function trimBlankLines(lines: string[]): string[] {
  const trimmed = [...lines];
  while (trimmed.length > 0 && trimmed.at(-1)?.trim() === "") {
    trimmed.pop();
  }
  while (trimmed.length > 0 && trimmed[0]?.trim() === "") {
    trimmed.shift();
  }
  return trimmed;
}

function collectExamplesBetween(
  lines: string[],
  start: number,
  end: number
): string {
  const exLines: string[] = [];
  for (let i = start; i < end; i++) {
    const line = lines[i] ?? "";
    const normalized = line.trim();
    if (normalized === COLUMNS_MARKER || normalized === EXAMPLE_MARKER) {
      break;
    }
    exLines.push(line);
  }
  return trimBlankLines(exLines).join("\n");
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
      message: "No -----EXAMPLE----- section found",
    });
    return [];
  }

  const examples: string[] = [];
  for (let index = 0; index < exampleIndices.length; index++) {
    const start = (exampleIndices[index] ?? -1) + 1;
    const nextStart = exampleIndices[index + 1] ?? lines.length;
    const exampleText = collectExamplesBetween(lines, start, nextStart);
    if (exampleText) {
      examples.push(exampleText);
    }
  }
  return examples;
}

/**
 * Parse a raw format file text into structured model.
 */
export function parseFormatFile(raw: string, filePath = ""): ParsedFormat {
  const issues: ValidationIssue[] = [];
  const lines = raw.split("\n");
  const columnsIdx = lines.findIndex((l) => l.trim() === COLUMNS_MARKER);
  const exampleIndices = findExampleIndices(lines);
  const regex = collectRegex(lines, columnsIdx, filePath, issues);

  if (!regex) {
    issues.push({
      code: "MISSING_REGEX",
      level: "error",
      filePath,
      message: "Missing regex (first line)",
    });
  }

  const columns = collectColumns(lines, columnsIdx);
  const examples = collectExamples(lines, exampleIndices, filePath, issues);

  return { regex, columns, examples, raw, parseIssues: issues };
}

/**
 * Serialize a structured format into canonical raw text.
 */
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

/**
 * Default template for new format files.
 */
export const FORMAT_TEMPLATE = serializeFormat(
  "^(.*)$",
  ["comment"],
  ["Sample SMS text"]
);
