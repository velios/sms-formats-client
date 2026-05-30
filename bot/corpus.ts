/**
 * Corpus = the set of formats the Recognition Bot matches against (see Corpus,
 * Source in CONTEXT.md). It has two halves, both built off one git checkout of
 * `zenmoney/sms-formats`: every format file on `main` (Source=main), plus the
 * formats added or modified in each open PR (Source=pr). A bank can appear twice
 * — once from main and once as a pending proposal in a PR — and that's the point.
 * Every format permalinks to its file at its own Source's SHA.
 */

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { isBankFormatFilePath, parseFormatFile } from "@/domain/format";
import {
  changedFiles,
  type MainCheckout,
  readFileAtPullRequestHead,
} from "./main-checkout";
import type { OpenPullRequest } from "./pull-requests";

export type Source =
  | { kind: "main" }
  | { kind: "pr"; number: number; title: string };

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

/** A `src/<bank>/formats/*.txt` file — the only files that hold formats. */
function isFormatFilePath(repoPath: string): boolean {
  const bankPath = bankPathOf(repoPath);
  return Boolean(bankPath && isBankFormatFilePath(repoPath, bankPath));
}

/**
 * One already-identified format file → a CorpusFormat, or null if its regex is
 * empty (an empty regex would spuriously match every SMS). Shared by both
 * halves; only the Source, raw content and permalink SHA differ.
 */
function toCorpusFormat(
  source: Source,
  repoPath: string,
  raw: string,
  repoSlug: string,
  sha: string
): CorpusFormat | null {
  const { regex } = parseFormatFile(raw, repoPath);
  if (!regex) {
    return null;
  }
  // bankPathOf is non-null here: the caller only passes format-file paths.
  const bankPath = bankPathOf(repoPath) as string;
  return {
    source,
    bank: bankNameOf(bankPath),
    formatId: formatIdOf(repoPath),
    regex,
    fileUrl: blobUrl(repoSlug, sha, repoPath),
  };
}

function sortByBankThenFormatId(formats: CorpusFormat[]): CorpusFormat[] {
  return formats.sort(
    (a, b) =>
      a.bank.localeCompare(b.bank) ||
      a.formatId.localeCompare(b.formatId, undefined, { numeric: true })
  );
}

/**
 * The `main` half: every `src/<bank>/formats/*.txt` on the checked-out main
 * (so `senders.txt` and non-format files are skipped), each Source=main and
 * permalinked at the checkout SHA.
 */
export function buildMainCorpus(checkout: MainCheckout): CorpusFormat[] {
  const formats: CorpusFormat[] = [];
  for (const repoPath of listRepoFiles(checkout.dir)) {
    if (!isFormatFilePath(repoPath)) {
      continue;
    }
    const raw = readFileSync(join(checkout.dir, repoPath), "utf8");
    const format = toCorpusFormat(
      { kind: "main" },
      repoPath,
      raw,
      checkout.repoSlug,
      checkout.sha
    );
    if (format) {
      formats.push(format);
    }
  }
  return sortByBankThenFormatId(formats);
}

/**
 * The PR half for one open PR: format files it adds or modifies (deleted files
 * skipped — there's nothing to recognize), read at the PR head and permalinked
 * there, each Source=pr. The editor's single-bank rule doesn't apply here, so a
 * PR touching several banks contributes a format per bank. The PR head must
 * already be fetched into `refs/pr/<N>` (see `fetchPullRequestHead`).
 */
export function buildPrCorpus(
  checkout: MainCheckout,
  pr: OpenPullRequest
): CorpusFormat[] {
  const source: Source = { kind: "pr", number: pr.number, title: pr.title };
  const formats: CorpusFormat[] = [];
  for (const change of changedFiles(checkout, pr.number)) {
    if (change.status === "D" || !isFormatFilePath(change.repoPath)) {
      continue;
    }
    const raw = readFileAtPullRequestHead(checkout, pr.number, change.repoPath);
    const format = toCorpusFormat(
      source,
      change.repoPath,
      raw,
      checkout.repoSlug,
      pr.headSha
    );
    if (format) {
      formats.push(format);
    }
  }
  return sortByBankThenFormatId(formats);
}

/**
 * The whole corpus — main half plus the PR half of every open PR — built purely
 * from the current on-disk git state (the heads must already be fetched into
 * `refs/pr/<N>`; freshness sync owns the fetching). A single failing PR
 * (unreadable file, missing ref) is reported via `onSkip` and dropped rather
 * than thrown — one broken proposal must not sink the snapshot, since main is
 * the durable core and PRs are additive (ADR-0004). The snapshot is assembled
 * fully here before the store swaps it in, so readers never see a half-built one.
 */
export function buildCorpus(
  checkout: MainCheckout,
  openPrs: OpenPullRequest[],
  onSkip: (pr: OpenPullRequest, error: unknown) => void
): CorpusFormat[] {
  const prFormats = openPrs.flatMap((pr) => {
    try {
      return buildPrCorpus(checkout, pr);
    } catch (error) {
      onSkip(pr, error);
      return [];
    }
  });
  return [...buildMainCorpus(checkout), ...prFormats];
}
