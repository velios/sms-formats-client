export function decodeRequestedFileValue(
  searchParams: URLSearchParams
): string | null {
  return searchParams.get("file") || null;
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
