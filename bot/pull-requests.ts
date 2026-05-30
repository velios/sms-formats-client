/**
 * The one thing git can't tell us: which PRs are open right now. REST
 * `GET /pulls?state=open` is the sole content-bearing REST call in the corpus
 * pipeline (ADR-0004) — it yields each open PR's number, title and head SHA,
 * after which content travels over git via `refs/pull/<N>/head`. ≤40 open PRs
 * fit one page, so a single request (per_page=100) covers the whole set with no
 * pagination. It doubles as the freshness signal for the PR set: a conditional
 * GET by ETag, so an unchanged set answers 304 without spending the rate limit.
 */

import { type Conditional, conditionalGet } from "./conditional-get";

export interface OpenPullRequest {
  number: number;
  title: string;
  /** Head commit SHA — used to permalink files at the proposed state. */
  headSha: string;
}

export interface ListOpenPullRequestsOptions {
  /** `owner/repo` of the source repository. */
  repoSlug: string;
  /** ETag from the previous listing; a match answers 304 (set unchanged). */
  etag?: string;
  /** Read-only token; raises the REST rate limit from 60/h to 5000/h. */
  token?: string;
  /** Injectable for tests; defaults to the global fetch. */
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
