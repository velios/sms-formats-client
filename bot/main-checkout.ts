import { execFile, execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

async function gitNetwork(args: string[], cwd?: string): Promise<void> {
  await execFileAsync("git", args, { cwd });
}

export interface MainCheckout {
  dir: string;
  sha: string;
  repoSlug: string;
}

export interface MainCheckoutOptions {
  repoSlug: string;
  branch: string;
  dir: string;
  token?: string;
}

function git(args: string[], cwd?: string): string {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

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

export async function ensureMainCheckout(
  options: MainCheckoutOptions
): Promise<MainCheckout> {
  const { repoSlug, branch, dir, token } = options;
  if (!existsSync(join(dir, ".git"))) {
    await gitNetwork([
      "clone",
      "--branch",
      branch,
      cloneUrl(repoSlug, token),
      dir,
    ]);
  }
  return {
    dir,
    sha: git(["rev-parse", "HEAD"], dir),
    repoSlug,
  };
}

export async function fetchMainDelta(
  checkout: MainCheckout,
  branch: string
): Promise<void> {
  await gitNetwork(["fetch", "origin", branch], checkout.dir);
  git(["reset", "--hard", `origin/${branch}`], checkout.dir);
}

function pullRequestRef(prNumber: number): string {
  return `refs/pr/${prNumber}`;
}

export function prunePullRequestRef(
  checkout: MainCheckout,
  prNumber: number
): void {
  git(["update-ref", "-d", pullRequestRef(prNumber)], checkout.dir);
}

export async function fetchPullRequestHead(
  checkout: MainCheckout,
  prNumber: number
): Promise<string> {
  const ref = pullRequestRef(prNumber);
  await gitNetwork(
    ["fetch", "origin", `+refs/pull/${prNumber}/head:${ref}`],
    checkout.dir
  );
  return ref;
}

export interface ChangedFile {
  status: string;
  repoPath: string;
}

export function changedFiles(
  checkout: MainCheckout,
  prNumber: number
): ChangedFile[] {
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

export function readPullRequestHeadSha(
  checkout: MainCheckout,
  prNumber: number
): string {
  return git(["rev-parse", pullRequestRef(prNumber)], checkout.dir);
}
