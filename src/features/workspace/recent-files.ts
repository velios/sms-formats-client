const RECENT_FILES_KEY = "sms-formats-recent-formats";
const MAX_RECENT_FILES = 10;

export function getRecentFiles(bankPath: string): string[] {
  try {
    const data = JSON.parse(localStorage.getItem(RECENT_FILES_KEY) ?? "{}");
    return (data[bankPath] ?? []) as string[];
  } catch {
    return [];
  }
}

export function addRecentFile(bankPath: string, filePath: string) {
  try {
    const data = JSON.parse(localStorage.getItem(RECENT_FILES_KEY) ?? "{}");
    const list: string[] = data[bankPath] ?? [];
    const filtered = list.filter((f: string) => f !== filePath);
    filtered.unshift(filePath);
    data[bankPath] = filtered.slice(0, MAX_RECENT_FILES);
    localStorage.setItem(RECENT_FILES_KEY, JSON.stringify(data));
  } catch {
    // Browser storage may be unavailable.
  }
}

export function replaceRecentFile(
  bankPath: string,
  oldPath: string,
  newPath: string
) {
  try {
    const data = JSON.parse(localStorage.getItem(RECENT_FILES_KEY) ?? "{}");
    const list: string[] = data[bankPath] ?? [];
    const replaced = list.map((path: string) =>
      path === oldPath ? newPath : path
    );
    const deduped = Array.from(new Set(replaced));
    data[bankPath] = deduped.slice(0, MAX_RECENT_FILES);
    localStorage.setItem(RECENT_FILES_KEY, JSON.stringify(data));
  } catch {
    // Browser storage may be unavailable.
  }
}
