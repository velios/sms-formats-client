// Adapt execution only; stored patterns and editor offsets stay unchanged.
export function prepareBrowserRegex(pattern: string): {
  source: string;
  flags: string;
} {
  return pattern.startsWith("(?i)")
    ? { source: pattern.slice(4), flags: "i" }
    : { source: pattern, flags: "" };
}

export function tryCompile(pattern: string): {
  regex: RegExp | null;
  supportsIndices: boolean;
  error: string | null;
} {
  const { source, flags } = prepareBrowserRegex(pattern);
  try {
    return {
      regex: new RegExp(source, `${flags}d`),
      supportsIndices: true,
      error: null,
    };
  } catch {
    try {
      return {
        regex: new RegExp(source, flags),
        supportsIndices: false,
        error: null,
      };
    } catch (error) {
      return {
        regex: null,
        supportsIndices: false,
        error: error instanceof Error ? error.message : "Invalid regex",
      };
    }
  }
}
