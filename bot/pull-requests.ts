import { type Conditional, conditionalGet } from "./conditional-get";

export interface OpenPullRequest {
  number: number;
  title: string;
  headSha: string;
}

export interface ListOpenPullRequestsOptions {
  repoSlug: string;
  etag?: string;
  token?: string;
  fetchImpl?: typeof fetch;
}

interface PullsApiItem {
  number: number;
  title: string;
  head: { sha: string };
}

export async function listOpenPullRequests(
  options: ListOpenPullRequestsOptions
): Promise<Conditional<OpenPullRequest[]>> {
  const { repoSlug, etag, token, fetchImpl } = options;
  const url = `https://api.github.com/repos/${repoSlug}/pulls?state=open&per_page=100`;
  const result = await conditionalGet<PullsApiItem[]>(url, {
    etag,
    token,
    fetchImpl,
  });
  if (result.status === "not-modified") {
    return result;
  }
  return {
    status: "modified",
    etag: result.etag,
    body: result.body.map((item) => ({
      number: item.number,
      title: item.title,
      headSha: item.head.sha,
    })),
  };
}
