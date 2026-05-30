import { describe, expect, it } from "vitest";
import { extractDirectSms, extractSms } from "./extract-sms";
import { CONFLICT_HINT, DIRECT_USAGE_HINT, GUEST_USAGE_HINT } from "./render";

// A leading @mention entity for "@zenmoneysms_bot" (16 chars at offset 0).
const MENTION = { type: "mention", offset: 0, length: 16 };

describe("extractSms (guest)", () => {
  it("silences a bare mention with no /sms (talking about the bot)", () => {
    expect(
      extractSms({ text: "@zenmoneysms_bot", entities: [MENTION] })
    ).toEqual({ kind: "silent" });
  });

  it("silences a mention with chatter but no /sms", () => {
    expect(
      extractSms({ text: "@zenmoneysms_bot попробуй его", entities: [MENTION] })
    ).toEqual({ kind: "silent" });
  });

  it("silences a reply when /sms is absent", () => {
    expect(
      extractSms({
        text: "@zenmoneysms_bot",
        entities: [MENTION],
        replyToText: "Pokupka 1000 RUB",
      })
    ).toEqual({ kind: "silent" });
  });

  it("silences /smskaspi — no token boundary", () => {
    expect(
      extractSms({ text: "@zenmoneysms_bot /smskaspi", entities: [MENTION] })
    ).toEqual({ kind: "silent" });
  });

  it("recognizes the reply text when /sms has no payload", () => {
    expect(
      extractSms({
        text: "@zenmoneysms_bot /sms",
        entities: [MENTION],
        replyToText: "Pokupka 1000 RUB",
      })
    ).toEqual({ kind: "sms", sms: "Pokupka 1000 RUB" });
  });

  it("recognizes the payload after /sms when there is no reply", () => {
    expect(
      extractSms({
        text: "@zenmoneysms_bot /sms Spisanie 50 RUB",
        entities: [MENTION],
      })
    ).toEqual({ kind: "sms", sms: "Spisanie 50 RUB" });
  });

  it("returns the conflict hint when reply and payload are both given", () => {
    expect(
      extractSms({
        text: "@zenmoneysms_bot /sms Spisanie 50 RUB",
        entities: [MENTION],
        replyToText: "Pokupka 1000 RUB",
      })
    ).toEqual({ kind: "hint", text: CONFLICT_HINT });
  });

  it("returns the guest usage hint for /sms with neither reply nor payload", () => {
    expect(
      extractSms({ text: "@zenmoneysms_bot /sms", entities: [MENTION] })
    ).toEqual({ kind: "hint", text: GUEST_USAGE_HINT });
  });

  it("prefers the quoted fragment over the full replied-to text", () => {
    expect(
      extractSms({
        text: "@zenmoneysms_bot /sms",
        entities: [MENTION],
        replyToText: "шум: Pokupka 1000 RUB",
        quoteText: "Pokupka 1000 RUB",
      })
    ).toEqual({ kind: "sms", sms: "Pokupka 1000 RUB" });
  });

  it("matches /sms case-insensitively and keeps the reply verbatim with newlines", () => {
    expect(
      extractSms({
        text: "@zenmoneysms_bot /SMS",
        entities: [MENTION],
        replyToText: "Pokupka 1000 RUB\nDostupno 5000",
      })
    ).toEqual({ kind: "sms", sms: "Pokupka 1000 RUB\nDostupno 5000" });
  });
});

describe("extractDirectSms (direct)", () => {
  it("takes bare text verbatim, including newlines", () => {
    expect(extractDirectSms("Pokupka 1000 RUB\nDostupno 5000")).toEqual({
      kind: "sms",
      sms: "Pokupka 1000 RUB\nDostupno 5000",
    });
  });

  it("does not strip @mentions — in a DM they are part of the SMS", () => {
    expect(extractDirectSms("@zenmoneysms_bot Pokupka 1000 RUB")).toEqual({
      kind: "sms",
      sms: "@zenmoneysms_bot Pokupka 1000 RUB",
    });
  });

  it("strips a leading /sms and recognizes the payload", () => {
    expect(extractDirectSms("/sms Pokupka 1000 RUB")).toEqual({
      kind: "sms",
      sms: "Pokupka 1000 RUB",
    });
  });

  it("strips the /sms@bot suffix form (equal to /sms in a DM)", () => {
    expect(extractDirectSms("/sms@zenmoneysms_bot 100 RUB")).toEqual({
      kind: "sms",
      sms: "100 RUB",
    });
  });

  it("recognizes /smskaspi verbatim — no token boundary", () => {
    expect(extractDirectSms("/smskaspi купи")).toEqual({
      kind: "sms",
      sms: "/smskaspi купи",
    });
  });

  it("returns the direct usage hint for an empty /sms", () => {
    expect(extractDirectSms("/sms")).toEqual({
      kind: "hint",
      text: DIRECT_USAGE_HINT,
    });
  });

  it("returns the direct usage hint for /start and /help", () => {
    expect(extractDirectSms("/start")).toEqual({
      kind: "hint",
      text: DIRECT_USAGE_HINT,
    });
    expect(extractDirectSms("/help")).toEqual({
      kind: "hint",
      text: DIRECT_USAGE_HINT,
    });
  });

  it("returns the direct usage hint for a textless message", () => {
    expect(extractDirectSms(undefined)).toEqual({
      kind: "hint",
      text: DIRECT_USAGE_HINT,
    });
  });

  it("returns the direct usage hint for blank text", () => {
    expect(extractDirectSms("   ")).toEqual({
      kind: "hint",
      text: DIRECT_USAGE_HINT,
    });
  });
});
