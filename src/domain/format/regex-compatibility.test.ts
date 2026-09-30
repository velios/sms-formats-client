import { describe, expect, it } from "bun:test";
import { restoreTestGlobals, setTestGlobal } from "@/test-globals";
import { checkCrossFormatCollisions, validateFormat } from "../validation";
import { parseFormatFile, serializeFormat } from "./parser";
import { analyzeRegexPattern } from "./pattern-analysis";
import {
  compileRegexes,
  recognizeWithCompiled,
  smsesByRegex,
} from "./recognition";
import {
  countCaptureGroups,
  normalizeSmsText,
  recognitionProgress,
  testRegex,
} from "./regex";
import cases from "./regex-compatibility-cases.json";
import { tryCompile } from "./regex-compiler";
import { buildRegex101Url } from "./regex101";
import {
  buildTokenToCaptureGroupMap,
  resolveCaptureGroupRange,
} from "./token-capture-map";

describe("upstream regex compatibility", () => {
  it.each(cases)("$id", (entry) => {
    const expected = "local" in entry ? entry.local : entry.upstream;
    if ("local" in entry) {
      expect(entry.reason).toBeTruthy();
      expect(entry.local).not.toEqual(entry.upstream);
    }
    const result = testRegex(entry.pattern, entry.sms);
    expect(result.error).toBeNull();
    expect(
      result.matched
        ? {
            match: result.fullMatch,
            groups: tryCompile(entry.pattern)
              .regex?.exec(normalizeSmsText(entry.sms))
              ?.slice(1)
              .map((value) => value ?? null),
          }
        : null
    ).toEqual<typeof expected>(expected);
    const recognized = expected !== null;
    expect(smsesByRegex([entry.sms], entry.pattern)).toEqual({
      error: null,
      matched: [recognized],
    });
    expect(
      recognizeWithCompiled(compileRegexes([entry.pattern]), entry.sms)
    ).toEqual([{ error: null, matched: recognized }]);
    const analysis = analyzeRegexPattern(entry.pattern);
    expect(analysis.canHighlightPattern).toBe(true);
    expect(analysis.patternTokens.map((token) => token.raw).join("")).toBe(
      entry.pattern
    );
  });

  it("keeps source offsets, capture numbering and recognition progress", () => {
    const pattern = "(?i)^(код) (\\d+) USD$";
    const { patternTokens } = analyzeRegexPattern(pattern);
    expect(patternTokens[0]).toMatchObject({
      type: "flag",
      raw: "(?i)",
      start: 0,
      end: 4,
    });
    expect(buildTokenToCaptureGroupMap(patternTokens)[0]).toBeNull();
    const range = resolveCaptureGroupRange(patternTokens, 1)!;
    expect(pattern.slice(range.start, range.end)).toBe("(код)");
    expect(countCaptureGroups(pattern)).toBe(2);
    const sms = "КОД 123 RUB";
    const progress = recognitionProgress(pattern, sms)!;
    expect(progress).not.toBeNull();
    expect(progress.groups.map((group) => group.value)).toEqual(["КОД", "123"]);
    expect(pattern.slice(progress.prefixPatternEnd)).toBe(" USD$");
    expect(sms.slice(0, progress.prefixEnd)).toBe("КОД 123");
  });

  it("validates and serializes the original inline flag", () => {
    const pattern = "(?i)^(код) (\\d+)$";
    const content = serializeFormat(
      pattern,
      ["comment", "instrument"],
      ["КОД 123"]
    );
    const parsed = parseFormatFile(content, "test.txt");
    expect(parsed.regex).toBe(pattern);
    expect(validateFormat(parsed, "test.txt")).toEqual([]);
    expect(
      validateFormat({ ...parsed, columns: ["comment"] }, "test.txt")
    ).toContainEqual(expect.objectContaining({ code: "GROUP_COUNT_MISMATCH" }));
  });

  it("preserves syntax errors after adapting the flag", () => {
    for (const pattern of ["(?i)[", "(?i)(", "abc(?i)def"]) {
      expect(tryCompile(pattern).regex).toBeNull();
      expect(countCaptureGroups(pattern)).toBeNull();
      expect(analyzeRegexPattern(pattern).canHighlightPattern).toBe(false);
    }
  });

  it("keeps case-insensitive execution when indices are unavailable", () => {
    const NativeRegExp = RegExp;
    class WithoutIndices extends NativeRegExp {
      constructor(pattern: string, flags = "") {
        if (flags.includes("d")) {
          throw new SyntaxError("Indices unavailable");
        }
        super(pattern, flags);
      }
    }
    setTestGlobal("RegExp", WithoutIndices);
    try {
      const compiled = tryCompile("(?i)^(код)$");
      expect(compiled.supportsIndices).toBe(false);
      expect(compiled.regex?.exec("КОД")?.[1]).toBe("КОД");
    } finally {
      restoreTestGlobals();
    }
  });

  it("includes case-insensitive recognition in bank collisions", () => {
    const formats = [
      {
        filePath: "a.txt",
        parsed: parseFormatFile(
          serializeFormat("(?i)^код$", [], ["код"]),
          "a.txt"
        ),
      },
      {
        filePath: "b.txt",
        parsed: parseFormatFile(serializeFormat("^КОД$", [], ["КОД"]), "b.txt"),
      },
    ];
    expect(checkCrossFormatCollisions(formats)).toContainEqual(
      expect.objectContaining({ code: "EXAMPLE_COLLISION", filePath: "b.txt" })
    );
  });

  it("exports the execution flag to regex101 without duplicating it", () => {
    const url = new URL(buildRegex101Url("(?i)код", "КОД", { flags: "im" }));
    expect(url.searchParams.get("regex")).toBe("код");
    expect(url.searchParams.get("flags")).toBe("im");
  });
});
