const allowedExtensions = new Set([
  "pdf",
  "doc",
  "docx",
  "txt",
  "csv",
  "rtf",
]);

const allowedContentTypes = new Set([
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "text/plain",
  "text/csv",
  "application/rtf",
  "text/rtf",
  "application/octet-stream",
]);

export const studioImportMaxFileBytes = 12 * 1024 * 1024;
export const studioImportMaxFiles = 12;

export function studioImportExtension(name: string): string {
  const extension = name.toLowerCase().split(".").at(-1) ?? "";
  if (!allowedExtensions.has(extension)) {
    throw new Error("UNSUPPORTED_FILE_EXTENSION");
  }
  return extension;
}

export function validateStudioImportMetadata(input: {
  name: string;
  sizeBytes: number;
  contentType: string;
}): { extension: string; contentType: string } {
  if (!Number.isInteger(input.sizeBytes) || input.sizeBytes <= 0) {
    throw new Error("EMPTY_FILE");
  }
  if (input.sizeBytes > studioImportMaxFileBytes) {
    throw new Error("FILE_TOO_LARGE");
  }
  const extension = studioImportExtension(input.name);
  const contentType = input.contentType || "application/octet-stream";
  if (!allowedContentTypes.has(contentType)) {
    throw new Error("UNSUPPORTED_CONTENT_TYPE");
  }
  return { extension, contentType };
}

function startsWith(bytes: Uint8Array, signature: readonly number[]): boolean {
  return signature.every((value, index) => bytes[index] === value);
}

function looksLikeText(bytes: Uint8Array): boolean {
  const sample = bytes.subarray(0, Math.min(bytes.length, 4096));
  if (sample.some((value) => value === 0)) return false;
  try {
    new TextDecoder("utf-8", { fatal: true }).decode(sample);
    return true;
  } catch {
    return false;
  }
}

export function verifyStudioImportFileSignature(
  bytes: Uint8Array,
  extension: string,
): boolean {
  if (bytes.length === 0) return false;
  if (extension === "pdf") {
    return startsWith(bytes, [0x25, 0x50, 0x44, 0x46, 0x2d]);
  }
  if (extension === "doc") {
    return startsWith(bytes, [
      0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1,
    ]);
  }
  if (extension === "docx") {
    return (
      startsWith(bytes, [0x50, 0x4b, 0x03, 0x04]) ||
      startsWith(bytes, [0x50, 0x4b, 0x05, 0x06]) ||
      startsWith(bytes, [0x50, 0x4b, 0x07, 0x08])
    );
  }
  if (extension === "rtf") {
    return new TextDecoder().decode(bytes.subarray(0, 5)) === "{\\rtf";
  }
  if (extension === "txt" || extension === "csv") {
    return looksLikeText(bytes);
  }
  return false;
}

export function studioImportObjectPath(input: {
  tenantId: string;
  sessionId: string;
  itemId: string;
  uploadId: string;
  extension: string;
}): string {
  const safePart = /^[a-zA-Z0-9_-]+$/;
  for (const part of [
    input.tenantId,
    input.sessionId,
    input.itemId,
    input.uploadId,
  ]) {
    if (!safePart.test(part)) throw new Error("INVALID_STORAGE_PATH_PART");
  }
  if (!allowedExtensions.has(input.extension)) {
    throw new Error("UNSUPPORTED_FILE_EXTENSION");
  }
  return [
    "tenants",
    input.tenantId,
    "studio-imports",
    input.sessionId,
    input.itemId,
    input.uploadId,
    `source.${input.extension}`,
  ].join("/");
}
