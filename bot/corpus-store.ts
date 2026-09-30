import { type CompiledRegex, compileRegexes } from "@/domain/format";
import { type CorpusFormat, openPrCount } from "./corpus";

export interface Snapshot {
  formats: CorpusFormat[];
  compiled: CompiledRegex[];
  mainSha: string;
  openPrCount: number;
}

export function buildSnapshot(
  formats: CorpusFormat[],
  mainSha: string
): Snapshot {
  return {
    formats,
    compiled: compileRegexes(formats.map((format) => format.regex)),
    mainSha,
    openPrCount: openPrCount(formats),
  };
}

export interface CorpusStoreOptions {
  ttlMs: number;
  sync: () => Promise<Snapshot | null>;
  now?: () => number;
  onError?: (error: unknown) => void;
}

export class CorpusStore {
  private snapshot: Snapshot | null = null;
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

  get current(): Snapshot | null {
    return this.snapshot;
  }

  seed(snapshot: Snapshot): void {
    this.snapshot = snapshot;
  }

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
