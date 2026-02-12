import { del, get, keys, set } from "idb-keyval";
import type { DraftFile } from "../domain/types";

const PREFIX = "sms-formats-draft:";

function makeKey(sourceRef: string, filePath: string): string {
  return `${PREFIX}${sourceRef}:${filePath}`;
}

export async function saveDraft(draft: DraftFile): Promise<void> {
  const key = makeKey(draft.sourceRef, draft.filePath);
  await set(key, draft);
}

export async function loadDraft(
  sourceRef: string,
  filePath: string
): Promise<DraftFile | undefined> {
  const key = makeKey(sourceRef, filePath);
  return get<DraftFile>(key);
}

export async function deleteDraft(
  sourceRef: string,
  filePath: string
): Promise<void> {
  const key = makeKey(sourceRef, filePath);
  await del(key);
}

export async function loadAllDrafts(sourceRef?: string): Promise<DraftFile[]> {
  const allKeys = await keys();
  const draftKeys = allKeys.filter((k) => {
    const s = String(k);
    if (!s.startsWith(PREFIX)) {
      return false;
    }
    if (sourceRef) {
      return s.startsWith(`${PREFIX}${sourceRef}:`);
    }
    return true;
  });

  const drafts: DraftFile[] = [];
  for (const key of draftKeys) {
    const draft = await get<DraftFile>(key);
    if (draft) {
      drafts.push(draft);
    }
  }
  return drafts;
}

export async function clearDrafts(sourceRef: string): Promise<void> {
  const allKeys = await keys();
  const toDelete = allKeys.filter((k) =>
    String(k).startsWith(`${PREFIX}${sourceRef}:`)
  );
  for (const key of toDelete) {
    await del(key);
  }
}
