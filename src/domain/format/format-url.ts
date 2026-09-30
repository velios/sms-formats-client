import type { RepoRef, SourceTarget } from "@/domain/types";

export function encodeSmsPayload(sms: string): string {
  const bytes = new TextEncoder().encode(sms);
  return btoa(Array.from(bytes, (byte) => String.fromCharCode(byte)).join(""))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/[=]+$/, "");
}

export function decodeSmsPayload(payload: string): string | null {
  if (!/^[A-Za-z0-9_-]*$/.test(payload) || payload.length % 4 === 1) {
    return null;
  }
  try {
    const bytes = Uint8Array.from(
      atob(payload.replaceAll("-", "+").replaceAll("_", "/")),
      (char) => char.charCodeAt(0)
    );
    const sms = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    return encodeSmsPayload(sms) === payload ? sms : null;
  } catch {
    return null;
  }
}

export function buildFormatUrl({
  origin,
  repository,
  source,
  filePath,
  showExample,
  sms,
}: {
  origin: string;
  repository: RepoRef;
  source: SourceTarget;
  filePath: string;
  showExample?: number | null;
  sms?: string;
}): string {
  const path = `/repo/${encodeURIComponent(repository.owner)}/${encodeURIComponent(repository.repo)}/${source.type === "main" ? "main" : `pr/${source.prNumber}`}`;
  const url = new URL(path, origin);
  url.searchParams.set("file", filePath);
  if (sms !== undefined) {
    url.hash = `add-sms=${encodeSmsPayload(sms)}`;
  } else if (showExample) {
    url.hash = `show-example=${showExample}`;
  }
  return url.href;
}
