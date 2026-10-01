import { normalizeSmsText } from "./regex";
import { prepareBrowserRegex } from "./regex-compiler";

const REGEX101_BASE_URL = "https://regex101.com/";

interface BuildRegex101UrlOptions {
  flags?: string;
}

export function buildRegex101Url(
  regex: string,
  testString: string,
  options: BuildRegex101UrlOptions = {}
): string {
  const { source, flags } = prepareBrowserRegex(regex);
  const params = new URLSearchParams({
    regex: source,
    testString: normalizeSmsText(testString),
    flavor: "javascript",
  });

  const combinedFlags = [...new Set(`${options.flags ?? ""}${flags}`)].join("");
  if (combinedFlags) {
    params.set("flags", combinedFlags);
  }

  return `${REGEX101_BASE_URL}?${params.toString()}`;
}
