export type Conditional<T> =
  | { status: "not-modified" }
  | { status: "modified"; etag?: string; body: T };

export interface ConditionalGetOptions {
  etag?: string;
  token?: string;
  fetchImpl?: typeof fetch;
}

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
