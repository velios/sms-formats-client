import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createCorpusSync } from "./corpus-sync";

const GIT_ENV = {
  ...process.env,
  GIT_AUTHOR_NAME: "Test",
  GIT_AUTHOR_EMAIL: "test@example.com",
  GIT_COMMITTER_NAME: "Test",
  GIT_COMMITTER_EMAIL: "test@example.com",
};

function git(dir: string, args: string[]): string {
  return execFileSync("git", args, {
    cwd: dir,
    env: GIT_ENV,
    encoding: "utf8",
  }).trim();
}

function formatFile(regex: string): string {
  return `${regex}\n\n-----COLUMNS-----\nsum\n\n-----EXAMPLE-----\nexample\n`;
}

function writeRepoFile(dir: string, repoPath: string, content: string): void {
  const abs = join(dir, repoPath);
  mkdirSync(join(abs, ".."), { recursive: true });
  writeFileSync(abs, content);
}

function commitAll(dir: string, message: string): string {
  git(dir, ["add", "-A"]);
  git(dir, ["commit", "-q", "-m", message]);
  return git(dir, ["rev-parse", "HEAD"]);
}

/** Publish a PR head on the remote at `refs/pull/<n>/head`, as GitHub would. */
function publishPrHead(remote: string, n: number, branch: string): string {
  git(remote, ["checkout", "-q", branch]);
  const sha = git(remote, ["rev-parse", "HEAD"]);
  git(remote, ["update-ref", `refs/pull/${n}/head`, sha]);
  git(remote, ["checkout", "-q", "main"]);
  return sha;
}

interface FakeState {
  mainSha: string;
  mainEtag: string;
  pulls: { number: number; title: string; head: { sha: string } }[];
  pullsEtag: string;
}

/** A GitHub REST stand-in honouring If-None-Match against the current ETags. */
function fakeFetch(state: FakeState): typeof fetch {
  return (async (url: string, init: RequestInit) => {
    const inm = (init.headers as Record<string, string>)["If-None-Match"];
    if (url.includes("/git/ref/heads/")) {
      if (inm === state.mainEtag) {
        return new Response(null, { status: 304 });
      }
      return new Response(JSON.stringify({ object: { sha: state.mainSha } }), {
        status: 200,
        headers: { ETag: state.mainEtag },
      });
    }
    if (url.includes("/pulls?")) {
      if (inm === state.pullsEtag) {
        return new Response(null, { status: 304 });
      }
      return new Response(JSON.stringify(state.pulls), {
        status: 200,
        headers: { ETag: state.pullsEtag },
      });
    }
    throw new Error(`unexpected url ${url}`);
  }) as unknown as typeof fetch;
}

