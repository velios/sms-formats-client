import type { BankInfo, FileEntry } from "./types";

const BANK_PATH_RE = /^src\/([^/]+)\/?$/;
const BANK_NAME_RE = /^(.+?)(?:_(\d+))?$/;
const BANK_FROM_BLOB_RE = /^src\/([^/]+)\/(?:formats\/.+\.txt|senders\.txt)$/;

export function indexBanksFromTree(tree: FileEntry[]): BankInfo[] {
  const bankFoldersFromTrees = tree
    .filter((e) => e.type === "tree" && BANK_PATH_RE.test(e.path))
    .map((e) => e.path);

  const bankFoldersFromBlobs = tree
    .filter((e) => e.type === "blob")
    .map((e) => BANK_FROM_BLOB_RE.exec(e.path)?.[1])
    .filter((folderName): folderName is string => !!folderName)
    .map((folderName) => `src/${folderName}`);

  const bankFolders = Array.from(
    new Set([...bankFoldersFromTrees, ...bankFoldersFromBlobs])
  );

  return bankFolders
    .map((folderPath) => {
      const folderName = folderPath.replace("src/", "");
      const nameMatch = BANK_NAME_RE.exec(folderName);
      const displayName = nameMatch?.[1] ?? folderName;
      const bankId = nameMatch?.[2] ?? null;

      const formatFiles = tree
        .filter(
          (e) =>
            e.type === "blob" &&
            e.path.startsWith(`${folderPath}/formats/`) &&
            e.path.endsWith(".txt")
        )
        .map((e) => e.path);

      const hasSenders = tree.some(
        (e) => e.type === "blob" && e.path === `${folderPath}/senders.txt`
      );

      return {
        displayName,
        folderPath,
        bankId,
        formatFiles: formatFiles.sort(),
        hasSenders,
      };
    })
    .sort((a, b) => a.displayName.localeCompare(b.displayName));
}
