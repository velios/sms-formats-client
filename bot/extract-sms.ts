import { CONFLICT_HINT, DIRECT_USAGE_HINT, GUEST_USAGE_HINT } from "./render";

export interface MessageEntityLike {
  type: string;
  offset: number;
  length: number;
}

export interface IncomingMessage {
  text?: string;
  entities?: MessageEntityLike[];
  replyToText?: string;
  quoteText?: string;
}

export type Intent =
  | { kind: "sms"; sms: string }
  | { kind: "hint"; text: string }
  | { kind: "silent" };

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
  return out.trim();
}

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

export function extractSms(message: IncomingMessage): Intent {
  const remainder = stripMentions(message.text ?? "", message.entities ?? []);
  const { matched, payload } = matchSmsToken(remainder, false);
  if (!matched) {
    return { kind: "silent" };
  }

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

const SERVICE_COMMANDS = new Set(["/start", "/help"]);

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
