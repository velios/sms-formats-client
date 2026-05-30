import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  buildMainCorpus,
  buildPrCorpus,
  type CorpusFormat,
  openPrCount,
} from "./corpus";
import type { MainCheckout } from "./main-checkout";

function formatFile(regex: string): string {
  return `${regex}\n\n-----COLUMNS-----\nsum\n\n-----EXAMPLE-----\nexample text\n`;
}

function writeRepoFile(dir: string, repoPath: string, content: string): void {
  const abs = join(dir, repoPath);
  mkdirSync(join(abs, ".."), { recursive: true });
  writeFileSync(abs, content);
}

describe("buildMainCorpus", () => {
  let dir: string;
  let corpus: CorpusFormat[];

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), "corpus-"));
    writeRepoFile(
      dir,
      "src/sberbank/formats/12.txt",
      formatFile("^Pokupka \\d+ RUB$")
    );
    writeRepoFile(
      dir,
      "src/tinkoff_2/formats/3.txt",
      formatFile("^Spisanie \\d+ RUB$")
    );
    // senders.txt is not a format file — must be ignored.
    writeRepoFile(dir, "src/sberbank/senders.txt", "900\nSBERBANK\n");
    // A non-format file outside formats/ — also ignored.
    writeRepoFile(dir, "README.md", "# repo\n");
    // Empty regex — skipped so it never matches every SMS.
    writeRepoFile(dir, "src/empty/formats/1.txt", formatFile(""));
    // Real bank/format names carry spaces and Cyrillic — the permalink encodes.
    writeRepoFile(
      dir,
      "src/Банк ЛНР_1/formats/Zachislenie RUB_5.txt",
      formatFile("^Zachislenie \\d+ RUB$")
    );

    const checkout: MainCheckout = {
      dir,
      sha: "abc123",
      repoSlug: "zenmoney/sms-formats",
    };
    corpus = buildMainCorpus(checkout);
  });

  afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("collects each format file as a main-sourced CorpusFormat", () => {
    expect(corpus).toContainEqual({
      source: { kind: "main" },
      bank: "sberbank",
      formatId: "12",
      regex: "^Pokupka \\d+ RUB$",
      fileUrl:
        "https://github.com/zenmoney/sms-formats/blob/abc123/src/sberbank/formats/12.txt",
    });
    expect(corpus).toContainEqual({
      source: { kind: "main" },
      bank: "tinkoff_2",
      formatId: "3",
      regex: "^Spisanie \\d+ RUB$",
      fileUrl:
        "https://github.com/zenmoney/sms-formats/blob/abc123/src/tinkoff_2/formats/3.txt",
    });
  });

  it("ignores senders.txt and files outside formats/", () => {
    expect(corpus.some((f) => f.fileUrl.includes("senders.txt"))).toBe(false);
    expect(corpus.some((f) => f.fileUrl.includes("README"))).toBe(false);
  });

  it("skips format files whose regex is empty", () => {
    expect(corpus.some((f) => f.bank === "empty")).toBe(false);
  });

  it("encodes spaces and Cyrillic in the file permalink", () => {
    const entry = corpus.find((f) => f.bank === "Банк ЛНР_1");
    expect(entry?.fileUrl).toBe(
      "https://github.com/zenmoney/sms-formats/blob/abc123/src/%D0%91%D0%B0%D0%BD%D0%BA%20%D0%9B%D0%9D%D0%A0_1/formats/Zachislenie%20RUB_5.txt"
    );
  });

  it("sorts formats by bank then formatId", () => {
    const sorted = [...corpus].sort(
      (a, b) =>
        a.bank.localeCompare(b.bank) ||
        a.formatId.localeCompare(b.formatId, undefined, { numeric: true })
    );
    expect(corpus).toEqual(sorted);
  });

  it("reports zero open PRs for a main-only corpus", () => {
    expect(openPrCount(corpus)).toBe(0);
  });
});

