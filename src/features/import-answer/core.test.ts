import { describe, expect, it } from "vitest";
import {
  type AnswerProblemKind,
  classifyPathViolation,
  isImportablePath,
  type PathViolation,
  parseAnswer,
} from "@/features/import-answer/core";
import { buildPromptPackage } from "@/features/prompt-package/core";
// The three real answers of the corpus (`.agents/research/agent-response-corpus/`,
// gathered in #23). `.agents/` is gitignored, so the answers are copied in here
// verbatim — otherwise these tests would only run on the machine that has the
// corpus.
import amexAnswer from "./fixtures/amex-us.response.txt?raw";
import centercreditAnswer from "./fixtures/centercredit-kz.response.txt?raw";
import sberAnswer from "./fixtures/sber-ru.response.txt?raw";

const BANK_PATH = "src/СберБанк-ru_4624";

function kinds(problems: Array<{ kind: AnswerProblemKind }>) {
  return problems.map((problem) => problem.kind);
}

describe("parseAnswer: round trip against the printed package", () => {
  // The bodies the package prints and the bodies the parser reads back must be
  // the same bytes — that is the whole reason the grammar is line-based.
  const bodies: Record<string, string> = {
    [`${BANK_PATH}/senders.txt`]: "SBERBANK\n900\n",
    // A trailing newline: printing adds `\n</file>` after it, so the body ends
    // with an empty line the parser has to keep.
    [`${BANK_PATH}/formats/Trailing newline_1.txt`]: "^Покупка (\\d+)р\n",
    // `<` and `>` inside a regex, plus a line that is itself a `<file>` tag —
    // neither may end the block early.
    [`${BANK_PATH}/formats/Angle brackets_2.txt`]:
      '^Перевод <(\\d+)> на (\\S+)\n\n-----COLUMNS-----\noutcome;payee\n\n-----EXAMPLE-----\n<file path="fake.txt">',
  };

  const packaged = buildPromptPackage({
    bankName: "СберБанк",
    bankPath: BANK_PATH,
    layers: {
      main: [],
      pr: Object.entries(bodies).map(([path, content]) => ({ path, content })),
      draft: [],
    },
    documents: [],
    task: "Поправь форматы",
    skipped: [],
  });

  const parsed = parseAnswer(packaged.text);

  it("reads every printed file back byte for byte", () => {
    expect(parsed.status).toBe("parsed");
    if (parsed.status !== "parsed") {
      return;
    }
    expect(parsed.changes).toHaveLength(Object.keys(bodies).length);
    for (const change of parsed.changes) {
      expect(change.kind).toBe("write");
      if (change.kind !== "write") {
        continue;
      }
      expect(change.content).toBe(bodies[change.path]);
    }
  });

  it("takes the package's own wrappers for prose, not for tags", () => {
    expect(parsed.status).toBe("parsed");
    if (parsed.status !== "parsed") {
      return;
    }
    // `<files layer="pr">` / `</files>` are neither an open nor a close.
    expect(parsed.problems).toEqual([]);
    expect(parsed.prose).toContain('<files layer="pr">');
  });
});

const LOST_BLOCK_CASES: [AnswerProblemKind, string][] = [
  ["unclosed", '<file path="a.txt">\nтело без закрытия'],
  ["orphan-close", "Поправил формат.\n</file>"],
  ["malformed-open", "<file path=a.txt>\nтело\n</file>"],
  ["empty-path", '<file path="">\nтело\n</file>'],
];

describe("parseAnswer: problems that lose a block", () => {
  it.each(LOST_BLOCK_CASES)("%s breaks the answer", (kind, text) => {
    const parsed = parseAnswer(text);
    expect(parsed.status).toBe("broken");
    expect(kinds(parsed.problems)).toContain(kind);
  });

  it("keeps the prose of a broken answer readable", () => {
    const parsed = parseAnswer(
      'Не стал трогать остальные форматы.\n\n<file path="a.txt">\nтело'
    );
    expect(parsed.status).toBe("broken");
    expect(parsed.prose).toBe("Не стал трогать остальные форматы.");
    expect(parsed.problems[0]?.line).toBe(3);
  });

  it("names an empty delete path too", () => {
    const parsed = parseAnswer('<delete path="  ">\nдубль\n</delete>');
    expect(parsed.status).toBe("broken");
    expect(kinds(parsed.problems)).toEqual(["empty-path"]);
  });
});

describe("parseAnswer: problems that do not break the import", () => {
  const bank = `${BANK_PATH}/formats/Формат_1.txt`;

  it("names a duplicate path but keeps both blocks", () => {
    const parsed = parseAnswer(
      `<file path="${bank}">\nпервое\n</file>\n<file path="${bank}">\nвторое\n</file>`
    );
    expect(parsed.status).toBe("parsed");
    if (parsed.status !== "parsed") {
      return;
    }
    expect(kinds(parsed.problems)).toEqual(["duplicate-path"]);
    expect(parsed.problems[0]?.line).toBe(4);
  });

  it("names a write and a delete of the same path as a conflict", () => {
    const parsed = parseAnswer(
      `<file path="${bank}">\nтело\n</file>\n<delete path="${bank}">\nдубль\n</delete>`
    );
    expect(parsed.status).toBe("parsed");
    expect(kinds(parsed.problems)).toEqual(["conflicting-path"]);
  });

  it("recognizes <rename> and refuses it without losing the rest", () => {
    const parsed = parseAnswer(
      `<rename from="a.txt" to="b.txt">\nимя устарело\n</rename>\n<file path="${bank}">\nтело\n</file>`
    );
    expect(parsed.status).toBe("parsed");
    if (parsed.status !== "parsed") {
      return;
    }
    expect(kinds(parsed.problems)).toEqual(["unsupported-rename"]);
    expect(parsed.problems[0]?.excerpt).toBe("a.txt → b.txt");
    expect(parsed.changes).toHaveLength(1);
  });
});

