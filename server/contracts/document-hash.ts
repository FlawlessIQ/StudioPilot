import { createHash } from "node:crypto";
import { canonicalJson, type ContractDocument } from "@/features/contracts/document";

/**
 * The hash a signature is bound to. Mirrored at
 * functions/src/contracts/document-hash.ts; tests/contract-document.test.ts
 * holds the two to the same answer.
 */
export function contractDocumentHash(document: ContractDocument): string {
  return createHash("sha256").update(canonicalJson(document), "utf8").digest("hex");
}

export function sha256Text(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}
