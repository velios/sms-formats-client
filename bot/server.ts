import { existsSync } from "node:fs";
import { join } from "node:path";
import { serve } from "bun";
import { Bot, type Context, webhookCallback } from "grammy";
import type { UserFromGetMe } from "grammy/types";
import {
  answerGuestMessage,
  answerPrivateMessage,
  type DeliveryFailure,
} from "./answer";
import { buildMainCorpus } from "./corpus";
import { buildSnapshot, CorpusStore } from "./corpus-store";
import { createCorpusSync } from "./corpus-sync";
import { loadBotEnv } from "./env";
import { notifyAdmin } from "./incidents";
import { ensureMainCheckout } from "./main-checkout";

const env = loadBotEnv();

const store = new CorpusStore({
  ttlMs: env.freshnessTtlMs,
  sync: createCorpusSync({
    repoSlug: env.sourceRepo,
    branch: env.sourceBranch,
    dir: env.checkoutDir,
    token: env.githubToken,
    ...(env.offline
      ? {
          fetchImpl: (async () =>
            new Response(null, { status: 304 })) as unknown as typeof fetch,
        }
      : {}),
    onSkip: (pr, error) =>
      process.stderr.write(`Skipping PR #${pr.number} in corpus: ${error}\n`),
    onFreshnessError: (error) =>
      process.stderr.write(
        `Freshness check failed, building from on-disk corpus: ${error}\n`
      ),
  }),
  onError: (error) =>
    process.stderr.write(
      `Corpus refresh failed, serving last good snapshot: ${error}\n`
    ),
});

if (existsSync(join(env.checkoutDir, ".git"))) {
  const checkout = await ensureMainCheckout({
    repoSlug: env.sourceRepo,
    branch: env.sourceBranch,
    dir: env.checkoutDir,
    token: env.githubToken,
  });
  store.seed(buildSnapshot(buildMainCorpus(checkout), checkout.sha));
}

const DRY_RUN_BOT_INFO: UserFromGetMe = {
  id: 0,
  is_bot: true,
  first_name: "Recognition Bot",
  username: "zenmoneysms_bot",
  can_join_groups: false,
  can_read_all_group_messages: false,
  can_manage_bots: false,
  supports_inline_queries: false,
  supports_join_request_queries: false,
  can_connect_to_business: false,
  has_main_web_app: false,
  has_topics_enabled: false,
  allows_users_to_create_topics: false,
};

const bot = new Bot(env.token, {
  ...(env.dryRun ? { botInfo: DRY_RUN_BOT_INFO } : {}),
  ...(env.proxyUrl
    ? { client: { baseFetchConfig: { proxy: env.proxyUrl } } }
    : {}),
});

function answerOptions(ctx: Context) {
  const mainSha = store.current?.mainSha;
  const adminChatId = env.adminChatId;
  return {
    dryRun: env.dryRun,
    onDeliveryError: adminChatId
      ? (failure: DeliveryFailure) =>
          notifyAdmin(bot.api, adminChatId, ctx, failure, mainSha)
      : undefined,
  };
}

bot.on("guest_message", (ctx) => {
  store.noteDemand();
  return answerGuestMessage(ctx, store.current, answerOptions(ctx));
});

bot.on("message", (ctx) => {
  if (ctx.chat.type !== "private") {
    return;
  }
  store.noteDemand();
  return answerPrivateMessage(ctx, store.current, answerOptions(ctx));
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

const seeded = store.current;
process.stdout.write(
  `Recognition Bot webhook listening on :${env.port}${env.webhookPath}` +
    (seeded
      ? ` — seeded ${seeded.formats.length} main formats @ ${seeded.mainSha.slice(0, 7)} from disk`
      : " — cold start: first request clones then builds") +
    `; freshness is demand-driven (TTL ${env.freshnessTtlMs}ms)` +
    (env.dryRun ? " (dry-run: replies printed, not sent)" : "") +
    "\n"
);
