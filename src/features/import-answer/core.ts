// Pure core of the answer import: an agent answer in, a verdict out. No
// network, no stores, no localStorage, no React — the module is imported and
// tested in isolation (ADR-0017).

export type AnswerChange =
  | { kind: "write"; path: string; content: string; line: number }
  | { kind: "delete"; path: string; reason: string; line: number };

export type AnswerProblemKind =
  /** A block was opened but never closed before the answer ended. */
  | "unclosed"
  /** A closing line with nothing open — a cut-off start or capture junk. */
  | "orphan-close"
  /** The line looks like an opening tag, but its attributes did not parse. */
  | "malformed-open"
  /** Empty `path` — there is a block, but nowhere to put it. */
  | "empty-path"
  /** The same path showed up in two blocks. */
  | "duplicate-path"
  /** The same path is both written and deleted. */
  | "conflicting-path"
  /**
   * The package legend promises `<rename>`, but we answer it with a refusal:
   * agents consolidate with a `<file>` + `<delete>` pair instead (0 of 4 in the
   * corpus), and real support costs its own row kind plus rework of
   * `renameDraft`. Recognizing it is not optional — otherwise the block would
   * leak into the prose and the change would be lost silently.
   */
  | "unsupported-rename";

export interface AnswerProblem {
  kind: AnswerProblemKind;
  /** 1-based line in the answer, so the human can find the spot by eye. */
  line: number;
  /** The offending place itself, for showing to the human. */
  excerpt: string;
}

/**
 * Problems meaning "a block did not make it": what exactly was lost is
 * unknown. Importing the rest is not allowed — an agent answer is one coherent
 * proposal, and half of it can delete formats without writing the ones the
 * examples were moved into.
 */
const BLOCK_LOST: ReadonlySet<AnswerProblemKind> = new Set([
  "unclosed",
  "orphan-close",
  "malformed-open",
  "empty-path",
]);

/**
 * Union, not a flag: a broken answer has no `changes` field at all, so a file
 * list with an import button cannot be drawn over it.
 *
 * An empty `changes` under `status: "parsed"` is a working outcome ("nothing
 * to import"), not an error.
 */
export type ParsedAnswer =
  | {
      status: "broken";
      /** At least one problem out of BLOCK_LOST. */
      problems: AnswerProblem[];
      /** The text is shown anyway — an answer reads fine without import. */
      prose: string;
    }
  | {
      status: "parsed";
      /**
       * Strictly in the order they appear, the order the human reads them in.
       * The answer order is the apply order: if a path shows up twice, the
       * last block wins. The parser does not resolve duplicates — it only
       * names them in `problems`.
       */
      changes: AnswerChange[];
      /** All text outside blocks, one piece, as is. */
      prose: string;
      /** Local oddities: duplicate path, conflict, `<rename>`. May be empty. */
      problems: AnswerProblem[];
    };

// The grammar is line-based — not a choice but a mirror of how the package is
// printed (`prompt-package/core.ts`, a block goes out as
// `<tag …>\n${body}\n</tag>` with no escaping): the opening and closing tags
// are whole lines, everything between them is the body byte for byte. That is
// why `<`/`>` inside a regex cannot be mistaken for tags, and why any unknown
// tag is prose.
const OPEN_FILE = /^<file\s+path="(.*)">\s*$/;
const OPEN_DELETE = /^<delete\s+path="(.*)">\s*$/;
const OPEN_RENAME = /^<rename\s+from="(.*)"\s+to="(.*)">\s*$/;
const CLOSE = /^<\/(file|delete|rename)>\s*$/;
// "The line looks like an opening tag" — catches malformed-open so a broken
// tag does not leak into the prose silently.
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

/** What a line outside any block is, when it is not prose. */
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
      // An unclosed block eats the rest of the answer — nothing left to parse.
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

// --- The boundary of what may be written -----------------------------------

/**
 * Why a path is out of bounds. Only ever used to phrase a message: the verdict
 * itself is made by the whitelist below, so a misphrased class costs nothing.
 */
export type PathViolation =
  /** A path into another bank's folder. */
  | "other-bank"
  /** Inside the bank root, where only `senders.txt` may live. */
  | "bank-root"
  /** A path leading outside the bank folder altogether. */
  | "outside"
  /** Anything else: a subfolder of `formats/`, a bad name, a bad extension. */
  | "invalid-path";

// Only letters, digits, spaces and `_`, per §5 of `format-rules.md`. The
// existing `isBankFormatFilePath` is deliberately softer (`startsWith` +
// `endsWith` let a subfolder through) and is not reused here: "highlight it as
// a format file" tolerates softness, "write a draft at this path" does not.
const FORMAT_FILE_NAME = /^[\p{L}\p{N} _]+\.txt$/u;

/** A closed whitelist of exactly two shapes (ADR-0017). */
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
  // Inside the bank: either a stray file in its root, or anything deeper —
  // a `formats/` subfolder, a bad name, a bad extension.
  return path.slice(prefix.length).includes("/") ? "invalid-path" : "bank-root";
}

/** The tail of `path` under `prefix`, or `null` if it is not a plain child. */
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
