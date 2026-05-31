import { existsSync } from "node:fs";
import { join } from "node:path";
import { serve } from "bun";
import { Bot, webhookCallback } from "grammy";
import type { UserFromGetMe } from "grammy/types";
import { answerGuestMessage } from "./answer-guest-message";
import { answerPrivateMessage } from "./answer-private-message";
import { buildMainCorpus } from "./corpus";
import { buildSnapshot, CorpusStore } from "./corpus-store";
import { createCorpusSync } from "./corpus-sync";
import { loadBotEnv } from "./env";
import { ensureMainCheckout } from "./main-checkout";

const env = loadBotEnv();

// The corpus is kept fresh on demand, not at boot (ADR-0004). A request outside
// the TTL window kicks one background freshness check — two conditional ETag
// GETs (main ref + open-PR list); only moved refs are pulled as git deltas and
// the snapshot is swapped in atomically. Failures serve the last good snapshot.
const store = new CorpusStore({
  ttlMs: env.freshnessTtlMs,
  sync: createCorpusSync({
    repoSlug: env.sourceRepo,
    branch: env.sourceBranch,
    dir: env.checkoutDir,
    token: env.githubToken,
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

// A restart over an existing disk checkout is not a re-clone: seed the snapshot
// from disk (main half) so the first request answers from it, while the open TTL
// gate makes that same request trigger the first freshness check — which folds
// in open-PR formats and any main delta. A wiped disk has nothing to seed; the
// first request then clones in the background and meanwhile gets the cold-start
// stub (see answer-guest-message.ts).
if (existsSync(join(env.checkoutDir, ".git"))) {
  const checkout = ensureMainCheckout({
    repoSlug: env.sourceRepo,
    branch: env.sourceBranch,
    dir: env.checkoutDir,
    token: env.githubToken,
  });
  store.seed(buildSnapshot(buildMainCorpus(checkout), checkout.sha));
}

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

// Outbound Telegram API calls (getMe, answerGuestQuery) go through a local
// HTTP proxy when RECOGNITION_BOT_PROXY_URL is set; the inbound webhook served
// by Bun.serve is unaffected.
const bot = new Bot(env.token, {
  ...(env.dryRun ? { botInfo: DRY_RUN_BOT_INFO } : {}),
  ...(env.proxyUrl
    ? { client: { baseFetchConfig: { proxy: env.proxyUrl } } }
    : {}),
});

// Guest Mode (Bot API 10.0): an @mention or reply in any chat arrives as a
// `guest_message`, answered exactly once via `answerGuestQuery`. The request
// drives freshness (noteDemand) and is answered from the current snapshot —
// fresh or not — or the initializing stub before the first build. We never log
// the raw SMS; only the rendered format list (which contains no SMS content).
// A failed answer is swallowed inside the handler — see answer-guest-message.ts
// for why webhookCallback must never return 500 here.
bot.on("guest_message", (ctx) => {
  store.noteDemand();
  return answerGuestMessage(ctx, store.current, {
    dryRun: env.dryRun,
  });
});

// Direct invocation: a private-chat message is the second way to reach the same
// Recognition (CONTEXT.md). Group messages stay on the guest path — only DMs are
// handled here, so the bot never answers unprompted in a group. Like the guest
// path, the request drives freshness and is answered from the current snapshot
// (or the initializing stub before the first build). The raw SMS is never logged.
bot.on("message", (ctx) => {
  if (ctx.chat.type !== "private") {
    return;
  }
  store.noteDemand();
  return answerPrivateMessage(ctx, store.current, {
    dryRun: env.dryRun,
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
