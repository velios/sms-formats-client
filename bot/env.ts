export interface BotEnv {
  token: string;
  webhookSecret: string;
  webhookPath: string;
  port: number;
  dryRun: boolean;
  offline: boolean;
  proxyUrl?: string;
  sourceRepo: string;
  sourceBranch: string;
  checkoutDir: string;
  githubToken?: string;
  freshnessTtlMs: number;
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
    offline: process.env.RECOGNITION_BOT_OFFLINE === "1",
    proxyUrl: process.env.RECOGNITION_BOT_PROXY_URL || undefined,
    sourceRepo:
      process.env.RECOGNITION_BOT_SOURCE_REPO || "zenmoney/sms-formats",
    sourceBranch: process.env.RECOGNITION_BOT_SOURCE_BRANCH || "main",
    checkoutDir:
      process.env.RECOGNITION_BOT_CHECKOUT_DIR || ".cache/sms-formats-main",
    githubToken: process.env.GITHUB_READONLY_TOKEN || undefined,
    freshnessTtlMs: Number(
      process.env.RECOGNITION_BOT_FRESHNESS_TTL_MS ?? "45000"
    ),
  };
}
