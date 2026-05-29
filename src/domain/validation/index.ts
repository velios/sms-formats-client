import { countCaptureGroups, parseFormatFile, smsesByRegex } from "../format";
import type { BankInfo, ParsedFormat, ValidationIssue } from "../types";
import { ALLOWED_COLUMN_NAMES } from "../types";

/**
 * Validate a single parsed format file.
 */
export function validateFormat(
  parsed: ParsedFormat,
  filePath: string
): ValidationIssue[] {
  const issues: ValidationIssue[] = [...parsed.parseIssues];

  // Check regex validity and that examples match it
  if (parsed.regex) {
    const recognition = smsesByRegex(parsed.examples, parsed.regex);
    if (recognition.error) {
      issues.push({
        code: "INVALID_REGEX",
        level: "error",
        filePath,
        message: "Invalid regular expression syntax",
      });
    } else {
      recognition.matched.forEach((isMatch, i) => {
        if (!isMatch) {
          issues.push({
            code: "EXAMPLE_NO_MATCH",
            level: "error",
            filePath,
            message: `Example ${i + 1} does not match the format regex`,
          });
        }
      });
    }
  }

  // Group count vs columns count
  if (parsed.regex && parsed.columns.length > 0) {
    const groupCount = countCaptureGroups(parsed.regex);
    if (groupCount !== null && groupCount !== parsed.columns.length) {
      issues.push({
        code: "GROUP_COUNT_MISMATCH",
        level: "error",
        filePath,
        message: `Capture group count (${groupCount}) ≠ columns count (${parsed.columns.length})`,
      });
    }
  }

  // Column name validation
  for (const col of parsed.columns) {
    const baseName = col.split("#")[0]!;
    if (!ALLOWED_COLUMN_NAMES.has(baseName)) {
      issues.push({
        code: "INVALID_COLUMN",
        level: "error",
        filePath,
        message: `Invalid column name: ${col}`,
      });
    }
  }

  return issues;
}

function buildCollisionIssuesForPair(
  source: { filePath: string; parsed: ParsedFormat },
  target: { filePath: string; parsed: ParsedFormat }
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const targetName = target.filePath.split("/").pop() ?? target.filePath;

  const recognition = smsesByRegex(source.parsed.examples, target.parsed.regex);
  if (recognition.error) {
    return issues;
  }

  recognition.matched.forEach((isMatch, i) => {
    if (!isMatch) {
      return;
    }
    issues.push({
      code: "EXAMPLE_COLLISION",
      level: "error",
      filePath: source.filePath,
      message: `Example ${i + 1} matches regex of ${targetName}`,
    });
  });

  return issues;
}

/**
 * Cross-format collision: check if an example from one format matches another format's regex.
 */
export function checkCrossFormatCollisions(
  formats: { filePath: string; parsed: ParsedFormat }[]
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  for (const source of formats) {
    if (!source.parsed.regex) {
      continue;
    }

    for (const target of formats) {
      if (target.filePath === source.filePath) {
        continue;
      }
      if (!target.parsed.regex) {
        continue;
      }

      issues.push(...buildCollisionIssuesForPair(source, target));
    }
  }

  return issues;
}

/**
 * Bank-level validation: check senders.txt exists
 */
export function validateBankLevel(
  bank: BankInfo,
  formatContents: Map<string, string>
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  if (!bank.hasSenders) {
    issues.push({
      code: "MISSING_SENDERS",
      level: "error",
      filePath: `${bank.folderPath}/senders.txt`,
      message: "Missing senders.txt file",
    });
  }

  // Parse all formats and validate individually
  const parsedFormats: { filePath: string; parsed: ParsedFormat }[] = [];
  for (const [path, content] of formatContents) {
    const parsed = parseFormatFile(content, path);
    parsedFormats.push({ filePath: path, parsed });
    issues.push(...validateFormat(parsed, path));
  }

  // Cross-format collision checks
  issues.push(...checkCrossFormatCollisions(parsedFormats));

  return issues;
}

export type { ValidationIssue };
