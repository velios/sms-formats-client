export function isBankFormatFilePath(path: string, bankPath: string): boolean {
  return path.startsWith(`${bankPath}/formats/`) && path.endsWith(".txt");
}
