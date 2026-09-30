import { beforeEach, describe, expect, it, mock } from "bun:test";

const storage = new Map<string, unknown>();
mock.module("idb-keyval", () => ({
  get: async (key: string) => storage.get(key),
  update: async (key: string, updater: (previous: unknown) => unknown) => {
    storage.set(key, updater(storage.get(key)));
  },
  set: async (key: string, value: unknown) => {
    storage.set(key, value);
  },
}));
let authVersion = 0;
let token: string | null = null;
let sha = "commit-1";
let checkedAt = Date.now();
const headRequest = mock(
  async (source: { type: string; prNumber?: number }) => ({
    sourceRef:
      source.type === "main"
        ? { type: "main", name: "main", sha }
        : { ...source, name: "feature", sha },
    checkedAt,
    ...(source.type === "pr" ? { prState: "closed" } : {}),
  })
);
const contentRequest = mock(
  async (_path: string, revision: string) => revision
);
mock.module("@/infrastructure/github", () => ({
  fetchSourceHead: headRequest,
  fetchFileContent: contentRequest,
  getGitHubAuthChangeVersion: () => authVersion,
  getGitHubUserToken: () => token,
}));
const { queryClient } = await import("@/lib/query-client");
const { prepareSourceFile, SourceFileLoader, SOURCE_HEAD_TTL } = await import(
  "./source-file"
);
const request = {
  repository: { owner: "zenmoney", repo: "sms-formats" },
  source: { type: "main" as const },
  filePath: "src/bank/formats/1.txt",
};

beforeEach(() => {
  storage.clear();
  queryClient.clear();
  headRequest.mockClear();
  contentRequest.mockReset();
  contentRequest.mockImplementation(
    async (_path: string, revision: string) => revision
  );
  headRequest.mockImplementation(async (source) => ({
    sourceRef:
      source.type === "main"
        ? { type: "main", name: "main", sha }
        : { ...source, name: "feature", sha },
    checkedAt,
    ...(source.type === "pr" ? { prState: "closed" } : {}),
  }));
  sha = "commit-1";
  checkedAt = Date.now();
  authVersion = 0;
  token = null;
});

function calls() {
  return headRequest.mock.calls.length + contentRequest.mock.calls.length;
}
function resetCalls() {
  headRequest.mockClear();
  contentRequest.mockClear();
}

describe("single source file preparation", () => {
  it("persists untouched head and body, with the 2/0/1/1/2 request budget", async () => {
    const first = await prepareSourceFile(request);
    expect(first.content).toBe(first.head.sourceRef.sha);
    expect(calls()).toBe(2);
    queryClient.clear();
    resetCalls();
    expect(await prepareSourceFile(request)).toEqual(first);
    expect(calls()).toBe(0);
    resetCalls();
    await prepareSourceFile({ ...request, filePath: "src/bank/formats/2.txt" });
    expect(calls()).toBe(1);
    // Expired persisted metadata triggers the next open, never a timer.
    for (const [key, value] of storage) {
      if (key.includes("source-head")) {
        storage.set(key, {
          ...(value as object),
          checkedAt: Date.now() - SOURCE_HEAD_TTL,
        });
      }
    }
    resetCalls();
    await prepareSourceFile(request);
    expect(calls()).toBe(1);
    resetCalls();
    sha = "commit-2";
    const next = await prepareSourceFile({ ...request, forceFresh: true });
    expect(calls()).toBe(2);
    expect(next.content).toBe("commit-2");
    expect(first.content).toBe("commit-1");
  });

  it("manual and authenticated opens bypass TTL; no work follows elapsed time alone", async () => {
    await prepareSourceFile(request);
    resetCalls();
    expect(calls()).toBe(0);
    await prepareSourceFile({ ...request, forceFresh: true });
    expect(calls()).toBe(1);
    resetCalls();
    token = "token";
    await prepareSourceFile(request);
    expect(calls()).toBe(1);
  });

  it("distinguishes empty, missing, and failed files without changing source", async () => {
    const pr = { ...request, source: { type: "pr" as const, prNumber: 123 } };
    contentRequest.mockResolvedValueOnce("");
    const empty = await prepareSourceFile(pr);
    expect(empty.content).toBe("");
    expect(empty.head.prState).toBe("closed");
    queryClient.clear();
    storage.clear();
    contentRequest.mockRejectedValueOnce({ status: 404 });
    expect((await prepareSourceFile(pr)).content).toBeNull();
    contentRequest.mockRejectedValueOnce(new Error("network"));
    await expect(prepareSourceFile(pr)).rejects.toThrow("network");
    expect(
      headRequest.mock.calls.every(([source]) => source.type === "pr")
    ).toBe(true);
  });

  it("failed head check preserves previous checked metadata and body", async () => {
    const first = await prepareSourceFile(request);
    headRequest.mockRejectedValueOnce(new Error("offline"));
    await expect(
      prepareSourceFile({ ...request, forceFresh: true })
    ).rejects.toThrow("offline");
    queryClient.clear();
    expect(await prepareSourceFile(request)).toEqual(first);
  });

  it("discards late results for changed file/source, same-source reopen and token", async () => {
    for (const change of ["file", "source", "reopen", "token"]) {
      storage.clear();
      queryClient.clear();
      let resolve!: (value: string) => void;
      contentRequest.mockImplementationOnce(
        () =>
          new Promise<string>((done) => {
            resolve = done;
          })
      );
      const loader = new SourceFileLoader();
      const old = loader.prepare(request);
      while (!resolve) {
        await Promise.resolve();
      }
      if (change === "token") {
        authVersion += 1;
      } else {
        loader.invalidate();
      }
      resolve("OLD");
      expect(await old).toBeNull();
      expect(
        await loader.prepare(
          change === "file"
            ? { ...request, filePath: "other.txt" }
            : change === "source"
              ? { ...request, source: { type: "pr", prNumber: 9 } }
              : request
        )
      ).not.toBeNull();
    }
  });
});

it("late head from an earlier same-source open cannot roll back persisted freshness", async () => {
  let resolve!: (head: Awaited<ReturnType<typeof headRequest>>) => void;
  headRequest.mockImplementationOnce(
    () =>
      new Promise((done) => {
        resolve = done;
      })
  );
  const loader = new SourceFileLoader();
  const old = loader.prepare({ ...request, forceFresh: true });
  while (!resolve) {
    await Promise.resolve();
  }
  sha = "commit-NEW";
  const accepted = await loader.prepare({ ...request, forceFresh: true });
  expect(accepted).not.toBeNull();
  resolve({
    sourceRef: { type: "main", name: "main", sha: "commit-OLD" },
    checkedAt: Date.now() + 1000,
  });
  expect(await old).toBeNull();
  queryClient.clear();
  resetCalls();
  expect(await prepareSourceFile(request)).toEqual(accepted!);
  expect(calls()).toBe(0);
});
