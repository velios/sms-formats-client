export function decodeRequestedFileValue(
  searchParams: URLSearchParams
): string | null {
  const rawValue = searchParams.get("file");
  if (!rawValue) {
    return null;
  }
  try {
    return decodeURIComponent(rawValue);
  } catch {
    return rawValue;
  }
}

export function buildSelectionSearch(
  searchParams: URLSearchParams,
  filePath: string | null
): string {
  const nextSearchParams = new URLSearchParams(searchParams);
  if (filePath) {
    nextSearchParams.set("file", filePath);
  } else {
    nextSearchParams.delete("file");
  }
  const search = nextSearchParams.toString();
  return search ? `?${search}` : "";
}
