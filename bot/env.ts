/**
 * Server-side bot configuration. Secrets live in `bot/.env` (gitignored, see
 * `bot/.env.example`) and are loaded by Bun / the systemd unit — never hardcoded
 * and never exposed to the frontend bundle.
 */

export interface BotEnv {
  token: string;
  webhookSecret: string;
  webhookPath: string;
  port: number;
  dryRun: boolean;
  /**
   * Optional HTTP proxy for outbound Telegram API calls. Needed where direct
   * egress to api.telegram.org is blocked and a local bridge must be used.
   */
  proxyUrl?: string;
  /** Source repo (`owner/repo`) whose main the corpus is built from. */
  sourceRepo: string;
  /** Branch cloned as the `main` corpus. */
  sourceBranch: string;
  /** Local checkout directory; reused across restarts, never re-cloned. */
  checkoutDir: string;
  /** Read-only token for cloning; empty clones the public repo anonymously. */
  githubToken?: string;
}

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required env var ${name} (see bot/.env.example)`);
  }
  return value;
}

function normalizePath(path: string): string {
  return path.startsWith("/") ? path : `/${path}`;
}

export function loadBotEnv(): BotEnv {
  return {
    token: required("RECOGNITION_BOT_TOKEN"),
    webhookSecret: required("RECOGNITION_BOT_WEBHOOK_SECRET"),
    webhookPath: normalizePath(required("RECOGNITION_BOT_WEBHOOK_PATH")),
    port: Number(process.env.RECOGNITION_BOT_PORT ?? "8080"),
    dryRun: process.env.RECOGNITION_BOT_DRY_RUN === "1",
    proxyUrl: process.env.RECOGNITION_BOT_PROXY_URL || undefined,
    sourceRepo:
      process.env.RECOGNITION_BOT_SOURCE_REPO || "zenmoney/sms-formats",
    sourceBranch: process.env.RECOGNITION_BOT_SOURCE_BRANCH || "main",
    checkoutDir:
      process.env.RECOGNITION_BOT_CHECKOUT_DIR || ".cache/sms-formats-main",
    githubToken: process.env.GITHUB_READONLY_TOKEN || undefined,
  };
}
