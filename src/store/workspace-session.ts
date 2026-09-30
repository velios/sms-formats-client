import { z } from "zod/v4";
import type { PullRequestWorkspaceResolution } from "@/domain/pull-request-workspace";
import type { RepoRef } from "@/domain/types";
import { useDraftStore } from "@/store";
import { makeDraftSourceKey } from "./draft-scope";

export type WorkspaceSession = Extract<
  PullRequestWorkspaceResolution,
  { status: "supported" }
>;

export interface SavedWorkspaceSession {
  session: WorkspaceSession;
  pendingPublishedHeadSha?: string;
}

const savedSessionSchema = z.object({
  session: z.object({
    status: z.literal("supported"),
    repository: z.object({ owner: z.string().min(1), repo: z.string().min(1) }),
    prNumber: z.number().int().positive(),
    headSha: z.string().min(1),
    baseSha: z.string().min(1),
    bankPath: z.string().min(1),
    writable: z.boolean(),
    readOnlyReason: z.literal("no-write-access").nullable(),
    changedFiles: z.array(
      z.object({
        kind: z.enum(["add", "modify", "delete", "rename"]),
        path: z.string(),
        oldPath: z.string().optional(),
      })
    ),
  }),
  pendingPublishedHeadSha: z.string().min(1).optional(),
});

export function workspaceScope(repository: RepoRef, prNumber: number): string {
  return makeDraftSourceKey({ type: "pr", prNumber }, repository);
}

export function loadWorkspaceSession(
  repository: RepoRef,
  prNumber: number
): SavedWorkspaceSession | null {
  const result = savedSessionSchema.safeParse(
    useDraftStore.getState().workspaceSessionsByScope[
      workspaceScope(repository, prNumber)
    ]
  );
  if (
    !result.success ||
    result.data.session.repository.owner !== repository.owner ||
    result.data.session.repository.repo !== repository.repo ||
    result.data.session.prNumber !== prNumber
  ) {
    return null;
  }
  return result.data;
}

export function saveWorkspaceSession(saved: SavedWorkspaceSession): void {
  const { session } = saved;
  useDraftStore
    .getState()
    .saveWorkspaceSession(
      workspaceScope(session.repository, session.prNumber),
      saved
    );
}
