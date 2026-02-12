import { extractTemplatePlaceholders } from "@/domain/format";

export const SMS_GAME_ISSUE_TITLE_MARKER = "from sms-formats-client";
const SMS_GAME_BODY_HEADER = "# SMS Markup Game Export";

export interface ImportedIssueFormat {
  sourceSms: string;
  template: string;
  placeholders: string[];
  similarExamples: string[];
}

export interface ImportedIssuePayload {
  bankName: string;
  senders: string;
  formats: ImportedIssueFormat[];
}

export interface IssueListItem {
  title: string;
  body: string | null | undefined;
}

export function parseIssueIdentifier(input: string): number | null {
  const trimmed = input.trim();
  if (!trimmed) {
    return null;
  }

  if (/^\d+$/.test(trimmed)) {
    const value = Number(trimmed);
    return Number.isSafeInteger(value) ? value : null;
  }

  const match = trimmed.match(/\/issues\/(\d+)(?:[/?#]|$)/);
  if (!match?.[1]) {
    return null;
  }

  const value = Number(match[1]);
  return Number.isSafeInteger(value) ? value : null;
}

export function parseSmsGameIssueBody(issueBody: string): ImportedIssuePayload {
  const bankMatch = issueBody.match(/^- Bank:\s*`([^`]+)`/m);
  const bankName = bankMatch?.[1]?.trim();
  if (!bankName) {
    throw new Error(
      "Issue body does not contain bank name from SMS markup export"
    );
  }
  const senders = extractCodeBlock(issueBody, "Senders");

  const starts = Array.from(issueBody.matchAll(/^##\s+Format\s+\d+\s*$/gm))
    .map((match) => match.index)
    .filter((value): value is number => typeof value === "number");

  if (starts.length === 0) {
    throw new Error("Issue body does not contain any format sections");
  }

  const formats: ImportedIssueFormat[] = [];

  for (let i = 0; i < starts.length; i++) {
    const start = starts[i]!;
    const end = starts[i + 1] ?? issueBody.length;
    const section = issueBody.slice(start, end);

    const template = extractCodeBlock(section, "Template");
    if (!template.trim()) {
      continue;
    }

    const sourceSms = extractCodeBlock(section, "Source SMS");
    const placeholdersBlock = extractCodeBlock(section, "Placeholders");
    const similarBlock = extractCodeBlock(section, "Similar SMS");

    const placeholders = placeholdersBlock
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line && line !== "(none)");

    const similarExamples = splitExamples(similarBlock);
    const fallbackExample = sourceSms.trim();

    formats.push({
      sourceSms,
      template,
      placeholders:
        placeholders.length > 0
          ? placeholders
          : extractTemplatePlaceholders(template),
      similarExamples:
        similarExamples.length > 0
          ? similarExamples
          : fallbackExample
            ? [fallbackExample]
            : [],
    });
  }

  if (formats.length === 0) {
    throw new Error("Issue body contains no importable templates");
  }

  return { bankName, senders, formats };
}

export function ensureSmsGameIssueTitleMarker(title: string): string {
  const trimmed = title.trim();
  if (!trimmed) {
    return `[${SMS_GAME_ISSUE_TITLE_MARKER}]`;
  }
  if (isSmsGameIssueTitle(trimmed)) {
    return trimmed;
  }
  return `${trimmed} [${SMS_GAME_ISSUE_TITLE_MARKER}]`;
}

export function isSmsGameIssueTitle(title: string): boolean {
  return title
    .toLowerCase()
    .includes(SMS_GAME_ISSUE_TITLE_MARKER.toLowerCase());
}

export function isSmsGameIssue(item: IssueListItem): boolean {
  if (isSmsGameIssueTitle(item.title)) {
    return true;
  }
  const body = item.body ?? "";
  return body.includes(SMS_GAME_BODY_HEADER);
}

function splitExamples(value: string): string[] {
  return value
    .split(/\n{2,}/)
    .map((item) => item.trim())
    .filter((item) => item && item !== "(none)");
}

function extractCodeBlock(section: string, heading: string): string {
  const headingPattern = escapeRegex(heading);
  const pattern = new RegExp(
    `###\\s+${headingPattern}\\s*\\n\`\`\`(?:text)?\\n([\\s\\S]*?)\\n\`\`\``,
    "i"
  );
  const match = section.match(pattern);
  return denormalizeCodeBlock(match?.[1] ?? "");
}

function denormalizeCodeBlock(value: string): string {
  return value.replace(/``` /g, "```").trim();
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
