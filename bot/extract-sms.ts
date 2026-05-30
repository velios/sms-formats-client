/**
 * Input contract for the Recognition Bot (ADR-0006).
 *
 * Extraction no longer answers "SMS or not" but resolves the whole response
 * outcome into an `Intent`: recognize this SMS, reply with this hint text, or
 * stay silent. The mode difference (guest vs. direct) lives entirely in the two
 * extractors; `respond` is mode-agnostic.
 *
 * Guest recognition requires a leading `/sms` token (a bare @mention/reply is
 * silence — someone talking *about* the bot, not summoning it). Direct chats
 * recognize bare text too; there `/sms` is optional and may carry the `@bot`
 * suffix. The SMS itself is kept device-identical — recognition normalizes it
 * later, not us.
 */

import { CONFLICT_HINT, DIRECT_USAGE_HINT, GUEST_USAGE_HINT } from "./render";

export interface MessageEntityLike {
  type: string;
  offset: number;
  length: number;
}

export interface IncomingMessage {
  text?: string;
  entities?: MessageEntityLike[];
  /** Text of `reply_to_message`, if the user replied to an SMS. */
  replyToText?: string;
  /** Quoted fragment of the replied-to message; wins over `replyToText`. */
  quoteText?: string;
}

export type Intent =
  | { kind: "sms"; sms: string }
  | { kind: "hint"; text: string }
  | { kind: "silent" };

/** Direct invocation never goes silent — bare text is always an SMS. */
export type DirectIntent = Exclude<Intent, { kind: "silent" }>;

function stripMentions(text: string, entities: MessageEntityLike[]): string {
  const mentions = entities
    .filter((e) => e.type === "mention" || e.type === "text_mention")
    .sort((a, b) => b.offset - a.offset);

  let out = text;
  for (const mention of mentions) {
    out =
      out.slice(0, mention.offset) + out.slice(mention.offset + mention.length);
  }
  if (mentions.length === 0) {
    out = out.replace(/@\w+/g, "");
  }
  // Collapse the whitespace left by the removed mention. Newlines are folded
  // too, which is harmless: recognition's normalization would fold them anyway.
  return out.replace(/\s+/g, " ").trim();
}

// Match a leading `/sms` token, case-insensitive, boundary = space or end of
// string (so `/smskaspi` is not the command). The token is sliced off before
// recognition, exactly like the @mention. Guest forbids the `@bot` suffix:
// `/sms@zenmoneysms_bot` is a single `bot_command` entity with no `mention`, so
// the guest bot is never summoned by it — only direct chats see that form.
function matchSmsToken(
  remainder: string,
  allowBotSuffix: boolean
): { matched: boolean; payload: string } {
  const re = allowBotSuffix
    ? /^\/sms(@zenmoneysms_bot)?(\s+|$)/i
    : /^\/sms(\s+|$)/i;
  const m = remainder.match(re);
  if (!m) {
    return { matched: false, payload: "" };
  }
  return { matched: true, payload: remainder.slice(m[0].length).trim() };
}

/**
 * Guest invocation: after stripping the mention, recognition requires a leading
 * `/sms`. No token → silence. With the token, the SMS comes from the reply (the
 * quoted fragment if present, else the whole replied-to message) or the payload
 * after `/sms`; giving both is a conflict, giving neither asks for usage.
 */
export function extractSms(message: IncomingMessage): Intent {
  const remainder = stripMentions(message.text ?? "", message.entities ?? []);
  const { matched, payload } = matchSmsToken(remainder, false);
  if (!matched) {
    return { kind: "silent" };
  }

  // A quoted fragment is the user's chosen SMS; it overrides the full reply.
  const effectiveReply = message.quoteText?.trim()
    ? message.quoteText
    : message.replyToText?.trim()
      ? message.replyToText
      : undefined;
  const hasPayload = payload !== "";

  if (effectiveReply !== undefined && hasPayload) {
    return { kind: "hint", text: CONFLICT_HINT };
  }
  if (effectiveReply !== undefined) {
    return { kind: "sms", sms: effectiveReply };
  }
  if (hasPayload) {
    return { kind: "sms", sms: payload };
  }
  return { kind: "hint", text: GUEST_USAGE_HINT };
}

// Onboarding taps, not SMS: Telegram's Start button sends `/start`, and `/help`
// is the conventional sibling. Recognizing these would answer "needs a new
// format", so they get the usage hint instead.
const SERVICE_COMMANDS = new Set(["/start", "/help"]);

/**
 * Direct invocation (private chat): bare text is the SMS verbatim. A leading
 * `/sms` (with or without the `@bot` suffix) is sliced off, recognizing the
 * payload; an empty `/sms` and service commands carry no SMS and ask for the
 * usage hint. Never goes silent — see `DirectIntent`.
 */
export function extractDirectSms(text: string | undefined): DirectIntent {
  if (text === undefined) {
    return { kind: "hint", text: DIRECT_USAGE_HINT };
  }
  const trimmed = text.trim();
  if (!trimmed || SERVICE_COMMANDS.has(trimmed)) {
    return { kind: "hint", text: DIRECT_USAGE_HINT };
  }
  const { matched, payload } = matchSmsToken(trimmed, true);
  if (matched) {
    if (payload === "") {
      return { kind: "hint", text: DIRECT_USAGE_HINT };
    }
    return { kind: "sms", sms: payload };
  }
  return { kind: "sms", sms: text };
}
