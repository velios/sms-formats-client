/**
 * The one thing git can't tell us: which PRs are open right now. REST
 * `GET /pulls?state=open` is the sole REST call in the corpus pipeline (ADR-0004)
 * — it yields each open PR's number, title and head SHA, after which content
 * travels over git via `refs/pull/<N>/head`. ≤40 open PRs fit one page, so a
 * single request (per_page=100) covers the whole set with no pagination.
 */

export interface OpenPullRequest {
  number: number;
  title: string;
  /** Head commit SHA — used to permalink files at the proposed state. */
  headSha: string;
}

export interface ListOpenPullRequestsOptions {
  /** `owner/repo` of the source repository. */
  repoSlug: string;
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
): Promise<OpenPullRequest[]> {
  const { repoSlug, token, fetchImpl = fetch } = options;
  const url = `https://api.github.com/repos/${repoSlug}/pulls?state=open&per_page=100`;
  const response = await fetchImpl(url, {
    headers: {
      Accept: "application/vnd.github+json",
      "User-Agent": "sms-formats-recognition-bot",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
  });
  if (!response.ok) {
    throw new Error(
      `Listing open PRs failed: ${response.status} ${response.statusText}`
    );
  }
  const items = (await response.json()) as PullsApiItem[];
  return items.map((item) => ({
    number: item.number,
    title: item.title,
    headSha: item.head.sha,
  }));
}
