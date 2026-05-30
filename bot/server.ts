import { serve } from "bun";
import { Bot, webhookCallback } from "grammy";
import type { UserFromGetMe } from "grammy/types";
import { answerGuestMessage } from "./answer-guest-message";
import { buildMainCorpus, buildOpenPrsCorpus, openPrCount } from "./corpus";
import { loadBotEnv } from "./env";
import { ensureMainCheckout } from "./main-checkout";
import { listOpenPullRequests } from "./pull-requests";

const env = loadBotEnv();

// Materialise the corpus from a real git checkout (clone on first boot, disk on
// restart — see ADR-0004) before serving. `main` formats plus, per open PR, the
// formats it adds/modifies — each recognized format links to its file at its
// own SHA. Open PRs are enumerated via the single REST call git can't replace;
// their heads and diffs travel over git.
const checkout = ensureMainCheckout({
  repoSlug: env.sourceRepo,
  branch: env.sourceBranch,
  dir: env.checkoutDir,
  token: env.githubToken,
});
const mainCorpus = buildMainCorpus(checkout);
const openPrs = await listOpenPullRequests({
  repoSlug: env.sourceRepo,
  token: env.githubToken,
});
const prCorpus = buildOpenPrsCorpus(checkout, openPrs, {
  onSkip: (pr, error) =>
    process.stderr.write(
      `Skipping PR #${pr.number} in corpus build: ${error}\n`
    ),
});
const corpus = [...mainCorpus, ...prCorpus];

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
// `guest_message`, answered exactly once via `answerGuestQuery`. We never log
// the raw SMS; only the rendered format list (which contains no SMS content).
// A failed answer is swallowed inside the handler — see answer-guest-message.ts
// for why webhookCallback must never return 500 here.
bot.on("guest_message", (ctx) =>
  answerGuestMessage(ctx, corpus, { dryRun: env.dryRun })
);

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
    ` — corpus: ${mainCorpus.length} main @ ${checkout.sha.slice(0, 7)}` +
    ` + ${prCorpus.length} formats across ${openPrCount(corpus)} open PRs` +
    (env.dryRun ? " (dry-run: replies printed, not sent)" : "") +
    "\n"
);
