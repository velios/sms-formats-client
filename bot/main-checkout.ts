/**
 * Content transport for the corpus is git, not REST (ADR-0004): a full clone of
 * `main` on first boot, read straight from disk on every restart afterwards. A
 * restart never re-clones — it reads the existing checkout and its HEAD SHA, so
 * the corpus survives process churn without spending GitHub bandwidth. A clone
 * happens only when the checkout directory is missing (e.g. wiped disk).
 *
 * Open-PR content rides the same clone: each head is fetched over git via
 * `refs/pull/<N>/head`, and the files it changes come from a local merge-base
 * diff — no per-file REST. Delta fetch / freshness checks are later slices.
 */

import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";

export interface MainCheckout {
  /** Absolute path to the working tree root. */
  dir: string;
  /** Commit SHA currently checked out — used for permalinks. */
  sha: string;
  /** `owner/repo`, used to build file permalinks. */
  repoSlug: string;
}

export interface MainCheckoutOptions {
  repoSlug: string;
  branch: string;
  dir: string;
  /** Read-only token for cloning; omitted clones the public repo anonymously. */
  token?: string;
}

function git(args: string[], cwd?: string): string {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

/** Like `git`, but preserves the command's output verbatim (no trim). */
function gitRaw(args: string[], cwd?: string): string {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
}

function cloneUrl(repoSlug: string, token?: string): string {
  const host = token ? `${token}@github.com` : "github.com";
  return `https://${host}/${repoSlug}.git`;
}

/**
 * Ensure a local checkout of `main` exists and return where it is and what SHA
 * it points at. Clones only when the directory has no `.git`; otherwise reuses
 * the on-disk checkout untouched.
 */
export function ensureMainCheckout(options: MainCheckoutOptions): MainCheckout {
  const { repoSlug, branch, dir, token } = options;
  if (!existsSync(join(dir, ".git"))) {
    git(["clone", "--branch", branch, cloneUrl(repoSlug, token), dir]);
  }
  return {
    dir,
    sha: git(["rev-parse", "HEAD"], dir),
    repoSlug,
  };
}

/** Local ref a fetched PR head lands on, off the public `refs/pull/<N>/head`. */
function pullRequestRef(prNumber: number): string {
  return `refs/pr/${prNumber}`;
}

/**
 * Fetch a PR's head over git (no per-file REST) into a local `refs/pr/<N>`, the
 * companion to the REST enumeration: GitHub publishes every PR head at
 * `refs/pull/<N>/head`, fetched force (`+`) so a rebased/force-pushed PR still
 * resolves. Returns the local ref the head now lives at.
 */
export function fetchPullRequestHead(
  checkout: MainCheckout,
  prNumber: number
): string {
  const ref = pullRequestRef(prNumber);
  git(["fetch", "origin", `+refs/pull/${prNumber}/head:${ref}`], checkout.dir);
  return ref;
}

export interface ChangedFile {
  /** First char of git's name-status code: `A`/`M` added/modified, `D` deleted. */
  status: string;
  /** Repo-relative path of the change (rename/copy destination). */
  repoPath: string;
}

/**
 * Files a PR changes relative to its merge-base with main, via a local
 * `git diff --name-status HEAD...refs/pr/<N>` (three-dot = merge-base diff). The
 * full clone supplies the merge-base, so this is pure local git — zero REST.
 */
export function changedFiles(
  checkout: MainCheckout,
  prNumber: number
): ChangedFile[] {
  // core.quotepath=false: bank names are Cyrillic, which git otherwise
  // octal-escapes and wraps in quotes, mangling the path past parsing.
  const output = git(
    [
      "-c",
      "core.quotepath=false",
      "diff",
      "--name-status",
      `HEAD...${pullRequestRef(prNumber)}`,
    ],
    checkout.dir
  );
  if (!output) {
    return [];
  }
  return output.split("\n").map((line) => {
    const fields = line.split("\t");
    return {
      status: fields[0]?.[0] ?? "",
      repoPath: fields.at(-1) ?? "",
    };
  });
}

/** Content of a file at a fetched PR head (`git show refs/pr/<N>:<path>`). */
export function readFileAtPullRequestHead(
  checkout: MainCheckout,
  prNumber: number,
  repoPath: string
): string {
  return gitRaw(
    ["show", `${pullRequestRef(prNumber)}:${repoPath}`],
    checkout.dir
  );
}
