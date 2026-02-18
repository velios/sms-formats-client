import { Octokit } from "@octokit/rest";
import { config } from "@/config";
import { isSmsGameIssue } from "@/domain/sms-game/issue-import";
import type { BankInfo, FileEntry, RepoRef } from "../types";
import { decodeBase64Utf8, encodeBase64Utf8 } from "./encoding";

const defaultRepoRef: RepoRef = {
  owner: config.defaultSourceOwner,
  repo: config.defaultSourceRepo,
};

const sourceRepoRef: RepoRef = {
  owner: config.sourceOwner,
  repo: config.sourceRepo,
};

const GITHUB_USER_TOKEN_STORAGE_KEY = "sms-formats-github-user-token";

function resolveRepo(repoRef?: RepoRef): RepoRef {
  return repoRef ?? defaultRepoRef;
}

export function getDefaultRepo(): RepoRef {
  return { ...defaultRepoRef };
}

export function getSourceRepo(): RepoRef {
  return { ...sourceRepoRef };
}

// ─── Default API client (uses shared env token when provided) ───

const sharedToken = config.issueToken.trim();

function createPublicOctokit(token: string): Octokit {
  return token ? new Octokit({ auth: token }) : new Octokit();
}

function readStoredGitHubUserToken(): string {
  if (typeof window === "undefined") {
    return "";
  }
  try {
    return localStorage.getItem(GITHUB_USER_TOKEN_STORAGE_KEY)?.trim() ?? "";
  } catch {
    return "";
  }
}

function persistGitHubUserToken(token: string): void {
  if (typeof window === "undefined") {
    return;
  }
  try {
    if (token) {
      localStorage.setItem(GITHUB_USER_TOKEN_STORAGE_KEY, token);
      return;
    }
    localStorage.removeItem(GITHUB_USER_TOKEN_STORAGE_KEY);
  } catch {
    // Ignore localStorage errors (e.g. disabled storage in browser profile).
  }
}

let userToken = readStoredGitHubUserToken();
let publicOctokit = createPublicOctokit(userToken || sharedToken);

export function createAuthenticatedOctokit(token: string): Octokit {
  return new Octokit({ auth: token });
}

export function getGitHubUserToken(): string | null {
  return userToken || null;
}

export function setGitHubUserToken(token: string | null): void {
  userToken = token?.trim() ?? "";
  persistGitHubUserToken(userToken);
  publicOctokit = createPublicOctokit(userToken || sharedToken);
}

// ─── Source loading ───

export async function fetchBranches(
  repoRef?: RepoRef
): Promise<{ name: string; sha: string }[]> {
  const repo = resolveRepo(repoRef);
  const res = await publicOctokit.repos.listBranches({
    owner: repo.owner,
    repo: repo.repo,
    per_page: 100,
  });
  return res.data.map((b) => ({ name: b.name, sha: b.commit.sha }));
}

export async function fetchOpenPRs(repoRef?: RepoRef): Promise<
  {
    number: number;
    title: string;
    headRef: string;
    headSha: string;
    headOwner: string;
    headRepo: string;
  }[]
> {
  const repo = resolveRepo(repoRef);
  const res = await publicOctokit.pulls.list({
    owner: repo.owner,
    repo: repo.repo,
    state: "open",
    per_page: 100,
  });
  return res.data.map((pr) => ({
    number: pr.number,
    title: pr.title,
    headRef: pr.head.ref,
    headSha: pr.head.sha,
    headOwner: pr.head.repo?.owner?.login ?? repo.owner,
    headRepo: pr.head.repo?.name ?? repo.repo,
  }));
}

export async function fetchPullRequestHead(
  prNumber: number,
  repoRef?: RepoRef
): Promise<{ headRef: string; headSha: string }> {
  const repo = resolveRepo(repoRef);
  const pr = await publicOctokit.pulls.get({
    owner: repo.owner,
    repo: repo.repo,
    pull_number: prNumber,
  });

  return {
    headRef: pr.data.head.ref,
    headSha: pr.data.head.sha,
  };
}

export async function fetchPullRequestFiles(
  prNumber: number,
  repoRef?: RepoRef
): Promise<string[]> {
  const repo = resolveRepo(repoRef);
  const files = await publicOctokit.paginate(publicOctokit.pulls.listFiles, {
    owner: repo.owner,
    repo: repo.repo,
    pull_number: prNumber,
    per_page: 100,
  });

  return files
    .map((file) => file.filename)
    .filter((path): path is string => !!path);
}

export async function fetchStartableIssues(repoRef?: RepoRef): Promise<
  {
    number: number;
    title: string;
    body: string;
    url: string;
    state: "open" | "closed";
    updatedAt: string;
  }[]
