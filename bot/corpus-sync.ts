/**
 * One freshness-and-sync cycle for the corpus (ADR-0004), wrapped behind the
 * `() => Promise<Snapshot | null>` the CorpusStore drives. Each cycle:
 *
 *   1. Conditional GET on the main ref and on the open-PR list, carrying the
 *      ETags from last time. Two 304s mean nothing moved — we return `null` and
 *      do no git work, spending nothing against the rate limit.
 *   2. On a shift, pull only the moved refs as git deltas: `fetchMainDelta` when
 *      main advanced; for the PR set, fetch only heads whose SHA changed (force,
 *      so a rebase resolves) and prune the refs of PRs that have closed.
 *   3. Rebuild the whole snapshot from the now-current on-disk state and hand it
 *      back; the store swaps it in atomically.
 *
 * The cycle owns all git/REST state (ETags, which PR heads we hold) in its
 * closure, so the store stays a pure gate. Clone-if-missing lives in
 * `ensureMainCheckout`, so a wiped disk re-clones here while a warm disk doesn't.
 */

import { buildCorpus, openPrCount } from "./corpus";
import type { Snapshot } from "./corpus-store";
import {
  ensureMainCheckout,
  fetchMainDelta,
  fetchPullRequestHead,
  prunePullRequestRef,
} from "./main-checkout";
import { checkMainRef } from "./main-ref";
import { listOpenPullRequests, type OpenPullRequest } from "./pull-requests";

export interface CorpusSyncConfig {
  repoSlug: string;
  branch: string;
  dir: string;
  /** Read-only token for cloning/fetching and raising the REST limit. */
  token?: string;
  /** Reports a PR dropped from one rebuild (unreadable file, fetch failure). */
  onSkip: (pr: OpenPullRequest, error: unknown) => void;
  /** Injectable for tests; defaults to the global fetch. */
  fetchImpl?: typeof fetch;
}

export function createCorpusSync(
  config: CorpusSyncConfig
): () => Promise<Snapshot | null> {
  const { repoSlug, branch, dir, token, onSkip, fetchImpl } = config;

  let mainEtag: string | undefined;
  let pullsEtag: string | undefined;
  // PR number → head SHA we've already fetched; lets us fetch only moved heads.
  const fetchedHeads = new Map<number, string>();
  let openPrs: OpenPullRequest[] = [];
  let built = false;

  return async function sync(): Promise<Snapshot | null> {
    // Clone on a wiped disk, reuse a warm one. Either way we hold a checkout.
    let checkout = ensureMainCheckout({ repoSlug, branch, dir, token });

    const mainResult = await checkMainRef({
      repoSlug,
      branch,
      etag: mainEtag,
      token,
      fetchImpl,
    });
    let mainMoved = false;
    if (mainResult.status === "modified") {
      mainEtag = mainResult.etag;
      fetchMainDelta(checkout, branch);
      checkout = ensureMainCheckout({ repoSlug, branch, dir, token });
      mainMoved = true;
    }

    const pullsResult = await listOpenPullRequests({
      repoSlug,
      etag: pullsEtag,
      token,
      fetchImpl,
    });
    let prsMoved = false;
    if (pullsResult.status === "modified") {
      pullsEtag = pullsResult.etag;
      openPrs = pullsResult.body;
      prsMoved = true;
    }

    // Two 304s and we've already built once: nothing moved, current stands.
    if (!(mainMoved || prsMoved) && built) {
      return null;
    }

    if (prsMoved || !built) {
      syncPullRequestRefs(checkout);
    }

    const formats = buildCorpus(checkout, openPrs, onSkip);
    built = true;
    return {
      formats,
      mainSha: checkout.sha,
      openPrCount: openPrCount(formats),
    };
  };

  function syncPullRequestRefs(
    checkout: ReturnType<typeof ensureMainCheckout>
  ): void {
    const open = new Set(openPrs.map((pr) => pr.number));
    // Prune refs of PRs that have closed since the last listing.
    for (const number of fetchedHeads.keys()) {
      if (!open.has(number)) {
        prunePullRequestRef(checkout, number);
        fetchedHeads.delete(number);
      }
    }
    // Fetch only heads we don't already hold at this SHA (force covers rebase).
    for (const pr of openPrs) {
      if (fetchedHeads.get(pr.number) === pr.headSha) {
        continue;
      }
      try {
        fetchPullRequestHead(checkout, pr.number);
        fetchedHeads.set(pr.number, pr.headSha);
      } catch (error) {
        onSkip(pr, error);
      }
    }
  }
}
