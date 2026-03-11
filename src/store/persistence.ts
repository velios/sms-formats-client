import { del, get, set } from "idb-keyval";
import type { StateStorage } from "zustand/middleware";

export const DRAFT_STORE_STORAGE_KEY = "sms-formats-draft-store";

export const draftStoreStateStorage: StateStorage = {
  getItem: async (name) => (await get<string>(name)) ?? null,
  removeItem: async (name) => {
    await del(name);
  },
  setItem: async (name, value) => {
    await set(name, value);
  },
};
