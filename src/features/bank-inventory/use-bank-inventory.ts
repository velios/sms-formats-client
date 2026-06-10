import { useMemo } from "react";
import { useDraftStore } from "@/store";
import {
  type BankInventory,
  buildBankInventory,
  type SourceChangeRecord,
} from "./core";

const NO_REMOTE_FORMAT_FILES: string[] = [];

export interface UseBankInventoryParams {
  bankPath: string;
  sendersPath: string;
  remoteFormatFiles: string[] | undefined;
  // The already-chosen source of source changes; the fallback chain
  // session → store → PR fetch is the caller's concern (ADR-0014).
  sourceChanges: SourceChangeRecord[];
}

// The hook subscribes to the draft store itself; everything else comes in as
// parameters (ADR-0014).
export function useBankInventory(
  params: UseBankInventoryParams
): BankInventory {
  const { bankPath, sendersPath, remoteFormatFiles, sourceChanges } = params;
  const draftStore = useDraftStore();

  return useMemo(
    () =>
      buildBankInventory({
        bankPath,
        sendersPath,
        remoteFormatFiles: remoteFormatFiles ?? NO_REMOTE_FORMAT_FILES,
        draftPaths: Array.from(draftStore.drafts.keys()),
        localChanges: draftStore.getChangedFiles(),
        sourceChanges,
      }),
    [
      bankPath,
      sendersPath,
      remoteFormatFiles,
      sourceChanges,
      draftStore,
      draftStore.drafts,
    ]
  );
}
