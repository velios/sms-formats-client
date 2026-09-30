import { type Conditional, conditionalGet } from "./conditional-get";

export interface CheckMainRefOptions {
  repoSlug: string;
  branch: string;
  etag?: string;
  token?: string;
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
