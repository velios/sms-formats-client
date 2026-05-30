/**
 * Freshness signal for the `main` half of the corpus (ADR-0004): a conditional
 * GET on the branch ref. A 304 means main hasn't moved — no git fetch, no
 * rate-limit charge. A 200 carries the new ETag (to carry into the next check)
 * and the new head SHA; the actual content delta then travels over git, not
 * REST, via `fetchMainDelta`.
 */

import { type Conditional, conditionalGet } from "./conditional-get";

export interface CheckMainRefOptions {
  /** `owner/repo` of the source repository. */
  repoSlug: string;
  /** Branch backing the `main` half of the corpus. */
  branch: string;
  /** ETag from the previous check; a match answers 304 (main unmoved). */
  etag?: string;
  /** Read-only token; raises the REST rate limit from 60/h to 5000/h. */
  token?: string;
  /** Injectable for tests; defaults to the global fetch. */
  fetchImpl?: typeof fetch;
}

interface GitRefApiItem {
  object: { sha: string };
}

export async function checkMainRef(
  options: CheckMainRefOptions
): Promise<Conditional<{ sha: string }>> {
  const { repoSlug, branch, etag, token, fetchImpl } = options;
  const url = `https://api.github.com/repos/${repoSlug}/git/ref/heads/${branch}`;
  const result = await conditionalGet<GitRefApiItem>(url, {
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
    body: { sha: result.body.object.sha },
  };
}