const GIT_ENV = {
  ...process.env,
  GIT_AUTHOR_NAME: "Test",
  GIT_AUTHOR_EMAIL: "test@example.com",
  GIT_COMMITTER_NAME: "Test",
  GIT_COMMITTER_EMAIL: "test@example.com",
};

function git(dir: string, args: string[]): string {
  return execFileSync("git", args, {
    cwd: dir,
    env: GIT_ENV,
    encoding: "utf8",
  }).trim();
}

function commitAll(dir: string, message: string): string {
  git(dir, ["add", "-A"]);
  git(dir, ["commit", "-q", "-m", message]);
  return git(dir, ["rev-parse", "HEAD"]);
}

describe("buildPrCorpus", () => {
  let dir: string;
  let checkout: MainCheckout;
  let prHeadSha: string;
  let corpus: CorpusFormat[];

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), "pr-corpus-"));
    git(dir, ["init", "-q", "-b", "main"]);

    // main: two banks plus a format the PR will delete.
    writeRepoFile(dir, "src/sberbank/formats/12.txt", formatFile("^Old Sber$"));
    writeRepoFile(dir, "src/tinkoff/formats/3.txt", formatFile("^Tinkoff$"));
    writeRepoFile(dir, "src/legacy/formats/1.txt", formatFile("^Legacy$"));
    const mainSha = commitAll(dir, "main");

    // PR #7 off main: modify a format, add a format in a *different* bank
    // (multiple banks per PR allowed), delete one, add an empty-regex format,
    // and touch a non-format file — only the first two should reach the corpus.
    git(dir, ["checkout", "-q", "-b", "pr7"]);
    writeRepoFile(dir, "src/sberbank/formats/12.txt", formatFile("^New Sber$"));
    writeRepoFile(dir, "src/alfabank/formats/9.txt", formatFile("^Alfa$"));
    rmSync(join(dir, "src/legacy/formats/1.txt"));
    writeRepoFile(dir, "src/blank/formats/4.txt", formatFile(""));
    writeRepoFile(dir, "src/sberbank/senders.txt", "900\n");
    prHeadSha = commitAll(dir, "pr7");

    // Simulate what fetchPullRequestHead lands: the PR head at refs/pr/7, with
    // main checked out as HEAD (the bot never checks a PR out).
    git(dir, ["update-ref", "refs/pr/7", prHeadSha]);
    git(dir, ["checkout", "-q", "main"]);

    checkout = { dir, sha: mainSha, repoSlug: "zenmoney/sms-formats" };
    corpus = buildPrCorpus(checkout, {
      number: 7,
      title: "Improve Sber & add Alfa",
      headSha: prHeadSha,
    });
  });

  afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("includes added and modified format files, permalinked at the PR head", () => {
    expect(corpus).toEqual([
      {
        source: { kind: "pr", number: 7, title: "Improve Sber & add Alfa" },
        bank: "alfabank",
        formatId: "9",
        regex: "^Alfa$",
        fileUrl: `https://github.com/zenmoney/sms-formats/blob/${prHeadSha}/src/alfabank/formats/9.txt`,
      },
      {
        source: { kind: "pr", number: 7, title: "Improve Sber & add Alfa" },
        bank: "sberbank",
        formatId: "12",
        regex: "^New Sber$",
        fileUrl: `https://github.com/zenmoney/sms-formats/blob/${prHeadSha}/src/sberbank/formats/12.txt`,
      },
    ]);
  });

  it("skips deleted formats, empty regexes and non-format files", () => {
    expect(corpus.some((f) => f.bank === "legacy")).toBe(false);
    expect(corpus.some((f) => f.bank === "blank")).toBe(false);
    expect(corpus.some((f) => f.fileUrl.includes("senders.txt"))).toBe(false);
  });

  it("does not carry over formats main has but the PR leaves untouched", () => {
    expect(corpus.some((f) => f.bank === "tinkoff")).toBe(false);
  });
});
