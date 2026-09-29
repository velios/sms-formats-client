export function isBankFormatFilePath(path: string, bankPath: string): boolean {
  return path.startsWith(`${bankPath}/formats/`) && path.endsWith(".txt");
}

export function validateNewFormatPath(
  path: string,
  bankPath: string,
  existingPaths: Iterable<string>
): "invalidFormatName" | "formatExists" | null {
  const prefix = `${bankPath}/formats/`;
  const name = path.slice(prefix.length);
  if (
    !(path.startsWith(prefix) && name.endsWith(".txt")) ||
    name === ".txt" ||
    /[\\/]/.test(name) ||
    [...name].some((char) => char.charCodeAt(0) < 32) ||
    name.includes("..")
  ) {
    return "invalidFormatName";
  }
  return new Set(existingPaths).has(path) ? "formatExists" : null;
}
