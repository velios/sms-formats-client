const REGEX101_BASE_URL = "https://regex101.com/";

interface BuildRegex101UrlOptions {
  flags?: string;
}

export function buildRegex101Url(
  regex: string,
  testString: string,
  options: BuildRegex101UrlOptions = {}
): string {
  const params = new URLSearchParams({
    regex,
    testString,
    flavor: "javascript",
  });

  if (options.flags) {
    params.set("flags", options.flags);
  }

  return `${REGEX101_BASE_URL}?${params.toString()}`;
}
