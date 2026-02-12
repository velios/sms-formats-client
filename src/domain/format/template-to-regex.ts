export type TemplateRegexPrecision = "rough" | "accurate";

const PLACEHOLDER_RE = /\$\{([^}]+)\}/g;

const DATE_TOKEN_MAP: Record<string, string> = {
  yyyy: "\\d{4}",
  yy: "\\d{2}",
  MM: "\\d{2}",
  M: "\\d{1,2}",
  dd: "\\d{2}",
  d: "\\d{1,2}",
  HH: "\\d{2}",
  H: "\\d{1,2}",
  hh: "\\d{2}",
  h: "\\d{1,2}",
  mm: "\\d{2}",
  m: "\\d{1,2}",
  ss: "\\d{2}",
  s: "\\d{1,2}",
};

const SORTED_DATE_TOKENS = Object.keys(DATE_TOKEN_MAP).sort(
  (a, b) => b.length - a.length
);

export function extractTemplatePlaceholders(template: string): string[] {
  const names: string[] = [];
  let match: RegExpExecArray | null = null;
  while ((match = PLACEHOLDER_RE.exec(template)) !== null) {
    const value = (match[1] ?? "").trim();
    if (value && !names.includes(value)) {
      names.push(value);
    }
  }
  return names;
}

export function convertTemplateToRegex(
  template: string,
  precision: TemplateRegexPrecision
): string {
  const parts: string[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null = null;

  while ((match = PLACEHOLDER_RE.exec(template)) !== null) {
    if (match.index > lastIndex) {
      parts.push(
        escapeLiteral(template.slice(lastIndex, match.index), precision)
      );
    }
    parts.push(patternForPlaceholder(match[1] ?? "", precision));
    lastIndex = match.index + match[0].length;
  }

  if (lastIndex < template.length) {
    parts.push(escapeLiteral(template.slice(lastIndex), precision));
  }

  return `^${parts.join("")}$`;
}

function patternForPlaceholder(
  raw: string,
  precision: TemplateRegexPrecision
): string {
  if (precision === "rough") {
    return "(.+?)";
  }

  const normalized = raw.trim();
  const [baseRaw = "", param = ""] = normalized.split("#");
  const base = baseRaw.toLowerCase();

  switch (base) {
    case "date":
      return buildDatePattern(param);
    case "time":
      return "(\\d{1,2}:\\d{2}(?::\\d{2})?)";
    case "income":
    case "outcome":
    case "balance":
    case "av_balance":
      return "([\\d\\s.,]+)";
    case "instrument":
    case "acc_instrument":
      return "([A-Za-zА-Яа-я]{3}|[$€£¥₽])";
    case "mcc":
      return "(\\d{4})";
    case "cardnumber":
      return "([\\d*Xx]{4,})";
    default:
      return "(.+?)";
  }
}

function buildDatePattern(dateTemplate: string): string {
  if (!dateTemplate.trim()) {
    return "(\\d{1,2}[./-]\\d{1,2}(?:[./-]\\d{2,4})?)";
  }

  let pattern = "";
  let cursor = 0;

  while (cursor < dateTemplate.length) {
    const token = SORTED_DATE_TOKENS.find((item) =>
      dateTemplate.startsWith(item, cursor)
    );
    if (token) {
      pattern += DATE_TOKEN_MAP[token];
      cursor += token.length;
      continue;
    }

    const char = dateTemplate[cursor]!;
    if (/\s/.test(char)) {
      pattern += "\\s*";
    } else {
      pattern += escapeRegex(char);
    }
    cursor += 1;
  }

  return `(${pattern})`;
}

function escapeLiteral(
  value: string,
  precision: TemplateRegexPrecision
): string {
  const escaped = escapeRegex(value);
  if (precision === "accurate") {
    return escaped.replace(/\s+/g, "\\s+");
  }
  return escaped;
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
