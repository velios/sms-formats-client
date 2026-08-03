// Same checks as validate_answer.py, but on the browser's regex engine — the
// one the client uses to compute `intersections`. Python `re` and JS RegExp
// disagree on `\w`/`\b` (Unicode vs ASCII) and on inline `(?i)`, so a fix can
// pass one and fail the other.
//
// Usage: bun run validate_answer.ts <package.txt> <answer.txt>

import { readFileSync } from "node:fs";

type State = Map<string, string | null>;

function parseBlocks(text: string): Array<[string, string | null]> {
  const out: Array<[string, string | null]> = [];
  const lines = text.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const open = /^<file path="(.+)">$/.exec(lines[i] ?? "");
    const del = /^<delete path="(.+)">$/.exec(lines[i] ?? "");
    if (open) {
      const body: string[] = [];
      i++;
      while (i < lines.length && lines[i] !== "</file>") {
        body.push(lines[i] ?? "");
        i++;
      }
      out.push([open[1] as string, body.join("\n")]);
    } else if (del) {
      while (i < lines.length && lines[i] !== "</delete>") {
        i++;
      }
      out.push([del[1] as string, null]);
    }
  }
  return out;
}

function parseLayers(packageText: string): State {
  const state: State = new Map();
  for (const layer of ["main", "pr", "draft"]) {
    const match = new RegExp(`<files layer="${layer}">\\n([\\s\\S]*?)\\n</files>`).exec(packageText);
    if (!match) {
      continue;
    }
    for (const [path, body] of parseBlocks(match[1] as string)) {
      state.set(path, body);
    }
  }
  return state;
}

function parseFormat(body: string): { regex: string; cols: string[]; examples: string[] } | null {
  const lines = body.replace(/^\n+|\n+$/g, "").split("\n");
  const regex = lines[0] ?? "";
  const parts = lines.slice(1).join("\n").split("-----COLUMNS-----");
  if (parts.length !== 2) {
    return null;
  }
  const chunks = (parts[1] as string).split("-----EXAMPLE-----");
  const columns = (chunks[0] as string).trim();
  return {
    regex,
    cols: columns ? columns.split(";").map((c) => c.trim()) : [],
    examples: chunks.slice(1).map((e) => e.trim()),
  };
}

const clean = (s: string) => s.replace(/[\n\r]+/g, " ").trim();

function countGroups(source: string): number {
  return new RegExp(`${source}|`).exec("")?.length ?? 0;
}

const packageText = readFileSync(process.argv[2] as string, "utf8");
const answerText = readFileSync(process.argv[3] as string, "utf8");
const state = parseLayers(packageText);
for (const [path, body] of parseBlocks(answerText)) {
  if (body === null) {
    state.delete(path);
  } else {
    state.set(path, body);
  }
}

const formats = new Map<string, { re: RegExp; cols: string[]; examples: string[] }>();
const errors: string[] = [];

for (const path of [...state.keys()].sort()) {
  if (!path.endsWith(".txt") || path.endsWith("senders.txt")) {
    continue;
  }
  const parsed = parseFormat(state.get(path) as string);
  if (!parsed) {
    errors.push(`[invalid_format] ${path}`);
    continue;
  }
  let re: RegExp;
  try {
    re = new RegExp(clean(parsed.regex));
  } catch (error) {
    errors.push(`[regex_error] ${path}\n    ${String(error)}`);
    continue;
  }
  formats.set(path, { re, cols: parsed.cols, examples: parsed.examples });
  const groups = countGroups(re.source) - 1;
  for (const example of parsed.examples) {
    if (!re.test(clean(example))) {
      errors.push(`[example_no_match] ${path}\n    ${example.slice(0, 60)}`);
      continue;
    }
    if (parsed.cols.length > 0 && groups !== parsed.cols.length) {
      errors.push(`[group_count_mismatch] ${path}\n    groups=${groups} cols=${parsed.cols.length}`);
    }
  }
}

const paths = [...formats.keys()].sort();
for (const left of paths) {
  for (const right of paths) {
    if (left === right) {
      continue;
    }
    for (const example of (formats.get(right) as { examples: string[] }).examples) {
      if ((formats.get(left) as { re: RegExp }).re.test(clean(example))) {
        errors.push(`[cross_match] ${left}  ловит пример из  ${right}\n    ${example.slice(0, 70)}`);
      }
    }
  }
}

if (errors.length === 0) {
  console.log(`OK: ошибок нет. ${formats.size} форматов проверено`);
}
for (const error of errors) {
  console.log(error);
}
