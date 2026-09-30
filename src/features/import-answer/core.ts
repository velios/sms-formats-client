export type AnswerChange =
  | { kind: "write"; path: string; content: string; line: number }
  | { kind: "delete"; path: string; reason: string; line: number };

export type AnswerProblemKind =
  | "unclosed"
  | "orphan-close"
  | "malformed-open"
  | "empty-path"
  | "duplicate-path"
  | "conflicting-path"
  | "unsupported-rename";

export interface AnswerProblem {
  kind: AnswerProblemKind;
  line: number;
  excerpt: string;
}

// A lost block may contain moved examples.
const BLOCK_LOST: ReadonlySet<AnswerProblemKind> = new Set([
  "unclosed",
  "orphan-close",
  "malformed-open",
  "empty-path",
]);

export type ParsedAnswer =
  | {
      status: "broken";
      problems: AnswerProblem[];
      prose: string;
    }
  | {
      status: "parsed";
      changes: AnswerChange[];
      prose: string;
      problems: AnswerProblem[];
    };

// Whole-line tags keep regex bodies unescaped.
const OPEN_FILE = /^<file\s+path="(.*)">\s*$/;
const OPEN_DELETE = /^<delete\s+path="(.*)">\s*$/;
const OPEN_RENAME = /^<rename\s+from="(.*)"\s+to="(.*)">\s*$/;
const CLOSE = /^<\/(file|delete|rename)>\s*$/;
const LOOKS_LIKE_OPEN = /^<(file|delete|rename)\b/;

type OpenTag =
  | { tag: "file" | "delete"; path: string }
  | { tag: "rename"; excerpt: string };

function matchOpen(line: string): OpenTag | null {
  const file = OPEN_FILE.exec(line);
  if (file) {
    return { tag: "file", path: file[1] ?? "" };
  }
  const removal = OPEN_DELETE.exec(line);
  if (removal) {
    return { tag: "delete", path: removal[1] ?? "" };
  }
  const rename = OPEN_RENAME.exec(line);
  if (rename) {
    return {
      tag: "rename",
      excerpt: `${rename[1] ?? ""} → ${rename[2] ?? ""}`,
    };
  }
  return null;
}

function looseLineProblem(line: string): AnswerProblemKind | null {
  if (CLOSE.test(line)) {
    return "orphan-close";
  }
  return LOOKS_LIKE_OPEN.test(line) ? "malformed-open" : null;
}

export function parseAnswer(text: string): ParsedAnswer {
  const lines = text.split("\n");
  const changes: AnswerChange[] = [];
  const problems: AnswerProblem[] = [];
  const proseLines: string[] = [];

  let index = 0;
  while (index < lines.length) {
    const line = lines[index] ?? "";
    const lineNumber = index + 1;
    const open = matchOpen(line);

    if (open === null) {
      const kind = looseLineProblem(line);
      if (kind === null) {
        proseLines.push(line);
      } else {
        problems.push({ kind, line: lineNumber, excerpt: line });
      }
      index += 1;
      continue;
    }

    const body = readBody(lines, index + 1, open.tag);
    if (body === null) {
      problems.push({ kind: "unclosed", line: lineNumber, excerpt: line });
      break;
    }

    if (open.tag === "rename") {
      problems.push({
        kind: "unsupported-rename",
        line: lineNumber,
        excerpt: open.excerpt,
      });
    } else if (open.tag === "file") {
      pushChange(changes, problems, {
        kind: "write",
        path: open.path,
        content: body.text,
        line: lineNumber,
      });
    } else {
      pushChange(changes, problems, {
        kind: "delete",
        path: open.path,
        reason: body.text.trim(),
        line: lineNumber,
      });
    }

    index = body.nextIndex;
  }

  reportPathConflicts(changes, problems);

  const prose = proseLines.join("\n").trim();
  if (problems.some((problem) => BLOCK_LOST.has(problem.kind))) {
    return { status: "broken", problems, prose };
  }
  return { status: "parsed", changes, prose, problems };
}

function readBody(
  lines: string[],
  start: number,
  tag: string
): { text: string; nextIndex: number } | null {
  for (let index = start; index < lines.length; index += 1) {
    const close = CLOSE.exec(lines[index] ?? "");
    if (close && close[1] === tag) {
      return {
        text: lines.slice(start, index).join("\n"),
        nextIndex: index + 1,
      };
    }
  }
  return null;
}

function pushChange(
  changes: AnswerChange[],
  problems: AnswerProblem[],
  change: AnswerChange
): void {
  if (change.path.trim() === "") {
    problems.push({
      kind: "empty-path",
      line: change.line,
      excerpt: `<${change.kind === "write" ? "file" : "delete"} path="${change.path}">`,
    });
    return;
  }
  changes.push(change);
}

function reportPathConflicts(
  changes: AnswerChange[],
  problems: AnswerProblem[]
): void {
  const seen = new Map<string, AnswerChange>();
  for (const change of changes) {
    const previous = seen.get(change.path);
    if (previous) {
      problems.push({
        kind:
          previous.kind === change.kind ? "duplicate-path" : "conflicting-path",
        line: change.line,
        excerpt: `${change.path} (${previous.line}, ${change.line})`,
      });
    }
    seen.set(change.path, change);
  }
}

export type PathViolation =
  | "other-bank"
  | "bank-root"
  | "outside"
  | "invalid-path";

const FORMAT_FILE_NAME = /^[\p{L}\p{N} _]+\.txt$/u;

export function isImportablePath(path: string, bankPath: string): boolean {
  if (path === `${bankPath}/senders.txt`) {
    return true;
  }
  const name = relativeTo(path, `${bankPath}/formats/`);
  return name !== null && FORMAT_FILE_NAME.test(name);
}

export function classifyPathViolation(
  path: string,
  bankPath: string
): PathViolation {
  if (path.split("/").includes("..")) {
    return "outside";
  }
  const prefix = `${bankPath}/`;
  if (!path.startsWith(prefix)) {
    return sharesParent(path, bankPath) ? "other-bank" : "outside";
  }
  return path.slice(prefix.length).includes("/") ? "invalid-path" : "bank-root";
}

function relativeTo(path: string, prefix: string): string | null {
  if (!path.startsWith(prefix)) {
    return null;
  }
  const tail = path.slice(prefix.length);
  return tail === "" || tail.includes("/") ? null : tail;
}

function sharesParent(path: string, bankPath: string): boolean {
  const parent = bankPath.slice(0, bankPath.lastIndexOf("/") + 1);
  return path.startsWith(parent) && path.length > parent.length;
}