> {
  const repo = resolveRepo(repoRef);
  const allIssues = await publicOctokit.paginate(
    publicOctokit.issues.listForRepo,
    {
      owner: repo.owner,
      repo: repo.repo,
      state: "all",
      per_page: 100,
    }
  );

  return allIssues
    .filter((issue) => !("pull_request" in issue))
    .map((issue) => ({
      number: issue.number,
      title: issue.title,
      body: issue.body ?? "",
      url: issue.html_url,
      state: (issue.state === "open" ? "open" : "closed") as "open" | "closed",
      updatedAt: issue.updated_at,
    }))
    .filter((issue) => isSmsGameIssue(issue))
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export async function fetchBranchSha(
  branch: string,
  repoRef?: RepoRef
): Promise<string> {
  const repo = resolveRepo(repoRef);
  const res = await publicOctokit.repos.getBranch({
    owner: repo.owner,
    repo: repo.repo,
    branch,
  });
  return res.data.commit.sha;
}

export async function fetchSourceRepoForks(): Promise<RepoRef[]> {
  const forks = await publicOctokit.paginate(publicOctokit.repos.listForks, {
    owner: sourceRepoRef.owner,
    repo: sourceRepoRef.repo,
    per_page: 100,
  });

  const bySlug = new Map<string, RepoRef>();
  const addRepo = (owner: string, repo: string) => {
    const slug = `${owner}/${repo}`;
    if (!bySlug.has(slug)) {
      bySlug.set(slug, { owner, repo });
    }
  };

  addRepo(sourceRepoRef.owner, sourceRepoRef.repo);
  addRepo(defaultRepoRef.owner, defaultRepoRef.repo);

  for (const fork of forks) {
    const owner = fork.owner?.login;
    const repo = fork.name;
    if (owner && repo) {
      addRepo(owner, repo);
    }
  }

  const items = Array.from(bySlug.values());
  const sourceSlug = `${sourceRepoRef.owner}/${sourceRepoRef.repo}`;

  return items.sort((a, b) => {
    const aSlug = `${a.owner}/${a.repo}`;
    const bSlug = `${b.owner}/${b.repo}`;
    if (aSlug === sourceSlug) {
      return -1;
    }
    if (bSlug === sourceSlug) {
      return 1;
    }
    return aSlug.localeCompare(bSlug, undefined, { sensitivity: "base" });
  });
}

// ─── Tree and file loading ───

export async function fetchRepoTree(
  sha: string,
  repoRef?: RepoRef
): Promise<FileEntry[]> {
  const repo = resolveRepo(repoRef);
  const res = await publicOctokit.git.getTree({
    owner: repo.owner,
    repo: repo.repo,
    tree_sha: sha,
    recursive: "true",
  });
  return (res.data.tree as { path?: string; sha?: string; type?: string }[])
    .filter(
      (item): item is { path: string; sha: string; type: string } =>
        !!item.path && !!item.sha && !!item.type
    )
    .map((item) => ({
      path: item.path,
      sha: item.sha,
      type: item.type as "blob" | "tree",
    }));
}

export async function fetchFileContent(
  path: string,
  ref: string,
  repoRef?: RepoRef
): Promise<string> {
  const repo = resolveRepo(repoRef);
  const res = await publicOctokit.repos.getContent({
    owner: repo.owner,
    repo: repo.repo,
    path,
    ref,
  });
  const data = res.data as { content?: string; encoding?: string };
  if (data.content && data.encoding === "base64") {
    return decodeBase64Utf8(data.content.replace(/\n/g, ""));
  }
  throw new Error(`Unexpected content format for ${path}`);
}

// ─── Bank indexing ───

const BANK_PATH_RE = /^src\/([^/]+)\/?$/;
const BANK_NAME_RE = /^(.+?)(?:_(\d+))?$/;
const BANK_FROM_BLOB_RE = /^src\/([^/]+)\/(?:formats\/.+\.txt|senders\.txt)$/;

export function indexBanksFromTree(tree: FileEntry[]): BankInfo[] {
  // Primary source: explicit tree folders src/<name>
  const bankFoldersFromTrees = tree
    .filter((e) => e.type === "tree" && BANK_PATH_RE.test(e.path))
    .map((e) => e.path);

  // Fallback source: infer bank folder from blob paths
  const bankFoldersFromBlobs = tree
    .filter((e) => e.type === "blob")
    .map((e) => BANK_FROM_BLOB_RE.exec(e.path)?.[1])
    .filter((folderName): folderName is string => !!folderName)
    .map((folderName) => `src/${folderName}`);

  const bankFolders = Array.from(
    new Set([...bankFoldersFromTrees, ...bankFoldersFromBlobs])
  );

  return bankFolders
    .map((folderPath) => {
      const folderName = folderPath.replace("src/", "");
      const nameMatch = BANK_NAME_RE.exec(folderName);
      const displayName = nameMatch?.[1] ?? folderName;
      const bankId = nameMatch?.[2] ?? null;

      const formatFiles = tree
        .filter(
          (e) =>
            e.type === "blob" &&
            e.path.startsWith(`${folderPath}/formats/`) &&
            e.path.endsWith(".txt")
        )
        .map((e) => e.path);

      const hasSenders = tree.some(
        (e) => e.type === "blob" && e.path === `${folderPath}/senders.txt`
      );

      return {
        displayName,
        folderPath,
        bankId,
        formatFiles: formatFiles.sort(),
        hasSenders,
      };
    })
    .sort((a, b) => a.displayName.localeCompare(b.displayName));
}

// ─── Publish operations (require auth) ───

export async function ensureFork(
  octokit: Octokit,
  repoRef?: RepoRef
): Promise<{ owner: string; repo: string }> {
  const target = resolveRepo(repoRef);
  try {
    const user = await octokit.users.getAuthenticated();
    const forkOwner = user.data.login;

    try {
      await octokit.repos.get({ owner: forkOwner, repo: target.repo });
      return { owner: forkOwner, repo: target.repo };
    } catch {
      // Fork doesn't exist — create it
      await octokit.repos.createFork({
        owner: target.owner,
        repo: target.repo,
      });
      // Wait a bit for fork to be ready
      await new Promise((resolve) => setTimeout(resolve, 3000));
      return { owner: forkOwner, repo: target.repo };
    }
  } catch (e) {
    throw new Error(
      `Failed to ensure fork: ${e instanceof Error ? e.message : String(e)}`
    );
  }
}

export async function createOrUpdateBranch(
  octokit: Octokit,
  forkOwner: string,
  branchName: string,
  baseSha: string,
  repoRef?: RepoRef
): Promise<void> {
  const target = resolveRepo(repoRef);
  const ref = `refs/heads/${branchName}`;
  try {
    await octokit.git.getRef({
      owner: forkOwner,
      repo: target.repo,
      ref: `heads/${branchName}`,
    });
    // Branch exists, update it
    await octokit.git.updateRef({
      owner: forkOwner,
      repo: target.repo,
      ref: `heads/${branchName}`,
      sha: baseSha,
      force: true,
    });
  } catch {
    // Branch doesn't exist, create it
    await octokit.git.createRef({
      owner: forkOwner,
      repo: target.repo,
      ref,
      sha: baseSha,
    });
  }
}

export async function createCommit(
  octokit: Octokit,
  forkOwner: string,
  branchName: string,
  parentSha: string,
  files: { path: string; content: string }[],
  message: string,
  repoRef?: RepoRef
): Promise<string> {
  const target = resolveRepo(repoRef);

  // Create blobs
  const blobs = await Promise.all(
    files.map(async (f) => {
      const blob = await octokit.git.createBlob({
        owner: forkOwner,
        repo: target.repo,
        content: encodeBase64Utf8(f.content),
        encoding: "base64",
      });
      return {
        path: f.path,
        sha: blob.data.sha,
        mode: "100644" as const,
        type: "blob" as const,
      };
    })
  );

  // Get base tree
  const parentCommit = await octokit.git.getCommit({
    owner: forkOwner,
    repo: target.repo,
    commit_sha: parentSha,
  });
  const baseTreeSha = parentCommit.data.tree.sha;

  // Create new tree
  const newTree = await octokit.git.createTree({
    owner: forkOwner,
    repo: target.repo,
    base_tree: baseTreeSha,
    tree: blobs,
  });

  // Create commit
  const commit = await octokit.git.createCommit({
    owner: forkOwner,
    repo: target.repo,
    message,
    tree: newTree.data.sha,
    parents: [parentSha],
  });

  // Update branch ref
  await octokit.git.updateRef({
    owner: forkOwner,
    repo: target.repo,
    ref: `heads/${branchName}`,
    sha: commit.data.sha,
  });

  return commit.data.sha;
}

export async function createPullRequest(
  octokit: Octokit,
  forkOwner: string,
  branchName: string,
  title: string,
  body: string,
  repoRef?: RepoRef
): Promise<{ url: string; number: number }> {
  const target = resolveRepo(repoRef);
  const pr = await octokit.pulls.create({
    owner: target.owner,
    repo: target.repo,
    title,
    body,
    head: `${forkOwner}:${branchName}`,
    base: config.defaultBranch,
  });
  return { url: pr.data.html_url, number: pr.data.number };
}

export async function validateToken(token: string): Promise<string> {
  const octokit = createAuthenticatedOctokit(token);
  const user = await octokit.users.getAuthenticated();
  return user.data.login;
}

export async function createIssue(
  octokit: Octokit,
  title: string,
  body: string,
  repoRef?: RepoRef
): Promise<{ url: string; number: number }> {
  const target = resolveRepo(repoRef);
  const issue = await octokit.issues.create({
    owner: target.owner,
    repo: target.repo,
    title,
    body,
  });
  return { url: issue.data.html_url, number: issue.data.number };
}

export async function fetchIssue(
  issueNumber: number,
  octokit?: Octokit,
  repoRef?: RepoRef
): Promise<{ number: number; title: string; body: string; url: string }> {
  const target = resolveRepo(repoRef);
  const api = octokit ?? publicOctokit;
  const issue = await api.issues.get({
    owner: target.owner,
    repo: target.repo,
    issue_number: issueNumber,
  });

  return {
    number: issue.data.number,
    title: issue.data.title,
    body: issue.data.body ?? "",
    url: issue.data.html_url,
  };
}
