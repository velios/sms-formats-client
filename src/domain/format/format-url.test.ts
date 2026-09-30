import { expect, it } from "bun:test";
import { decodeRequestedFileValue } from "@/features/workspace/file-selection";
import {
  buildFormatUrl,
  decodeSmsPayload,
  encodeSmsPayload,
} from "./format-url";

it("preserves exact repository path and UTF-8 SMS through a head URL", () => {
  const filePath = 'src/Банк %20 & #/formats/"x".txt';
  const sms = " \nКод 😀 & <tag>\r\n ";
  for (const source of [
    { type: "main" } as const,
    { type: "pr", prNumber: 7 } as const,
  ]) {
    const url = new URL(
      buildFormatUrl({
        origin: "https://sms.zentable.ru",
        repository: { owner: "owner", repo: "repo" },
        source,
        filePath,
        sms,
      })
    );
    expect(decodeRequestedFileValue(url.searchParams)).toBe(filePath);
    expect(decodeSmsPayload(url.hash.slice("#add-sms=".length))).toBe(sms);
    expect(url.href).not.toContain("sha=");
  }
});
it("rejects non-canonical base64url and invalid UTF-8 without normalization", () => {
  for (const value of ["!", "YQ=", "YQ+", "A", "YR", "_w"]) {
    expect(decodeSmsPayload(value)).toBeNull();
  }
  for (const sms of ["", "  SMS\n", "😀\r\n "]) {
    expect(decodeSmsPayload(encodeSmsPayload(sms))).toBe(sms);
  }
});