describe("createCorpusSync", () => {
  let remote: string;
  let checkoutDir: string;
  let state: FakeState;

  beforeEach(() => {
    remote = mkdtempSync(join(tmpdir(), "remote-"));
    git(remote, ["init", "-q", "-b", "main"]);
    writeRepoFile(remote, "src/sberbank/formats/12.txt", formatFile("^Sber$"));
    const mainSha = commitAll(remote, "main");

    // Open PR #7 adds an Alfa format; publish its head as GitHub does.
    git(remote, ["checkout", "-q", "-b", "pr7"]);
    writeRepoFile(remote, "src/alfabank/formats/9.txt", formatFile("^Alfa$"));
    commitAll(remote, "pr7");
    const pr7Sha = publishPrHead(remote, 7, "pr7");

    checkoutDir = mkdtempSync(join(tmpdir(), "checkout-"));
    rmSync(checkoutDir, { recursive: true, force: true });
    git(remote, ["clone", "-q", "--branch", "main", remote, checkoutDir]);

    state = {
      mainSha,
      mainEtag: 'W/"m1"',
      pulls: [{ number: 7, title: "Add Alfa", head: { sha: pr7Sha } }],
      pullsEtag: 'W/"p1"',
    };
  });

  afterEach(() => {
    rmSync(remote, { recursive: true, force: true });
    rmSync(checkoutDir, { recursive: true, force: true });
  });

  function makeSync() {
    return createCorpusSync({
      repoSlug: "zenmoney/sms-formats",
      branch: "main",
      dir: checkoutDir,
      onSkip: (pr, error) => {
        throw new Error(`unexpected skip of PR #${pr.number}: ${error}`);
      },
      fetchImpl: fakeFetch(state),
    });
  }

  it("builds main + open-PR formats on the first cycle", async () => {
    const sync = makeSync();
    const snapshot = await sync();

    expect(snapshot?.formats.map((f) => f.bank)).toEqual([
      "sberbank",
      "alfabank",
    ]);
    expect(snapshot?.openPrCount).toBe(1);
    expect(snapshot?.mainSha).toBe(state.mainSha);
    // The corpus is compiled once per refresh: a RegExp per format, aligned by
    // index, reused for every SMS until the next snapshot (ADR-0003).
    expect(snapshot?.compiled).toHaveLength(snapshot?.formats.length ?? 0);
    expect(snapshot?.compiled[0]?.regex?.test("Sber")).toBe(true);
    expect(snapshot?.compiled[1]?.regex?.test("Alfa")).toBe(true);
  });

  it("returns null on a 304/304 cycle and does no rebuild", async () => {
    const sync = makeSync();
    await sync();
    expect(await sync()).toBeNull();
  });

  it("pulls a main git-delta and rebuilds when the main ref moves", async () => {
    const sync = makeSync();
    await sync();

    // main advances on the remote with a new bank; only its ETag flips.
    git(remote, ["checkout", "-q", "main"]);
    writeRepoFile(remote, "src/tinkoff/formats/3.txt", formatFile("^Tinkoff$"));
    state.mainSha = commitAll(remote, "main 2");
    state.mainEtag = 'W/"m2"';

    const snapshot = await sync();
    expect(snapshot?.mainSha).toBe(state.mainSha);
    expect(snapshot?.formats.map((f) => f.bank)).toContain("tinkoff");
  });

  it("prunes the ref of a closed PR so it leaves the corpus", async () => {
    const sync = makeSync();
    await sync();

    state.pulls = []; // PR #7 closed
    state.pullsEtag = 'W/"p2"';

    const snapshot = await sync();
    expect(snapshot?.openPrCount).toBe(0);
    expect(snapshot?.formats.map((f) => f.bank)).toEqual(["sberbank"]);
    expect(() => git(checkoutDir, ["show", "refs/pr/7"])).toThrow();
  });

  it("force-updates a rebased PR head and reflects its new content", async () => {
    const sync = makeSync();
    await sync();

    // PR #7 is force-pushed: its single commit now carries a different format.
    git(remote, ["checkout", "-q", "pr7"]);
    writeRepoFile(
      remote,
      "src/alfabank/formats/9.txt",
      formatFile("^Alfa V2$")
    );
    git(remote, ["commit", "-q", "--amend", "-m", "pr7 rebased", "-a"]);
    const newHead = publishPrHead(remote, 7, "pr7");
    state.pulls = [{ number: 7, title: "Add Alfa", head: { sha: newHead } }];
    state.pullsEtag = 'W/"p2"';

    const snapshot = await sync();
    const alfa = snapshot?.formats.find((f) => f.bank === "alfabank");
    expect(alfa?.regex).toBe("^Alfa V2$");
    expect(alfa?.fileUrl).toContain(newHead);
  });

  it("falls back to the on-disk checkout when a REST check errors on a cold first cycle", async () => {
    const errors: unknown[] = [];
    const sync = createCorpusSync({
      repoSlug: "zenmoney/sms-formats",
      branch: "main",
      dir: checkoutDir,
      onSkip: () => undefined,
      onFreshnessError: (error) => errors.push(error),
      fetchImpl: (async () =>
        new Response("boom", {
          status: 500,
          statusText: "Server Error",
        })) as unknown as typeof fetch,
    });

    const snapshot = await sync();
    // Main half built from the freshly-cloned checkout; PR half empty (the
    // PR-list REST call failed), instead of stranding the corpus.
    expect(snapshot?.formats.map((f) => f.bank)).toEqual(["sberbank"]);
    expect(snapshot?.openPrCount).toBe(0);
    expect(snapshot?.mainSha).toBe(state.mainSha);
    // Both freshness checks (main ref + open-PR list) reported their failure.
    expect(errors).toHaveLength(2);
  });

  it("returns null on a REST error after a good build, so the store keeps last good", async () => {
    let failRest = false;
    const live = fakeFetch(state);
    const sync = createCorpusSync({
      repoSlug: "zenmoney/sms-formats",
      branch: "main",
      dir: checkoutDir,
      onSkip: () => undefined,
      onFreshnessError: () => undefined,
      fetchImpl: (async (url: string, init: RequestInit) => {
        if (failRest) {
          return new Response("boom", { status: 500 });
        }
        return live(url, init);
      }) as unknown as typeof fetch,
    });

    await sync(); // good first build
    failRest = true;
    // Both checks soft-fail → no change → current snapshot stands (serve last good).
    expect(await sync()).toBeNull();
  });
});
