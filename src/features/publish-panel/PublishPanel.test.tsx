import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/store", () => ({}));

import { resolvePublishPreflightState } from "./PublishPanel";

describe("resolvePublishPreflightState", () => {
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

  it("blocks publish on stale head before checking read-only", () => {
    expect(
      resolvePublishPreflightState({
        resolverHeadSha: "new-head",
        sessionHeadSha: "old-head",
        writable: false,
        localChangesCount: 3,
        hasInvalidScopeChanges: false,
        validationErrorsCount: 0,
      })
    ).toBe("stale");
  });

  it("allows only update-current-PR flow when preflight passes", () => {
    expect(
      resolvePublishPreflightState({
        resolverHeadSha: "same-head",
        sessionHeadSha: "same-head",
        writable: true,
        localChangesCount: 2,
        hasInvalidScopeChanges: false,
        validationErrorsCount: 0,
      })
    ).toBe("can-publish");
  });

  it("blocks invalid scope and validation failures after basic publish guards", () => {
    expect(
      resolvePublishPreflightState({
        resolverHeadSha: "same-head",
        sessionHeadSha: "same-head",
        writable: true,
        localChangesCount: 1,
        hasInvalidScopeChanges: true,
        validationErrorsCount: 0,
      })
    ).toBe("invalid-scope");
    expect(
      resolvePublishPreflightState({
        resolverHeadSha: "same-head",
        sessionHeadSha: "same-head",
        writable: true,
        localChangesCount: 1,
        hasInvalidScopeChanges: false,
        validationErrorsCount: 2,
      })
    ).toBe("validation-failed");
  });
});
