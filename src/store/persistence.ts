import { del, get, set } from "idb-keyval";
import type { StateStorage } from "zustand/middleware";

export const DRAFT_STORE_STORAGE_KEY = "sms-formats-draft-store";

let latestWrite: Promise<void> = Promise.resolve();

export function waitForDraftPersistence(): Promise<void> {
  return latestWrite;
}

export const draftStoreStateStorage: StateStorage = {
  getItem: async (name) => (await get<string>(name)) ?? null,
  removeItem: async (name) => {
    await del(name);
  },
  setItem: (name, value) => {
    latestWrite = Promise.resolve(set(name, value));
    return latestWrite;
  },
};
