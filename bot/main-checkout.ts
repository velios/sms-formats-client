/**
 * Content transport for the corpus is git, not REST (ADR-0004): a full clone of
 * `main` on first boot, read straight from disk on every restart afterwards. A
 * restart never re-clones — it reads the existing checkout and its HEAD SHA, so
 * the corpus survives process churn without spending GitHub bandwidth. A clone
 * happens only when the checkout directory is missing (e.g. wiped disk).
 *
 * Delta fetch / freshness checks and open-PR refs are later slices; here we only
 * materialise main and report the SHA we landed on.
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
