import { z } from "zod/v4";

const repoSlugSchema = z
  .string()
  .min(3)
  .regex(/^[^/\s]+\/[^/\s]+$/, "Repository must have format owner/repo");

const envSchema = z.object({
  sourceRepo: z
    .string()
    .min(3)
    .transform((value) => value.trim()),
  defaultSourceRepo: z
    .string()
    .optional()
    .transform((value) => value?.trim() ?? ""),
  defaultBranch: z.string().min(1),
  issueToken: z
    .string()
    .optional()
    .transform((value) => value ?? ""),
});

function splitRepoSlug(slug: string): { owner: string; repo: string } {
  const [owner, repo] = slug.split("/");
  if (!(owner && repo)) {
    throw new Error(`Invalid repository slug: ${slug}`);
  }
  return { owner, repo };
}

const parsedEnv = envSchema.parse({
  sourceRepo: import.meta.env.VITE_GITHUB_SOURCE_REPO,
  defaultSourceRepo: import.meta.env.VITE_GITHUB_DEFAULT_SOURCE_REPO,
  defaultBranch: import.meta.env.VITE_DEFAULT_BRANCH,
  issueToken: import.meta.env.VITE_GITHUB_ISSUE_TOKEN,
});

const sourceRepoSlug = repoSlugSchema.parse(parsedEnv.sourceRepo);
const defaultSourceRepoSlug = repoSlugSchema.parse(
  parsedEnv.defaultSourceRepo || parsedEnv.sourceRepo
);
const { owner: sourceOwner, repo: sourceRepo } = splitRepoSlug(
  repoSlugSchema.parse(sourceRepoSlug)
);
const { owner: defaultSourceOwner, repo: defaultSourceRepo } = splitRepoSlug(
  repoSlugSchema.parse(defaultSourceRepoSlug)
);

export interface AppConfig {
  sourceOwner: string;
  sourceRepo: string;
  defaultSourceOwner: string;
  defaultSourceRepo: string;
  defaultBranch: string;
  issueToken: string;
}

export const config: AppConfig = {
  sourceOwner,
  sourceRepo,
  defaultSourceOwner,
  defaultSourceRepo,
  defaultBranch: parsedEnv.defaultBranch,
  issueToken: parsedEnv.issueToken,
};
