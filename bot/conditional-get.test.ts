import { describe, expect, it } from "vitest";
import { conditionalGet } from "./conditional-get";

describe("conditionalGet", () => {
  it("returns not-modified on 304 and reads no body", async () => {
    const fetchImpl = (async () =>
      new Response(null, { status: 304 })) as unknown as typeof fetch;

    const result = await conditionalGet("https://api.github.com/x", {
      fetchImpl,
    });

    expect(result).toEqual({ status: "not-modified" });
  });

  it("sends If-None-Match only when an etag is given", async () => {
    const seen: Record<string, string>[] = [];
    const fetchImpl = (async (_url: string, init: RequestInit) => {
      seen.push(init.headers as Record<string, string>);
      return new Response(JSON.stringify({}), {
        status: 200,
        headers: { ETag: 'W/"e1"' },
      });
    }) as unknown as typeof fetch;

    await conditionalGet("https://api.github.com/x", { fetchImpl });
    await conditionalGet("https://api.github.com/x", {
      etag: 'W/"prev"',
      fetchImpl,
    });

    expect(seen[0]?.["If-None-Match"]).toBeUndefined();
    expect(seen[1]?.["If-None-Match"]).toBe('W/"prev"');
  });

  it("returns the parsed body and the new etag on 200", async () => {
    const fetchImpl = (async () =>
      new Response(JSON.stringify({ hello: "world" }), {
        status: 200,
        headers: { ETag: 'W/"e2"' },
      })) as unknown as typeof fetch;

    const result = await conditionalGet<{ hello: string }>(
      "https://api.github.com/x",
      { fetchImpl }
    );

    expect(result).toEqual({
      status: "modified",
      etag: 'W/"e2"',
      body: { hello: "world" },
    });
  });

  it("throws on a non-2xx, non-304 status so callers can serve last good", async () => {
    const fetchImpl = (async () =>
      new Response("rate limited", {
        status: 403,
        statusText: "Forbidden",
      })) as unknown as typeof fetch;

    await expect(
      conditionalGet("https://api.github.com/x", { fetchImpl })
    ).rejects.toThrow("403");
  });
});
