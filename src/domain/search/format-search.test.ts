import { describe, expect, it } from "vitest";
import {
  type FormatSearchDoc,
  matchAndScore,
  normalizeSearchText,
  searchFormatPaths,
} from "./format-search";

function buildDoc(
  path: string,
  params: Pick<FormatSearchDoc, "name" | "exampleText">
): FormatSearchDoc {
  return {
    path,
    name: params.name,
    exampleText: params.exampleText,
    isLoaded: true,
    source: "remote",
  };
}

describe("format-search", () => {
  it("matches format by example text", () => {
    const paths = ["src/Bank/formats/a.txt", "src/Bank/formats/b.txt"];
    const docs = new Map<string, FormatSearchDoc>([
      [
        paths[0]!,
        buildDoc(paths[0]!, {
          name: "alpha.txt",
          exampleText:
            "*7481 08.10 15:38 spisanie 252.50p YARCHE, Balans 12207.31p",
        }),
      ],
      [
        paths[1]!,
        buildDoc(paths[1]!, {
          name: "beta.txt",
          exampleText: "vozvrat 42.00p",
        }),
      ],
    ]);

    const result = searchFormatPaths({
      formatPaths: paths,
      query: "spisanie yarche",
      docsByPath: docs,
    });

    expect(result).toEqual([paths[0]]);
  });

  it("prefers exact name match over fuzzy-only match", () => {
    const paths = ["src/Bank/formats/a.txt", "src/Bank/formats/b.txt"];
    const docs = new Map<string, FormatSearchDoc>([
      [
        paths[0]!,
        buildDoc(paths[0]!, {
          name: "spisanie_yarche.txt",
          exampleText: "",
        }),
      ],
      [
        paths[1]!,
        buildDoc(paths[1]!, {
          name: "sms.txt",
          exampleText: "s p i s a n i e y a r c h e",
        }),
      ],
    ]);

    const result = searchFormatPaths({
      formatPaths: paths,
      query: "spisanie yarche",
      docsByPath: docs,
    });

    expect(result).toEqual([paths[0], paths[1]]);
  });

  it("normalizes case and spaces", () => {
    const doc = buildDoc("src/Bank/formats/a.txt", {
      name: "alpha",
      exampleText: "Spisanie    252.50P",
    });
    const score = matchAndScore(doc, "  spisanie 252.50p  ");

    expect(normalizeSearchText("  Spisanie    252.50P ")).toBe(
      "spisanie 252.50p"
    );
    expect(score).not.toBeNull();
  });

  it("returns original order for empty query", () => {
    const paths = ["src/Bank/formats/2.txt", "src/Bank/formats/1.txt"];
    const docs = new Map<string, FormatSearchDoc>();

    const result = searchFormatPaths({
      formatPaths: paths,
      query: "   ",
      docsByPath: docs,
    });

    expect(result).toEqual(paths);
  });

  it("does not crash when example is absent", () => {
    const paths = ["src/Bank/formats/spisanie.txt"];
    const docs = new Map<string, FormatSearchDoc>([
      [
        paths[0]!,
        {
          path: paths[0]!,
          name: "spisanie.txt",
          exampleText: "",
          isLoaded: true,
          source: "remote-error",
        },
      ],
    ]);

    const result = searchFormatPaths({
      formatPaths: paths,
      query: "spisanie",
      docsByPath: docs,
    });

    expect(result).toEqual(paths);
  });
});
