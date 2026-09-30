export async function loadData<T = Record<string, unknown>>(
  name: string
): Promise<T> {
  const manifest = JSON.parse(
    document.getElementById("app-data")!.textContent!
  ) as Record<string, string>;
  const response = await fetch(manifest[name]!);
  if (!response.ok) {
    throw new Error(`Failed to load ${name}: HTTP ${response.status}`);
  }
  return await response.json();
}
