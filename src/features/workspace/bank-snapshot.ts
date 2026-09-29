import { normalizeSmsText, parseFormatFile } from "@/domain/format";
import type { RepoRef } from "@/domain/types";
import { loadFileContents } from "@/infrastructure/file-content";

export interface LoadedFormat {
  filePath: string;
  fileName: string;
  regex: string;
  examples: string[];
  source: "draft" | "remote";
}

export interface DraftStoreLike {
  getDraft: (
    filePath: string
  ) => { content: string; isDeleted?: boolean } | undefined;
}

export type BankSnapshot = Awaited<ReturnType<typeof loadBankSnapshot>>;

export async function loadBankSnapshot(params: {
  filePaths: string[];
  draftStore: DraftStoreLike;
  sourceRefName: string;
  repository: RepoRef;
}) {
  const { filePaths, draftStore, sourceRefName, repository } = params;
  const drafts = new Map(
    filePaths.map((path) => [path, draftStore.getDraft(path)])
  );
  const remote = await loadFileContents({
    repository,
    refName: sourceRefName,
    filePaths: [...new Set(filePaths)].filter((path) => !drafts.get(path)),
  });
  const contents = new Map(remote.contents);
  for (const [path, draft] of drafts) {
    if (!draft) {
      continue;
    }
    if (draft.isDeleted) {
      contents.delete(path);
    } else {
      contents.set(path, draft.content);
    }
  }
  const entries: LoadedFormat[] = [...contents].map(([filePath, content]) => {
    const parsed = parseFormatFile(content, filePath);
    return {
      filePath,
      fileName: filePath.split("/").pop() ?? filePath,
      content,
      regex: parsed.regex.trim(),
      examples: parsed.examples.filter(
        (example) => normalizeSmsText(example) !== ""
      ),
      source: drafts.get(filePath) ? "draft" : "remote",
    };
  });
  return {
    contents,
    entries,
    loadErrorsCount: 0,
    cachedCount: remote.cachedCount,
    remoteFetchedCount: remote.remoteFetchedCount,
  };
}
