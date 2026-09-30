import { beforeEach, describe, expect, it, vi } from "vitest";
import { queryClient } from "@/lib/query-client";
import { getFileContent, loadFileContent } from "./file-content";

const fetchFileContentMock = vi.hoisted(() => vi.fn());
vi.mock("@/infrastructure/github", () => ({
  fetchFileContent: (...args: unknown[]) => fetchFileContentMock(...args),
}));
const revision = {
  repository: { owner: "zenmoney", repo: "sms-formats" },
  filePath: "src/Bank/formats/a.txt",
  commitSha: "head-sha",
};

describe("file revision cache", () => {
  beforeEach(() => {
    queryClient.clear();
    fetchFileContentMock.mockReset();
  });

  it("shares an in-flight request and caches the resolved revision", async () => {
    fetchFileContentMock.mockResolvedValue("HEAD");
    expect(
      await Promise.all([loadFileContent(revision), loadFileContent(revision)])
    ).toEqual(["HEAD", "HEAD"]);
    await loadFileContent(revision);
    expect(fetchFileContentMock).toHaveBeenCalledTimes(1);
  });

  it("keeps base and head contents separate even when they resolve concurrently", async () => {
    fetchFileContentMock.mockImplementation((_path, ref) =>
      Promise.resolve(ref)
    );
    const base = { ...revision, commitSha: "base-sha" };
    await Promise.all([loadFileContent(base), loadFileContent(revision)]);
    expect(getFileContent(base)).toBe("base-sha");
    expect(getFileContent(revision)).toBe("head-sha");
    expect(fetchFileContentMock).toHaveBeenCalledTimes(2);
  });

  it("rejects failed loads and permits an explicit retry", async () => {
    fetchFileContentMock
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce("");
    await expect(loadFileContent(revision)).rejects.toThrow("offline");
    expect(getFileContent(revision)).toBeUndefined();
    expect(await loadFileContent(revision)).toBe("");
  });
});

it("shares cached and in-flight contents with the GraphQL package loader", async () => {
  queryClient.clear();
  fetchFileContentMock.mockReset();
  fetchFileContentMock.mockResolvedValue("EDITOR");
  const { loadRevisionBlobs } = await import("./file-content");
  const fetchBlobs = vi.fn(async (_ref: string, paths: string[]) =>
    paths.map((path) => ({ path, status: "loaded" as const, text: "PACKAGE" }))
  );
  const editor = loadFileContent(revision);
  const extraPath = "src/Bank/formats/b.txt";
  const blobs = await loadRevisionBlobs(
    revision.commitSha,
    [revision.filePath, extraPath],
    revision.repository,
    fetchBlobs
  );
  expect(await editor).toBe("EDITOR");
  expect(
    blobs.map((blob) => (blob.status === "loaded" ? blob.text : null))
  ).toEqual(["EDITOR", "PACKAGE"]);
  expect(fetchBlobs).toHaveBeenCalledWith(
    revision.commitSha,
    [extraPath],
    revision.repository
  );
  expect(await loadFileContent({ ...revision, filePath: extraPath })).toBe(
    "PACKAGE"
  );
  expect(fetchFileContentMock).toHaveBeenCalledTimes(1);
});
