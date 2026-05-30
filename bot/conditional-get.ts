/**
 * Freshness for the corpus rides on GitHub conditional GETs (ADR-0004): we send
 * back the ETag from the last response, and a `304 Not Modified` answers "nothing
 * changed" without spending a request against the rate limit and without any git
 * work. The two corpus freshness signals — the main ref and the open-PR list —
 * are both modelled as one of these conditional GETs.
 */

export type Conditional<T> =
  | { status: "not-modified" }
  | { status: "modified"; etag?: string; body: T };

export interface ConditionalGetOptions {
  /** ETag from the previous response; sent as `If-None-Match` to enable 304s. */
  etag?: string;
  /** Read-only token; raises the REST rate limit from 60/h to 5000/h. */
  token?: string;
  /** Injectable for tests; defaults to the global fetch. */
  fetchImpl?: typeof fetch;
}

/**
 * One conditional GET against the GitHub REST API. A `304` returns
 * `not-modified` (no body, no rate-limit charge); any other 2xx returns the
 * parsed body plus the new ETag to carry into the next check; a non-2xx throws
 * so the caller can fall back to the last good snapshot.
 */
export async function conditionalGet<T>(
  url: string,
  options: ConditionalGetOptions = {}
): Promise<Conditional<T>> {
  const { etag, token, fetchImpl = fetch } = options;
  const response = await fetchImpl(url, {
    headers: {
      Accept: "application/vnd.github+json",
      "User-Agent": "sms-formats-recognition-bot",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(etag ? { "If-None-Match": etag } : {}),
    },
  });
  if (response.status === 304) {
    return { status: "not-modified" };
  }
  if (!response.ok) {
    throw new Error(
      `GitHub GET ${url} failed: ${response.status} ${response.statusText}`
    );
  }
  return {
    status: "modified",
    etag: response.headers.get("ETag") ?? undefined,
    body: (await response.json()) as T,
  };
}
