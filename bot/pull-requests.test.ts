import { describe, expect, it } from "vitest";
import { listOpenPullRequests } from "./pull-requests";

function jsonResponse(body: unknown, etag = 'W/"e1"'): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json", ETag: etag },
  });
}

describe("listOpenPullRequests", () => {
  it("requests open PRs and maps number, title and head SHA with the etag", async () => {
    let requestedUrl = "";
    const fetchImpl = (async (url: string) => {
      requestedUrl = url;
      return jsonResponse([
        { number: 45, title: "Add Tinkoff format", head: { sha: "head45" } },
        { number: 7, title: "Fix Sber regex", head: { sha: "head7" } },
      ]);
    }) as unknown as typeof fetch;

    const result = await listOpenPullRequests({
      repoSlug: "zenmoney/sms-formats",
      fetchImpl,
    });

    expect(requestedUrl).toBe(
      "https://api.github.com/repos/zenmoney/sms-formats/pulls?state=open&per_page=100"
    );
    expect(result).toEqual({
      status: "modified",
      etag: 'W/"e1"',
      body: [
        { number: 45, title: "Add Tinkoff format", headSha: "head45" },
        { number: 7, title: "Fix Sber regex", headSha: "head7" },
      ],
    });
  });

  it("returns not-modified when the PR set is unchanged (304)", async () => {
    const fetchImpl = (async (_url: string, init: RequestInit) => {
      const headers = init.headers as Record<string, string>;
      return headers["If-None-Match"] === 'W/"prev"'
        ? new Response(null, { status: 304 })
        : jsonResponse([]);
    }) as unknown as typeof fetch;

    const result = await listOpenPullRequests({
      repoSlug: "o/r",
      etag: 'W/"prev"',
      fetchImpl,
    });

    expect(result).toEqual({ status: "not-modified" });
  });

  it("sends bearer auth only when a token is given", async () => {
    const seen: Record<string, string>[] = [];
    const fetchImpl = (async (_url: string, init: RequestInit) => {
      seen.push(init.headers as Record<string, string>);
      return jsonResponse([]);
    }) as unknown as typeof fetch;

    await listOpenPullRequests({ repoSlug: "o/r", fetchImpl });
    await listOpenPullRequests({ repoSlug: "o/r", token: "t0ken", fetchImpl });

    expect(seen[0]?.Authorization).toBeUndefined();
    expect(seen[1]?.Authorization).toBe("Bearer t0ken");
  });

  it("throws when the API responds with an error status", async () => {
    const fetchImpl = (async () =>
      new Response("rate limited", {
        status: 403,
        statusText: "Forbidden",
      })) as unknown as typeof fetch;

    await expect(
      listOpenPullRequests({ repoSlug: "o/r", fetchImpl })
    ).rejects.toThrow("403");
  });
});
