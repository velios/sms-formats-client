import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearWorkspaceSession,
  loadWorkspaceSession,
  saveWorkspaceSession,
} from "./workspace-session";

describe("workspace-session", () => {
  beforeEach(() => {
    const storage = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => {
        storage.set(key, value);
      },
      removeItem: (key: string) => {
        storage.delete(key);
      },
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("persists and restores the active PR session shape", () => {
    saveWorkspaceSession({
      repository: { owner: "zenmoney", repo: "sms-formats" },
      prNumber: 123,
      headSha: "abc123",
      bankPath: "src/TBank_123",
      writable: true,
      readOnlyReason: null,
    });

    expect(loadWorkspaceSession()).toEqual({
      repository: { owner: "zenmoney", repo: "sms-formats" },
      prNumber: 123,
      headSha: "abc123",
      bankPath: "src/TBank_123",
      writable: true,
      readOnlyReason: null,
    });
  });

  it("rejects legacy generic source selections from storage", () => {
    localStorage.setItem(
      "sms-formats-workspace-session",
      JSON.stringify({
        repository: { owner: "zenmoney", repo: "sms-formats" },
        sourceRef: {
          type: "branch",
          name: "main",
          sha: "head-sha",
        },
      })
    );

    expect(loadWorkspaceSession()).toBeNull();
  });

  it("drops the saved session after explicit clear", () => {
    saveWorkspaceSession({
      repository: { owner: "zenmoney", repo: "sms-formats" },
      prNumber: 123,
      headSha: "abc123",
      bankPath: "src/TBank_123",
      writable: false,
      readOnlyReason: "no-write-access",
    });

    clearWorkspaceSession();

    expect(loadWorkspaceSession()).toBeNull();
  });
});
