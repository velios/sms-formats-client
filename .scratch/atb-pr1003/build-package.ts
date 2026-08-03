// Synthetic assembly of the prompt package for АТБ-ru / PR 1003, using the same
// pure builder the client uses. Layers: main = upstream origin/main, pr = files
// added/changed by PR 1003, draft = empty.

import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { COOKBOOK_MARKDOWN } from "@/content/cookbook.generated";
import { FORMAT_RULES_MARKDOWN } from "@/content/format-rules.generated";
import { SNIPPETS_TOML } from "@/content/snippets.generated";
import {
  buildPromptPackage,
  PROMPT_PRESETS,
  type PromptPackageFile,
} from "@/features/prompt-package/core";

const UPSTREAM = "/Users/flocktory/Code/2_zen/tools/sms-formats";
const BANK_PATH = "src/АТБ-ru_4679";
const BANK_NAME = "АТБ-ru";
const PR_HEAD = "10f8d1011c8da08276cc23abb96891b886c21951";
const PR_ADDED = [`${BANK_PATH}/formats/Перевод Юлия Дмитриевна В Списано р СБП.txt`];

function git(args: string[]): string {
  const res = spawnSync("git", args, { cwd: UPSTREAM, encoding: "utf8", maxBuffer: 1 << 28 });
  if (res.status !== 0) {
    throw new Error(`git ${args.join(" ")}: ${res.stderr}`);
  }
  return res.stdout;
}

function fileName(path: string): string {
  return path.split("/").pop() ?? path;
}

function sortByDisplayName(paths: string[]): string[] {
  return [...paths].sort((a, b) => {
    const byName = fileName(a).localeCompare(fileName(b), undefined, { sensitivity: "base" });
    return byName !== 0 ? byName : a.localeCompare(b, undefined, { sensitivity: "base" });
  });
}

// `git ls-tree -z` keeps names raw: the bank has Cyrillic paths.
const mainPaths = git(["ls-tree", "-r", "--name-only", "-z", "origin/main", `${BANK_PATH}/`])
  .split("\0")
  .filter((path) => path !== "")
  .filter((path) => !PR_ADDED.includes(path));

function read(ref: string, path: string): string {
  return git(["show", `${ref}:${path}`]);
}

const mainFiles: PromptPackageFile[] = sortByDisplayName(mainPaths).map((path) => ({
  path,
  content: read("origin/main", path),
}));

// PR head bodies come from `gh api` — the upstream clone is left untouched.
const prFiles: PromptPackageFile[] = [...PR_ADDED].sort().map((path, index) => ({
  path,
  content: readFileSync(process.argv[3 + index] ?? "pr-file.txt", "utf8"),
}));

const task = PROMPT_PRESETS.find((preset) => preset.key === "fixChanged")?.task;
if (!task) {
  throw new Error("fixChanged preset not found");
}

const built = buildPromptPackage({
  bankName: BANK_NAME,
  bankPath: BANK_PATH,
  layers: { main: mainFiles, pr: prFiles, draft: [] },
  documents: [
    { name: "cookbook.md", content: COOKBOOK_MARKDOWN },
    { name: "format-rules.md", content: FORMAT_RULES_MARKDOWN },
    { name: "regex-snippets.toml", content: SNIPPETS_TOML },
  ],
  task,
  skipped: [],
});

writeFileSync(process.argv[2] ?? "package.txt", built.text);
console.log(JSON.stringify(built.summary, null, 2));
