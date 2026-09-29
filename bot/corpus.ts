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
  fileUrl: string;
}

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
  const encodedPath = repoPath.split("/").map(encodeURIComponent).join("/");
  return `https://github.com/${repoSlug}/blob/${sha}/${encodedPath}`;
}

function isFormatFilePath(repoPath: string): boolean {
  const bankPath = bankPathOf(repoPath);
  return Boolean(bankPath && isBankFormatFilePath(repoPath, bankPath));
}

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
