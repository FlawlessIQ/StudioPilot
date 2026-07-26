import { createHash } from "node:crypto";
export function hashReplyToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}
export function validateInboundPdf(input: { contentType: string; filename: string; sizeBytes: number }) {
  if (input.contentType !== "application/pdf" || !input.filename.toLowerCase().endsWith(".pdf")) throw new Error("COI attachment must be a PDF.");
  if (input.sizeBytes <= 0 || input.sizeBytes > 15 * 1024 * 1024) throw new Error("COI attachment exceeds the 15 MB limit.");
}
