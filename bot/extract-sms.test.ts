import { describe, expect, it } from "vitest";
import { extractDirectSms, extractSms } from "./extract-sms";

describe("extractSms", () => {
  it("prefers reply_to_message over inline text", () => {
    const result = extractSms({
      text: "@zenmoneysms_bot",
      entities: [{ type: "mention", offset: 0, length: 16 }],
      replyToText: "Pokupka 1000 RUB",
    });
    expect(result).toEqual({ kind: "sms", sms: "Pokupka 1000 RUB" });
  });

  it("keeps the replied-to SMS verbatim, including newlines", () => {
    const result = extractSms({
      replyToText: "Pokupka 1000 RUB\nDostupno 5000",
    });
    expect(result).toEqual({
      kind: "sms",
      sms: "Pokupka 1000 RUB\nDostupno 5000",
    });
  });

  it("strips a leading @mention from inline text via entities", () => {
    const result = extractSms({
      text: "@zenmoneysms_bot Pokupka 1000 RUB",
      entities: [{ type: "mention", offset: 0, length: 16 }],
    });
    expect(result).toEqual({ kind: "sms", sms: "Pokupka 1000 RUB" });
  });

  it("strips a mention in the middle and collapses the gap", () => {
    const result = extractSms({
      text: "Pokupka @zenmoneysms_bot 1000 RUB",
      entities: [{ type: "mention", offset: 8, length: 16 }],
    });
    expect(result).toEqual({ kind: "sms", sms: "Pokupka 1000 RUB" });
  });

  it("strips @mentions textually when no entities are provided", () => {
    const result = extractSms({ text: "@zenmoneysms_bot Spisanie 50 RUB" });
    expect(result).toEqual({ kind: "sms", sms: "Spisanie 50 RUB" });
  });

  it("reports empty when only a mention is present", () => {
    const result = extractSms({
      text: "@zenmoneysms_bot",
      entities: [{ type: "mention", offset: 0, length: 16 }],
    });
    expect(result).toEqual({ kind: "empty" });
  });

  it("reports empty for a blank reply and blank inline text", () => {
    expect(extractSms({ replyToText: "   ", text: "" })).toEqual({
      kind: "empty",
    });
  });
});

describe("extractDirectSms", () => {
  it("takes the whole message text verbatim, including newlines", () => {
    const result = extractDirectSms("Pokupka 1000 RUB\nDostupno 5000");
    expect(result).toEqual({
      kind: "sms",
      sms: "Pokupka 1000 RUB\nDostupno 5000",
    });
  });

  it("does not strip @mentions — in a DM they are part of the SMS", () => {
    const result = extractDirectSms("@zenmoneysms_bot Pokupka 1000 RUB");
    expect(result).toEqual({
      kind: "sms",
      sms: "@zenmoneysms_bot Pokupka 1000 RUB",
    });
  });

  it("reports empty for /start and /help", () => {
    expect(extractDirectSms("/start")).toEqual({ kind: "empty" });
    expect(extractDirectSms("/help")).toEqual({ kind: "empty" });
  });

  it("reports empty for a textless message", () => {
    expect(extractDirectSms(undefined)).toEqual({ kind: "empty" });
  });

  it("reports empty for blank text", () => {
    expect(extractDirectSms("   ")).toEqual({ kind: "empty" });
  });
});
