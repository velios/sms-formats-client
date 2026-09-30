import { describe, expect, it, mock } from "bun:test";
import { CorpusStore, type Snapshot } from "./corpus-store";

function snapshot(mainSha: string): Snapshot {
  return { formats: [], compiled: [], mainSha, openPrCount: 0 };
}

describe("CorpusStore freshness gate", () => {
  it("is empty before the first sync (cold start)", () => {
    const store = new CorpusStore({ ttlMs: 1000, sync: mock() });
    expect(store.current).toBeNull();
  });

  it("triggers one check on the first demand and swaps the snapshot in", async () => {
    const sync = mock().mockResolvedValue(snapshot("a"));
    const store = new CorpusStore({ ttlMs: 1000, sync, now: () => 0 });

    store.noteDemand();
    await store.whenSettled();

    expect(sync).toHaveBeenCalledTimes(1);
    expect(store.current).toEqual(snapshot("a"));
  });

  it("serves from memory inside the TTL window without re-checking", async () => {
    const sync = mock().mockResolvedValue(snapshot("a"));
    let now = 0;
    const store = new CorpusStore({ ttlMs: 1000, sync, now: () => now });

    store.noteDemand();
    await store.whenSettled();
    now = 999; // still inside the window
    store.noteDemand();
    await store.whenSettled();

    expect(sync).toHaveBeenCalledTimes(1);
  });

  it("re-checks once the TTL window has elapsed", async () => {
    const sync = mock()
      .mockResolvedValueOnce(snapshot("a"))
      .mockResolvedValueOnce(snapshot("b"));
    let now = 0;
    const store = new CorpusStore({ ttlMs: 1000, sync, now: () => now });

    store.noteDemand();
    await store.whenSettled();
    now = 1000; // window elapsed
    store.noteDemand();
    await store.whenSettled();

    expect(sync).toHaveBeenCalledTimes(2);
    expect(store.current).toEqual(snapshot("b"));
  });

  it("never runs without demand (zero traffic ⇒ zero checks)", () => {
    const sync = mock().mockResolvedValue(snapshot("a"));
    new CorpusStore({ ttlMs: 1000, sync, now: () => 1e9 });
    expect(sync).not.toHaveBeenCalled();
  });

  it("keeps at most one sync in flight", async () => {
    let release!: (s: Snapshot) => void;
    const sync = mock().mockReturnValue(
      new Promise<Snapshot>((r) => (release = r))
    );
    let now = 0;
    const store = new CorpusStore({ ttlMs: 1000, sync, now: () => now });

    store.noteDemand();
    now = 5000; // window elapsed, but a sync is still running
    store.noteDemand();
    expect(sync).toHaveBeenCalledTimes(1);

    release(snapshot("a"));
    await store.whenSettled();
    expect(store.current).toEqual(snapshot("a"));
  });

  it("keeps the current snapshot when nothing changed (sync ⇒ null)", async () => {
    const sync = mock()
      .mockResolvedValueOnce(snapshot("a"))
      .mockResolvedValueOnce(null);
    let now = 0;
    const store = new CorpusStore({ ttlMs: 1000, sync, now: () => now });

    store.noteDemand();
    await store.whenSettled();
    now = 2000;
    store.noteDemand();
    await store.whenSettled();

    expect(store.current).toEqual(snapshot("a"));
  });

  it("serves the last good snapshot when a sync fails, then retries next TTL", async () => {
    const onError = mock();
    const sync = mock()
      .mockResolvedValueOnce(snapshot("a"))
      .mockRejectedValueOnce(new Error("git exploded"))
      .mockResolvedValueOnce(snapshot("c"));
    let now = 0;
    const store = new CorpusStore({
      ttlMs: 1000,
      sync,
      now: () => now,
      onError,
    });

    store.noteDemand();
    await store.whenSettled();

    now = 2000; // fails
    store.noteDemand();
    await store.whenSettled();
    expect(store.current).toEqual(snapshot("a")); // last good retained
    expect(onError).toHaveBeenCalledTimes(1);

    now = 4000; // retry succeeds
    store.noteDemand();
    await store.whenSettled();
    expect(store.current).toEqual(snapshot("c"));
  });

  it("seeds a disk snapshot but leaves the TTL gate open for the first request", async () => {
    const sync = mock().mockResolvedValue(snapshot("fresh"));
    const store = new CorpusStore({ ttlMs: 1000, sync, now: () => 5000 });

    store.seed(snapshot("disk"));
    expect(store.current).toEqual(snapshot("disk")); // served immediately

    store.noteDemand(); // gate open despite the seed
    await store.whenSettled();
    expect(sync).toHaveBeenCalledTimes(1);
    expect(store.current).toEqual(snapshot("fresh"));
  });
});
