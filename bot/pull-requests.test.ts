import { describe, expect, it } from "vitest";
import { listOpenPullRequests } from "./pull-requests";

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

describe("listOpenPullRequests", () => {
  it("requests open PRs and maps number, title and head SHA", async () => {
    let requestedUrl = "";
    const fetchImpl = (async (url: string) => {
      requestedUrl = url;
      return jsonResponse([
        { number: 45, title: "Add Tinkoff format", head: { sha: "head45" } },
        { number: 7, title: "Fix Sber regex", head: { sha: "head7" } },
      ]);
    }) as unknown as typeof fetch;

    const prs = await listOpenPullRequests({
      repoSlug: "zenmoney/sms-formats",
      fetchImpl,
    });

    expect(requestedUrl).toBe(
      "https://api.github.com/repos/zenmoney/sms-formats/pulls?state=open&per_page=100"
    );
    expect(prs).toEqual([
      { number: 45, title: "Add Tinkoff format", headSha: "head45" },
      { number: 7, title: "Fix Sber regex", headSha: "head7" },
    ]);
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
