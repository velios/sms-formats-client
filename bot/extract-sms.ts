/**
 * Input contract for the Recognition Bot.
 *
 * A `reply_to_message` is the SMS verbatim (kept device-identical — recognition
 * normalizes it later, not us). Otherwise the inline text minus the @mention is
 * the SMS. An empty call (nothing left to recognize) asks for a usage hint.
 */

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
}

export type ExtractedSms = { kind: "sms"; sms: string } | { kind: "empty" };

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

export function extractSms(message: IncomingMessage): ExtractedSms {
  if (message.replyToText?.trim()) {
    return { kind: "sms", sms: message.replyToText };
  }
  const inline = stripMentions(message.text ?? "", message.entities ?? []);
  if (!inline) {
    return { kind: "empty" };
  }
  return { kind: "sms", sms: inline };
}
