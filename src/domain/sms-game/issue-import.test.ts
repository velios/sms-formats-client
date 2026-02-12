import { describe, expect, it } from "vitest";
import {
  ensureSmsGameIssueTitleMarker,
  isSmsGameIssue,
  parseIssueIdentifier,
  parseSmsGameIssueBody,
} from "./issue-import";

describe("parseIssueIdentifier", () => {
  it("accepts issue number and issue URL", () => {
    expect(parseIssueIdentifier("123")).toBe(123);
    expect(
      parseIssueIdentifier("https://github.com/zenmoney/sms-formats/issues/456")
    ).toBe(456);
  });

  it("returns null for invalid input", () => {
    expect(parseIssueIdentifier("")).toBeNull();
    expect(parseIssueIdentifier("abc")).toBeNull();
  });
});

describe("parseSmsGameIssueBody", () => {
  it("parses bank and format blocks", () => {
    const issueBody = [
      "# SMS Markup Game Export",
      "",
      "- Bank: `Т-Банк`",
      "- Formats: 1",
      "",
      "### Senders",
      "```text",
      "900",
      "ALFABANK",
      "```",
      "",
      "## Format 1",
      "",
      "### Source SMS",
      "```text",
      "Покупка 100 RUB Coffee Shop",
      "```",
      "",
      "### Template",
      "```text",
      "Покупка ${outcome} ${instrument} ${payee}",
      "```",
      "",
      "### Placeholders",
      "```text",
      "outcome",
      "instrument",
      "payee",
      "```",
      "",
      "### Similar SMS",
      "```text",
      "Покупка 120 RUB Bakery",
      "",
      "Покупка 300 RUB Market",
      "```",
    ].join("\n");

    const parsed = parseSmsGameIssueBody(issueBody);
    expect(parsed.bankName).toBe("Т-Банк");
    expect(parsed.senders).toBe("900\nALFABANK");
    expect(parsed.formats).toHaveLength(1);
    expect(parsed.formats[0]?.template).toBe(
      "Покупка ${outcome} ${instrument} ${payee}"
    );
    expect(parsed.formats[0]?.similarExamples).toEqual([
      "Покупка 120 RUB Bakery",
      "Покупка 300 RUB Market",
    ]);
  });
});

describe("sms game issue marker", () => {
  it("adds marker to title when missing", () => {
    expect(ensureSmsGameIssueTitleMarker("SMS markup: T-Bank")).toBe(
      "SMS markup: T-Bank [from sms-formats-client]"
    );
  });

  it("detects marked issue by title or body", () => {
    expect(
      isSmsGameIssue({ title: "Task [from sms-formats-client]", body: "" })
    ).toBe(true);
    expect(
      isSmsGameIssue({ title: "Task", body: "# SMS Markup Game Export\n..." })
    ).toBe(true);
    expect(isSmsGameIssue({ title: "Task", body: "plain body" })).toBe(false);
  });
});
