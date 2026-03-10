import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearWorkspaceSelection,
  loadWorkspaceSelection,
  saveWorkspaceSelection,
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

  it("persists and restores the active repository and source selection", () => {
    saveWorkspaceSelection({
      repository: { owner: "zenmoney", repo: "sms-formats" },
      sourceRef: {
        type: "pr",
        name: "feature/pr-123",
        sha: "abc123",
        prNumber: 123,
      },
    });

    expect(loadWorkspaceSelection()).toEqual({
      repository: { owner: "zenmoney", repo: "sms-formats" },
      sourceRef: {
        type: "pr",
        name: "feature/pr-123",
        sha: "abc123",
        prNumber: 123,
      },
    });
  });

  it("drops the saved selection after explicit clear", () => {
    saveWorkspaceSelection({
      repository: { owner: "zenmoney", repo: "sms-formats" },
      sourceRef: {
        type: "branch",
        name: "main",
        sha: "head-sha",
      },
    });

    clearWorkspaceSelection();

    expect(loadWorkspaceSelection()).toBeNull();
  });
});
