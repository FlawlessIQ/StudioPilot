import { createHash } from "node:crypto";

/** An address's key in `vendorInvites` and `emailSuppressions`: sha256 of it, trimmed and lower-cased. */
export const emailHash = (email: string): string => createHash("sha256").update(email.trim().toLowerCase()).digest("hex");
