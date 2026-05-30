/**
 * Corpus = the set of formats the Recognition Bot matches against (see Corpus,
 * Source in CONTEXT.md). This slice builds the `main` half of it from a real
 * git checkout of `zenmoney/sms-formats`: every format file on main becomes a
 * CorpusFormat with Source=main and a permalink to the file at the checked-out
 * SHA. Open-PR sources (and the duplication a PR introduces) come later.
 */

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { isBankFormatFilePath, parseFormatFile } from "@/domain/format";
import type { MainCheckout } from "./main-checkout";

export type Source = { kind: "main" } | { kind: "pr"; number: number };

export interface CorpusFormat {
  source: Source;
  bank: string;
  formatId: string;
  regex: string;
  /** Permalink to the format file in the repo at this Source's SHA. */
  fileUrl: string;
}

/** Number of distinct open PRs represented in the corpus. */
export function openPrCount(corpus: CorpusFormat[]): number {
  const numbers = new Set<number>();
  for (const format of corpus) {
    if (format.source.kind === "pr") {
      numbers.add(format.source.number);
    }
  }
  return numbers.size;
}

const REPO_ROOT_DIR = "src";

/** Repo-relative paths of every file under `src/`, with forward slashes. */
function listRepoFiles(checkoutDir: string): string[] {
  const paths: string[] = [];
  const walk = (relDir: string) => {
    const absDir = join(checkoutDir, relDir);
    for (const entry of readdirSync(absDir, { withFileTypes: true })) {
      const relPath = `${relDir}/${entry.name}`;
      if (entry.isDirectory()) {
        walk(relPath);
      } else if (entry.isFile()) {
        paths.push(relPath);
      }
    }
  };
  walk(REPO_ROOT_DIR);
  return paths;
}

/** `src/<bank>/...` → `src/<bank>`, the bank folder the predicate expects. */
function bankPathOf(repoPath: string): string | null {
  const [root, bank] = repoPath.split("/");
  if (root !== REPO_ROOT_DIR || !bank) {
    return null;
  }
  return `${root}/${bank}`;
}

function bankNameOf(bankPath: string): string {
  return bankPath.slice(`${REPO_ROOT_DIR}/`.length);
}

function formatIdOf(repoPath: string): string {
  const fileName = repoPath.split("/").at(-1) ?? "";
  return fileName.replace(/\.txt$/, "");
}

function blobUrl(repoSlug: string, sha: string, repoPath: string): string {
  // Real bank/format names carry spaces and Cyrillic; encode each path segment
  // (keeping `/` as the separator) so the permalink survives in an HTML href.
  const encodedPath = repoPath.split("/").map(encodeURIComponent).join("/");
  return `https://github.com/${repoSlug}/blob/${sha}/${encodedPath}`;
}

/**
 * Walk a main checkout into the `main` corpus: each `src/<bank>/formats/*.txt`
 * (identified by `isBankFormatFilePath`, so `senders.txt` is ignored) parsed by
 * `parseFormatFile`. Formats whose regex is empty are skipped — an empty regex
 * would spuriously match every SMS.
 */
export function buildMainCorpus(checkout: MainCheckout): CorpusFormat[] {
  const formats: CorpusFormat[] = [];
  for (const repoPath of listRepoFiles(checkout.dir)) {
    const bankPath = bankPathOf(repoPath);
    if (!(bankPath && isBankFormatFilePath(repoPath, bankPath))) {
      continue;
    }
    const raw = readFileSync(join(checkout.dir, repoPath), "utf8");
    const { regex } = parseFormatFile(raw, repoPath);
    if (!regex) {
      continue;
    }
    formats.push({
      source: { kind: "main" },
      bank: bankNameOf(bankPath),
      formatId: formatIdOf(repoPath),
      regex,
      fileUrl: blobUrl(checkout.repoSlug, checkout.sha, repoPath),
    });
  }
  return formats.sort(
    (a, b) =>
      a.bank.localeCompare(b.bank) ||
      a.formatId.localeCompare(b.formatId, undefined, { numeric: true })
  );
}
