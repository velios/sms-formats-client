import { describe, expect, it } from "bun:test";
import { decodeSmsPayload } from "@/domain/format";
import type { CorpusFormat } from "./corpus";
import type { RecognizedFormat } from "./recognize";
import {
  CONFLICT_HINT,
  DIRECT_USAGE_HINT,
  GUEST_USAGE_HINT,
  renderResponse,
} from "./render";

const SBER_URL =
  "https://github.com/zenmoney/sms-formats/blob/abc/src/sberbank/formats/12.txt";
const TINKOFF_URL =
  "https://github.com/zenmoney/sms-formats/blob/abc/src/tinkoff/formats/24.txt";

const corpus: CorpusFormat[] = [
  {
    source: { kind: "pr", number: 45, title: "Add Tinkoff format" },
    bank: "tinkoff",
    formatId: "24",
    regex: "x",
    fileUrl: TINKOFF_URL,
  },
  {
    source: { kind: "pr", number: 50, title: "Add Alfa format" },
    bank: "alfabank",
    formatId: "3",
    regex: "y",
    fileUrl:
      "https://github.com/zenmoney/sms-formats/blob/abc/src/alfabank/formats/3.txt",
  },
];

describe("usage hints", () => {
  it("guest hint names the /sms trigger", () => {
    expect(GUEST_USAGE_HINT).toContain("/sms");
  });

  it("direct hint offers bare text and the optional /sms", () => {
    expect(DIRECT_USAGE_HINT).toContain("/sms");
    expect(DIRECT_USAGE_HINT).toContain("просто сообщением");
  });

  it("conflict hint calls out the two-ways-at-once mistake", () => {
    expect(CONFLICT_HINT).toContain("двумя способами");
  });

  it("the three hints are distinct strings", () => {
    expect(
      new Set([GUEST_USAGE_HINT, DIRECT_USAGE_HINT, CONFLICT_HINT]).size
    ).toBe(3);
  });
});

describe("renderResponse", () => {
  it("preserves exact nested paths, repository, original SMS and all GitHub links", () => {
    const filePath = 'src/банк/nested/formats/Пример %20 # ? "&.txt';
    const fileUrl = `https://github.com/other/repository/blob/immutable-sha/${filePath.split("/").map(encodeURIComponent).join("/")}`;
    const sms = ' \r\nПривет <&"> 😀\n\r\n ';
    const recognized: RecognizedFormat[] = [
      {
        source: { kind: "pr", number: 19, title: 'Fix "<&>' },
        bank: 'банк "<&>',
        formatId: "1",
        fileUrl,
      },
      { source: { kind: "main" }, bank: "another", formatId: "2", fileUrl },
      {
        source: { kind: "pr", number: 2, title: "Earlier" },
        bank: "third",
        formatId: "3",
        fileUrl,
      },
    ];
    const response = renderResponse(recognized, corpus, sms);
    expect(response.match(/>zensms<\/a>/g)).toHaveLength(3);
    expect(response.split(fileUrl)).toHaveLength(4);
    expect(response).toContain("банк &quot;&lt;&amp;&gt;/1");
    expect(response).toContain("Fix &quot;&lt;&amp;&gt;");
    const links = [...response.matchAll(/href="([^"]+)">zensms/g)].map(
      (match) => new URL((match[1] ?? "").replaceAll("&amp;", "&"))
    );
    expect(links.map((url) => url.pathname)).toEqual([
      "/repo/other/repository/main",
      "/repo/other/repository/pr/2",
      "/repo/other/repository/pr/19",
    ]);
    for (const url of links) {
      expect(url.searchParams.get("file")).toBe(filePath);
      expect(url.href).not.toContain("immutable-sha");
      expect(url.href).not.toContain("show-example");
      expect(decodeSmsPayload(url.hash.slice("#add-sms=".length))).toBe(sms);
    }
  });

  it("escapes quotes and HTML characters in the retained GitHub href", () => {
    const response = renderResponse(
      [
        {
          source: { kind: "main" },
          bank: "bank",
          formatId: "1",
          fileUrl: `${SBER_URL}?note="<&>`,
        },
      ],
      corpus,
      "SMS"
    );
    expect(response).toContain(`${SBER_URL}?note=&quot;&lt;&amp;&gt;`);
  });

  it("keeps the complete payload for a large SMS without limits or splitting", () => {
    const sms = "Юникод 😀\r\n".repeat(1000);
    const response = renderResponse(
      [
        {
          source: { kind: "main" },
          bank: "bank",
          formatId: "1",
          fileUrl: SBER_URL,
        },
      ],
      corpus,
      sms
    );
    expect(response.match(/>zensms<\/a>/g)).toHaveLength(1);
    expect(
      decodeSmsPayload(
        response.match(/#add-sms=([A-Za-z0-9_-]*)/)?.[1] ?? "invalid!"
      )
    ).toBe(sms);
  });

  it("groups recognized formats by source, main first then PRs ascending, with PR titles, as file links", () => {
    const recognized: RecognizedFormat[] = [
      {
        source: { kind: "pr", number: 45, title: "Add Tinkoff format" },
        bank: "tinkoff",
        formatId: "24",
        fileUrl: TINKOFF_URL,
      },
      {
        source: { kind: "main" },
        bank: "sberbank",
        formatId: "12",
        fileUrl: SBER_URL,
      },
    ];
    expect(renderResponse(recognized, corpus, "SMS")).toBe(
      `main:\n- <a href="${SBER_URL}">sberbank/12</a> (<a href="https://sms.zentable.ru/repo/zenmoney/sms-formats/main?file=src%2Fsberbank%2Fformats%2F12.txt#add-sms=U01T">zensms</a>)\nPR #45 «Add Tinkoff format»\n- <a href="${TINKOFF_URL}">tinkoff/24</a> (<a href="https://sms.zentable.ru/repo/zenmoney/sms-formats/pr/45?file=src%2Ftinkoff%2Fformats%2F24.txt#add-sms=U01T">zensms</a>)`
    );
  });

  it("escapes HTML in the PR title", () => {
    const recognized: RecognizedFormat[] = [
      {
        source: { kind: "pr", number: 7, title: "Fix <b> & co" },
        bank: "tinkoff",
        formatId: "24",
        fileUrl: TINKOFF_URL,
      },
    ];
    expect(renderResponse(recognized, corpus, "SMS")).toBe(
      `PR #7 «Fix &lt;b&gt; &amp; co»\n- <a href="${TINKOFF_URL}">tinkoff/24</a> (<a href="https://sms.zentable.ru/repo/zenmoney/sms-formats/pr/7?file=src%2Ftinkoff%2Fformats%2F24.txt#add-sms=U01T">zensms</a>)`
    );
  });

  it("escapes HTML in the bank/formatId title", () => {
    const recognized: RecognizedFormat[] = [
      {
        source: { kind: "main" },
        bank: "a&b",
        formatId: "1",
        fileUrl: SBER_URL,
      },
    ];
    expect(renderResponse(recognized, corpus, "SMS")).toBe(
      `main:\n- <a href="${SBER_URL}">a&amp;b/1</a> (<a href="https://sms.zentable.ru/repo/zenmoney/sms-formats/main?file=src%2Fsberbank%2Fformats%2F12.txt#add-sms=U01T">zensms</a>)`
    );
  });

  it("reports no matches with the count of open PRs", () => {
    expect(renderResponse([], corpus, "SMS")).toBe(
      "Ни один формат не распознаёт этот SMS — ни на main, ни в 2 открытых PR. Похоже, нужен новый формат."
    );
  });
});
