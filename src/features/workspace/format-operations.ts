import { validateNewFormatPath } from "@/domain/format";
import type { BankInfo } from "@/domain/types";
import { replaceRecentFile } from "@/features/workspace/recent-files";
import { useSourceStore } from "@/store";

export function renameDraftFormat(params: {
  fromPath: string;
  toPath: string;
  bankPath: string;
  allFormatFiles: string[];
  draftStore: {
    getDraft: (
      filePath: string
    ) => { content: string; headContent: string | null } | undefined;
    renameDraft: (oldFilePath: string, newFilePath: string) => void;
  };
  setBanks: (banks: BankInfo[]) => void;
  currentRequestedFile: string | null;
  replaceRequestedFile: (filePath: string | null) => void;
}): boolean {
  const {
    fromPath,
    toPath,
    bankPath,
    allFormatFiles,
    draftStore,
    setBanks,
    currentRequestedFile,
    replaceRequestedFile,
  } = params;
  if (fromPath === toPath) {
    return true;
  }
  if (validateNewFormatPath(toPath, bankPath, allFormatFiles)) {
    return false;
  }
  const draft = draftStore.getDraft(fromPath);
  if (!draft || draft.headContent !== null) {
    return false;
  }

  draftStore.renameDraft(fromPath, toPath);
  replaceRecentFile(bankPath, fromPath, toPath);

  const currentBanks = useSourceStore.getState().banks;
  const nextBanks = currentBanks.map((item) => {
    if (item.folderPath !== bankPath) {
      return item;
    }
    if (!item.formatFiles.includes(fromPath)) {
      return item;
    }
    const renamedFormatFiles = item.formatFiles.map((path) =>
      path === fromPath ? toPath : path
    );
    return {
      ...item,
      formatFiles: Array.from(new Set(renamedFormatFiles)),
    };
  });
  setBanks(nextBanks);

  if (currentRequestedFile === fromPath) {
    replaceRequestedFile(toPath);
  }
  return true;
}
