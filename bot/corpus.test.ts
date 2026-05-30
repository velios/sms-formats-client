import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildMainCorpus, type CorpusFormat, openPrCount } from "./corpus";
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
