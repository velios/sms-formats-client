import { del } from "idb-keyval";
import { DRAFT_STORE_STORAGE_KEY } from "./persistence";

const APP_STORAGE_PREFIX = "sms-formats-";
const GITHUB_USER_TOKEN_STORAGE_KEY = "sms-formats-github-user-token";

function listLocalStorageKeys(storage: Storage): string[] {
  const keys: string[] = [];
  for (let index = 0; index < storage.length; index += 1) {
    const key = storage.key(index);
    if (typeof key === "string") {
      keys.push(key);
    }
  }
  return keys;
}

function clearAppLocalStorage(storage: Storage): void {
  const keys = listLocalStorageKeys(storage);
  for (const key of keys) {
    if (
      key.startsWith(APP_STORAGE_PREFIX) &&
      key !== GITHUB_USER_TOKEN_STORAGE_KEY
    ) {
      storage.removeItem(key);
    }
  }
}

export async function hardResetAppState(): Promise<void> {
  if (typeof window === "undefined") {
    return;
  }

  try {
    clearAppLocalStorage(localStorage);
  } catch {
    // Ignore storage failures in restricted browser profiles.
  }

  try {
    await del(DRAFT_STORE_STORAGE_KEY);
  } catch {
    // Ignore IndexedDB failures in restricted browser profiles.
  }

  globalThis.location.reload();
}
