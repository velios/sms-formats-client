import { z } from "zod/v4";

const envSchema = z.object({
  owner: z.string().min(1),
  repo: z.string().min(1),
  defaultBranch: z.string().min(1),
  issueToken: z
    .string()
    .optional()
    .transform((value) => value ?? ""),
});

export type AppConfig = z.infer<typeof envSchema>;

export const config: AppConfig = envSchema.parse({
  owner: import.meta.env.VITE_GITHUB_OWNER,
  repo: import.meta.env.VITE_GITHUB_REPO,
  defaultBranch: import.meta.env.VITE_DEFAULT_BRANCH,
  issueToken: import.meta.env.VITE_GITHUB_ISSUE_TOKEN,
});
