import { describe, expect, it } from "vitest";
import { checkMainRef } from "./main-ref";

describe("checkMainRef", () => {
  it("requests the branch ref and returns the new head SHA and etag", async () => {
    let requestedUrl = "";
    const fetchImpl = (async (url: string) => {
      requestedUrl = url;
      return new Response(JSON.stringify({ object: { sha: "deadbeef" } }), {
        status: 200,
        headers: { ETag: 'W/"m1"' },
      });
    }) as unknown as typeof fetch;

    const result = await checkMainRef({
      repoSlug: "zenmoney/sms-formats",
      branch: "main",
      fetchImpl,
    });

    expect(requestedUrl).toBe(
      "https://api.github.com/repos/zenmoney/sms-formats/git/ref/heads/main"
    );
    expect(result).toEqual({
      status: "modified",
      etag: 'W/"m1"',
      body: { sha: "deadbeef" },
    });
  });

  it("returns not-modified when main has not moved (304)", async () => {
    const fetchImpl = (async (_url: string, init: RequestInit) => {
      const headers = init.headers as Record<string, string>;
      return headers["If-None-Match"] === 'W/"m1"'
        ? new Response(null, { status: 304 })
        : new Response(JSON.stringify({ object: { sha: "x" } }), {
            status: 200,
          });
    }) as unknown as typeof fetch;

    const result = await checkMainRef({
      repoSlug: "o/r",
      branch: "main",
      etag: 'W/"m1"',
      fetchImpl,
    });

    expect(result).toEqual({ status: "not-modified" });
  });
});
