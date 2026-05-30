/**
 * The in-memory corpus snapshot and the demand-driven freshness gate around it
 * (ADR-0004). Two responsibilities, deliberately split from the git/REST sync:
 *
 *   1. Hold the current snapshot and swap it atomically. A snapshot is a single
 *      immutable object; the sync builds the next one fully, then this store
 *      replaces the reference in one assignment — readers see the old or the new
 *      one, never a half-built corpus.
 *   2. Gate freshness checks by demand, not a timer. A request outside the TTL
 *      window kicks one background sync; inside the window it's a no-op served
 *      from memory; a guard keeps at most one sync in flight. With zero traffic
 *      there are zero checks. On a failed sync the last good snapshot stays put
 *      (serve-last-good) and the next request after the TTL retries.
 *
 * The actual conditional GETs and git deltas live in the injected `sync`, so
 * this gate is testable without touching git or the network.
 */

import type { CorpusFormat } from "./corpus";

export interface Snapshot {
  formats: CorpusFormat[];
  /** Commit SHA of the `main` half — for the boot log and diagnostics. */
  mainSha: string;
  /** Distinct open PRs represented in the snapshot. */
  openPrCount: number;
}

export interface CorpusStoreOptions {
  /** Freshness window: at most one check per this many ms (ADR-0004: 30–60s). */
  ttlMs: number;
  /**
   * One freshness-and-sync cycle. Resolves to the next snapshot when something
   * changed, or `null` when nothing did (current stays). A rejection means the
   * cycle failed (git/REST error) — the store keeps the last good snapshot.
   */
  sync: () => Promise<Snapshot | null>;
  /** Injectable clock for tests; defaults to `Date.now`. */
  now?: () => number;
  /** Called when a sync rejects, so the failure is logged while we serve last good. */
  onError?: (error: unknown) => void;
}

export class CorpusStore {
  private snapshot: Snapshot | null = null;
  // `never`: the TTL gate is open on a cold store, so the first request triggers
  // the first check (a restart is not a special case — see ADR-0004).
  private lastCheck = Number.NEGATIVE_INFINITY;
  private inFlight = false;
  private pending: Promise<void> = Promise.resolve();

  private readonly ttlMs: number;
  private readonly sync: () => Promise<Snapshot | null>;
  private readonly now: () => number;
  private readonly onError?: (error: unknown) => void;

  constructor(options: CorpusStoreOptions) {
    this.ttlMs = options.ttlMs;
    this.sync = options.sync;
    this.now = options.now ?? Date.now;
    this.onError = options.onError;
  }

  /** Current snapshot, or `null` before the first one exists (cold start). */
  get current(): Snapshot | null {
    return this.snapshot;
  }

  /**
   * Seed the snapshot from the on-disk checkout at boot, without touching the
   * TTL gate. The first request still triggers a freshness check (the gate stays
   * open), but meanwhile we answer from this disk snapshot rather than the
   * cold-start stub — a restart needs no re-clone (ADR-0004).
   */
  seed(snapshot: Snapshot): void {
    this.snapshot = snapshot;
  }

  /**
   * Demand signal from an incoming request. Non-blocking: if the TTL window has
   * elapsed and no sync is in flight, it kicks one in the background and returns
   * at once. The caller answers from `current` immediately, fresh or not.
   */
  noteDemand(): void {
    if (this.inFlight) {
      return;
    }
    const now = this.now();
    if (now - this.lastCheck < this.ttlMs) {
      return;
    }
    this.lastCheck = now;
    this.pending = this.runSync();
  }

  /** Resolves once any in-flight sync settles — for tests, not the request path. */
  whenSettled(): Promise<void> {
    return this.pending;
  }

  private async runSync(): Promise<void> {
    this.inFlight = true;
    try {
      const next = await this.sync();
      if (next) {
        this.snapshot = next; // atomic swap
      }
    } catch (error) {
      this.onError?.(error); // serve-last-good: keep the current snapshot
    } finally {
      this.inFlight = false;
    }
  }
}
