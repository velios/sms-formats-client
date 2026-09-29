function binaryStringToBytes(binary: string): Uint8Array {
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

function bytesToBinaryString(bytes: Uint8Array): string {
  let binary = "";
  const chunkSize = 0x80_00;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    const chunk = bytes.subarray(offset, offset + chunkSize);
    binary += String.fromCharCode(...chunk);
  }
  return binary;
}

export function decodeBase64Utf8(base64: string): string {
  const binary = atob(base64);
  const bytes = binaryStringToBytes(binary);
  return new TextDecoder().decode(bytes);
}

export function encodeBase64Utf8(content: string): string {
  const bytes = new TextEncoder().encode(content);
  return btoa(bytesToBinaryString(bytes));
}
