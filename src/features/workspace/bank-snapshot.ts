import {
  isBankFormatFilePath,
  normalizeSmsText,
  parseFormatFile,
} from "@/domain/format";
import type { BankInfo, RepoRef } from "@/domain/types";
import { validateBankLevel } from "@/domain/validation";
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
  // Capture drafts before awaiting remote files.
  const drafts = new Map(
    filePaths.map((path) => [path, draftStore.getDraft(path)])
  );
  const remote = await loadFileContents({
    repository,
    commitSha: sourceRefName,
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
      regex: parsed.regex,
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

export async function validateBankSnapshot(params: {
  bank: BankInfo;
  bankPath: string;
  draftStore: DraftStoreLike & { drafts: Map<string, unknown> };
  sourceRefName: string;
  repository: RepoRef;
}) {
  const { bank, bankPath, draftStore } = params;
  const filePaths = [
    ...new Set([...bank.formatFiles, ...draftStore.drafts.keys()]),
  ].filter((path) => isBankFormatFilePath(path, bankPath));
  const sendersDraft = draftStore.getDraft(`${bankPath}/senders.txt`);
  const hasSenders = sendersDraft ? !sendersDraft.isDeleted : bank.hasSenders;
  const snapshot = await loadBankSnapshot({ ...params, filePaths });
  return validateBankLevel({ ...bank, hasSenders }, snapshot.contents);
}
