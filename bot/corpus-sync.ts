import type { Conditional } from "./conditional-get";
import { buildCorpus } from "./corpus";
import { buildSnapshot, type Snapshot } from "./corpus-store";
import {
  ensureMainCheckout,
  fetchMainDelta,
  fetchPullRequestHead,
  type MainCheckout,
  prunePullRequestRef,
  readPullRequestHeadSha,
} from "./main-checkout";
import { checkMainRef } from "./main-ref";
import { listOpenPullRequests, type OpenPullRequest } from "./pull-requests";

export interface CorpusSyncConfig {
  repoSlug: string;
  branch: string;
  dir: string;
  token?: string;
  onSkip: (pr: OpenPullRequest, error: unknown) => void;
  onFreshnessError?: (error: unknown) => void;
  fetchImpl?: typeof fetch;
}

export function createCorpusSync(
  config: CorpusSyncConfig
): () => Promise<Snapshot | null> {
  const { repoSlug, branch, dir, token, onSkip, onFreshnessError, fetchImpl } =
    config;

  async function freshness<T>(
    check: () => Promise<Conditional<T>>
  ): Promise<Conditional<T>> {
    try {
      return await check();
    } catch (error) {
      onFreshnessError?.(error);
      return { status: "not-modified" };
    }
  }

  let mainEtag: string | undefined;
  let pullsEtag: string | undefined;
  const fetchedHeads = new Map<number, string>();
  let openPrs: OpenPullRequest[] = [];
  let built = false;

  return async function sync(): Promise<Snapshot | null> {
    let checkout = await ensureMainCheckout({ repoSlug, branch, dir, token });

    const mainResult = await freshness(() =>
      checkMainRef({
        repoSlug,
        branch,
        etag: mainEtag,
        token,
        fetchImpl,
      })
    );
    let mainMoved = false;
    if (mainResult.status === "modified") {
      await fetchMainDelta(checkout, branch);
      checkout = await ensureMainCheckout({ repoSlug, branch, dir, token });
      mainEtag = mainResult.etag;
      mainMoved = true;
    }

    const pullsResult = await freshness(() =>
      listOpenPullRequests({
        repoSlug,
        etag: pullsEtag,
        token,
        fetchImpl,
      })
    );
    let prsMoved = false;
    if (pullsResult.status === "modified") {
      pullsEtag = pullsResult.etag;
      openPrs = pullsResult.body;
      prsMoved = true;
    }

    // Retry unfinished refs even after a 304.
    const pendingRefs = openPrs.some(
      (pr) => fetchedHeads.get(pr.number) !== pr.headSha
    );
    if (!(mainMoved || prsMoved || pendingRefs) && built) {
      return null;
    }

    if (prsMoved || pendingRefs || !built) {
      await syncPullRequestRefs(checkout);
    }

    if (
      built &&
      openPrs.some((pr) => fetchedHeads.get(pr.number) !== pr.headSha)
    ) {
      return null;
    }
    const readyPrs = openPrs.filter(
      (pr) => fetchedHeads.get(pr.number) === pr.headSha
    );
    const formats = buildCorpus(checkout, readyPrs, (pr, error) => {
      fetchedHeads.delete(pr.number);
      onSkip(pr, error);
    });
    if (
      built &&
      readyPrs.some((pr) => fetchedHeads.get(pr.number) !== pr.headSha)
    ) {
      return null;
    }
    built = true;
    return buildSnapshot(formats, checkout.sha);
  };

  async function syncPullRequestRefs(checkout: MainCheckout): Promise<void> {
    const open = new Set(openPrs.map((pr) => pr.number));
    for (const number of fetchedHeads.keys()) {
      if (!open.has(number)) {
        prunePullRequestRef(checkout, number);
        fetchedHeads.delete(number);
      }
    }
    for (const pr of openPrs) {
      if (fetchedHeads.get(pr.number) === pr.headSha) {
        continue;
      }
      try {
        await fetchPullRequestHead(checkout, pr.number);
        const sha = readPullRequestHeadSha(checkout, pr.number);
        if (sha !== pr.headSha) {
          throw new Error("PR head changed during corpus sync");
        }
        fetchedHeads.set(pr.number, sha);
      } catch (error) {
        onSkip(pr, error);
      }
    }
  }
}
