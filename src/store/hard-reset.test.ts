import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test";
import { restoreTestGlobals, setTestGlobal } from "@/test-globals";

const idbStorage = new Map<string, string>();

mock.module("idb-keyval", () => ({
  get: mock(),
  set: mock(),
  del: mock(async (key: string) => {
    idbStorage.delete(String(key));
  }),
}));

const { hardResetAppState } = await import("./hard-reset");
const { DRAFT_STORE_STORAGE_KEY } = await import("./persistence");

function createLocalStorageMock(state: Map<string, string>) {
  return {
    get length() {
      return state.size;
    },
    getItem: (key: string) => state.get(key) ?? null,
    key: (index: number) => Array.from(state.keys())[index] ?? null,
    removeItem: (key: string) => {
      state.delete(key);
    },
    setItem: (key: string, value: string) => {
      state.set(key, value);
    },
  };
}

describe("hardResetAppState", () => {
  let localStorageState: Map<string, string>;
  let reloadMock: ReturnType<typeof mock>;

  beforeEach(() => {
    idbStorage.clear();
    localStorageState = new Map<string, string>([
      ["sms-formats-github-user-token", "ghp_saved"],
      ["sms-formats-lang", "en"],
      [
        "sms-formats-pr-approval-permissions",
        '{"zenmoney/sms-formats":{"canApprove":true}}',
      ],
      [
        "sms-formats-recent-formats",
        '{"src/TBank_123":["src/TBank_123/formats/a.txt"]}',
      ],
      ["sms-formats-workspace-session", '{"prNumber":123}'],
      ["unrelated-key", "keep-me"],
    ]);
    idbStorage.set(DRAFT_STORE_STORAGE_KEY, '{"state":"drafts"}');
    setTestGlobal("localStorage", createLocalStorageMock(localStorageState));
    reloadMock = mock();
    setTestGlobal("location", {
      reload: reloadMock,
    });
  });

  afterEach(() => {
    restoreTestGlobals();
  });

  it("clears app state except the GitHub token and reloads the page", async () => {
    await hardResetAppState();

    expect(localStorageState.get("sms-formats-github-user-token")).toBe(
      "ghp_saved"
    );
    expect(localStorageState.has("sms-formats-lang")).toBe(false);
    expect(localStorageState.has("sms-formats-pr-approval-permissions")).toBe(
      false
    );
    expect(localStorageState.has("sms-formats-recent-formats")).toBe(false);
    expect(localStorageState.has("sms-formats-workspace-session")).toBe(false);
    expect(localStorageState.get("unrelated-key")).toBe("keep-me");
    expect(idbStorage.has(DRAFT_STORE_STORAGE_KEY)).toBe(false);
    expect(reloadMock).toHaveBeenCalledTimes(1);
  });
});
