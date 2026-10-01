import { decodeSmsPayload, type ExamplePositions } from "@/domain/format";

interface Notice {
  key: string;
  number?: number | string;
}

function resolveExample(
  hash: URLSearchParams,
  positions: ExamplePositions,
  baselineCount: number,
  count: number
): { index: number; notices: Notice[] } {
  const first = count ? 0 : -1;
  if (!hash.has("show-example")) {
    return { index: first, notices: [] };
  }
  const value = hash.get("show-example") ?? "";
  if (!/^[0-9]+$/.test(value) || BigInt(value) < 1n) {
    return { index: first, notices: [{ key: "editor.invalidExampleNumber" }] };
  }
  const number = BigInt(value);
  if (number > BigInt(baselineCount)) {
    return {
      index: first,
      notices: [{ key: "editor.exampleMissing", number: number.toString() }],
    };
  }
  const index = positions.indexOf(Number(number));
  return index >= 0
    ? { index, notices: [] }
    : {
        index: first,
        notices: [{ key: "editor.exampleDeleted", number: Number(number) }],
      };
}

export function resolveFormatAnchor(
  hashValue: string,
  examples: string[],
  positions: ExamplePositions,
  baselineCount: number,
  readOnly: boolean
): { index: number; notices: Notice[]; append?: string } {
  const hash = new URLSearchParams(hashValue.replace(/^#/, ""));
  const notices: Notice[] = [];
  if (hash.has("add-sms")) {
    const sms = decodeSmsPayload(hash.get("add-sms") ?? "");
    if (sms === null) {
      notices.push({ key: "editor.invalidSmsPayload" });
    } else if (
      sms.split("\n").some((line) => line.trim() === "-----EXAMPLE-----")
    ) {
      notices.push({ key: "editor.reservedSmsDelimiter" });
    } else {
      const index = examples.indexOf(sms);
      if (index >= 0) {
        return {
          index,
          notices: [{ key: "editor.smsAlreadyExists", number: index + 1 }],
        };
      }
      if (!readOnly) {
        return { index: examples.length, notices: [], append: sms };
      }
      notices.push({ key: "editor.importReadOnly" });
    }
  }
  const selection = resolveExample(
    hash,
    positions,
    baselineCount,
    examples.length
  );
  return { ...selection, notices: [...notices, ...selection.notices] };
}
