// Preserve the source layout and normalize only EXAMPLE bodies.
export function normalizeExampleSections(
  raw: string,
  exampleIndex?: number
): string {
  let currentExample = -1;
  return raw
    .split("\n")
    .map((line) => {
      if (line.trim() === "-----EXAMPLE-----") {
        currentExample++;
        return line;
      }
      return currentExample >= 0 &&
        (exampleIndex === undefined || currentExample === exampleIndex)
        ? line.normalize("NFC")
        : line;
    })
    .join("\n");
}