describe("parseAnswer: order of the answer is the order of applying", () => {
  it("keeps blocks in answer order, so the last block on a path wins", () => {
    const path = `${BANK_PATH}/senders.txt`;
    const parsed = parseAnswer(
      `<file path="${path}">\nстарое\n</file>\nПередумал.\n<file path="${path}">\nновое\n</file>`
    );
    expect(parsed.status).toBe("parsed");
    if (parsed.status !== "parsed") {
      return;
    }
    expect(parsed.changes.map((change) => change.line)).toEqual([1, 5]);
    const applied = new Map(
      parsed.changes.map((change) => [
        change.path,
        change.kind === "write" ? change.content : null,
      ])
    );
    expect(applied.get(path)).toBe("новое");
  });
});

describe("parseAnswer: the corpus", () => {
  it("parses the Sber answer with no problems", () => {
    const parsed = parseAnswer(sberAnswer);
    expect(parsed.status).toBe("parsed");
    if (parsed.status !== "parsed") {
      return;
    }
    expect(parsed.problems).toEqual([]);
    const byKind = parsed.changes.map((change) => change.kind);
    expect(byKind.filter((kind) => kind === "write")).toHaveLength(10);
    expect(byKind.filter((kind) => kind === "delete")).toHaveLength(4);
    expect(
      parsed.changes.every((change) => change.path.startsWith(BANK_PATH))
    ).toBe(true);
    const deletion = parsed.changes.find((change) => change.kind === "delete");
    expect(deletion?.kind === "delete" && deletion.reason).toBeTruthy();
  });

  it("parses the CenterCredit answer, taking the capture junk for prose", () => {
    const parsed = parseAnswer(centercreditAnswer);
    expect(parsed.status).toBe("parsed");
    if (parsed.status !== "parsed") {
      return;
    }
    // `</content>` / `</invoke>` left over by the capture tool are not our
    // closing tags, so they cost nothing.
    expect(parsed.problems).toEqual([]);
    expect(parsed.changes.map((change) => change.path)).toEqual([
      "src/Банк ЦентрКредит-kz_15361/formats/KZT Spisanie s Karti Balans KZT BCC KZ.txt",
      "src/Банк ЦентрКредит-kz_15361/senders.txt",
    ]);
    expect(parsed.prose).toContain("</invoke>");
  });

  it("parses an all-prose answer as nothing to import", () => {
    const parsed = parseAnswer(amexAnswer);
    expect(parsed.status).toBe("parsed");
    if (parsed.status !== "parsed") {
      return;
    }
    expect(parsed.changes).toEqual([]);
    expect(parsed.problems).toEqual([]);
    expect(parsed.prose.length).toBeGreaterThan(0);
  });
});

const REFUSED_PATHS: [string, PathViolation][] = [
  [`${BANK_PATH}/README.md`, "bank-root"],
  [`${BANK_PATH}/formats/legacy/Формат_1.txt`, "invalid-path"],
  [`${BANK_PATH}/formats/Формат_1.md`, "invalid-path"],
  [`${BANK_PATH}/formats/Формат-1.txt`, "invalid-path"],
  [`${BANK_PATH}/formats/.txt`, "invalid-path"],
  [`${BANK_PATH}/formats/`, "invalid-path"],
  ["src/Halyk Bank-kz_15/formats/Формат_1.txt", "other-bank"],
  [`${BANK_PATH}/../Halyk Bank-kz_15/senders.txt`, "outside"],
  ["docs/adr/0017.md", "outside"],
  ["", "outside"],
];

describe("the boundary of what may be written", () => {
  it.each([
    `${BANK_PATH}/senders.txt`,
    `${BANK_PATH}/formats/Сбер счёт Зачисление пенсии р Баланс р_11792.txt`,
    `${BANK_PATH}/formats/KZT Spisanie s Karti 4 5_11500.txt`,
  ])("accepts %s", (path) => {
    expect(isImportablePath(path, BANK_PATH)).toBe(true);
  });

  it.each(REFUSED_PATHS)("refuses %s as %s", (path, violation) => {
    expect(isImportablePath(path, BANK_PATH)).toBe(false);
    expect(classifyPathViolation(path, BANK_PATH)).toBe(violation);
  });

  it("does not accept the bank folder of another bank as its own", () => {
    expect(
      isImportablePath(`${BANK_PATH}/senders.txt`, "src/Halyk Bank-kz_15")
    ).toBe(false);
  });
});
