import { serve } from "bun";
import { Bot, webhookCallback } from "grammy";
import type { UserFromGetMe } from "grammy/types";
import { loadBotEnv } from "./env";
import { respondToMessage } from "./respond";

const env = loadBotEnv();

// Offline dry-run can't call getMe (dummy token), so hand grammY a synthetic
// identity. Only the token matters for answerGuestQuery; botInfo is unused here.
const DRY_RUN_BOT_INFO: UserFromGetMe = {
  id: 0,
  is_bot: true,
  first_name: "Recognition Bot",
  username: "zenmoneysms_bot",
  can_join_groups: false,
  can_read_all_group_messages: false,
  can_manage_bots: false,
  supports_inline_queries: false,
  can_connect_to_business: false,
  has_main_web_app: false,
  has_topics_enabled: false,
  allows_users_to_create_topics: false,
};

const bot = new Bot(env.token, env.dryRun ? { botInfo: DRY_RUN_BOT_INFO } : {});

// Guest Mode (Bot API 10.0): an @mention or reply in any chat arrives as a
// `guest_message`, answered exactly once via `answerGuestQuery`. We never log
// the raw SMS; only the rendered format list (which contains no SMS content).
bot.on("guest_message", async (ctx) => {
  const message = ctx.guestMessage;
  if (!message) {
    return;
  }
  const body = respondToMessage({
    text: message.text,
    entities: message.entities,
    replyToText: message.reply_to_message?.text,
  });

  if (env.dryRun) {
    process.stdout.write(`${body}\n`);
    return;
  }
  await ctx.answerGuestQuery({
    type: "article",
    id: "recognition",
    title: "Распознанные форматы",
    input_message_content: { message_text: body },
  });
});

const handleUpdate = webhookCallback(bot, "std/http", {
  secretToken: env.webhookSecret,
});

if (!env.dryRun) {
  await bot.init();
}

serve({
  port: env.port,
  fetch(req) {
    const url = new URL(req.url);
    if (req.method === "POST" && url.pathname === env.webhookPath) {
      return handleUpdate(req);
    }
    return new Response("Not Found", { status: 404 });
  },
});

process.stdout.write(
  `Recognition Bot webhook listening on :${env.port}${env.webhookPath}` +
    (env.dryRun ? " (dry-run: replies printed, not sent)" : "") +
    "\n"
);
