import { afterEach, describe, expect, it } from "bun:test";
import { loadBotEnv } from "./env";

const keys = [
  "RECOGNITION_BOT_TOKEN",
  "RECOGNITION_BOT_WEBHOOK_SECRET",
  "RECOGNITION_BOT_WEBHOOK_PATH",
  "RECOGNITION_BOT_ADMIN_CHAT_ID",
] as const;
const original = keys.map((key) => process.env[key]);

afterEach(() => {
  keys.forEach((key, index) => {
    const value = original[index];
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  });
});

describe("admin chat configuration", () => {
  it.each([undefined, "", "   "])(
    "disables notifications for an absent or blank chat: %s",
    (value) => {
      process.env.RECOGNITION_BOT_TOKEN = "local-token";
      process.env.RECOGNITION_BOT_WEBHOOK_SECRET = "local-secret";
      process.env.RECOGNITION_BOT_WEBHOOK_PATH = "/local";
      if (value === undefined) {
        delete process.env.RECOGNITION_BOT_ADMIN_CHAT_ID;
      } else {
        process.env.RECOGNITION_BOT_ADMIN_CHAT_ID = value;
      }

      expect(loadBotEnv().adminChatId).toBeUndefined();
    }
  );

  it("loads the destination from the environment without a built-in chat", () => {
    process.env.RECOGNITION_BOT_TOKEN = "local-token";
    process.env.RECOGNITION_BOT_WEBHOOK_SECRET = "local-secret";
    process.env.RECOGNITION_BOT_WEBHOOK_PATH = "/local";
    process.env.RECOGNITION_BOT_ADMIN_CHAT_ID = " -10042 ";

    expect(loadBotEnv().adminChatId).toBe("-10042");
  });
});
