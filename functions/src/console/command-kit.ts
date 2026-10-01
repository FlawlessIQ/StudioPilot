import type { Auth, DecodedIdToken } from "firebase-admin/auth";
import type { Firestore } from "firebase-admin/firestore";
import type { Request } from "firebase-functions/v2/https";
import type { z } from "zod";
import type { ConsoleCapability, ConsoleRole } from "./roles.js";

/**
 * The shape of a Console command (docs/console.md).
 *
 * Each command declares the capability it needs and a Zod schema for its
 * input. saasAdminCommand does the rest the same way for every one: identity,
 * role, capability, schema, run, audit. A handler can't forget the audit
 * event or the permission check, because it never writes either.
 */
export type ConsoleContext = {
  db: Firestore;
  auth: Auth;
  identity: DecodedIdToken;
  role: ConsoleRole;
  now: string;
  request: Request;
};

export type ConsoleAudit = {
  /** "platform" when the action isn't about one studio. */
  tenantId: string | null;
  entityType: string;
  entityId: string;
  before?: unknown;
  after?: unknown;
  /** The written reason, for actions that require one. */
  reason?: string | null;
};

export type ConsoleOutcome = {
  result: Record<string, unknown>;
  /**
   * One event, or one per studio for a command that touched several (each
   * studio's timeline shows its own). null only for reads that change nothing.
   */
  audit: ConsoleAudit | ConsoleAudit[] | null;
};

export type ConsoleHandler<Schema extends z.ZodTypeAny = z.ZodTypeAny> = {
  capability: ConsoleCapability;
  input: Schema;
  /** Stripe-backed commands need the secret bound to the function. */
  run: (context: ConsoleContext, input: z.infer<Schema>) => Promise<ConsoleOutcome>;
};

export function consoleHandler<Schema extends z.ZodTypeAny>(definition: ConsoleHandler<Schema>): ConsoleHandler<Schema> {
  return definition;
}

/** A reason a person would recognise later in the audit log. */
export const REASON_MIN = 10;

/** Plain errors with a code the browser maps to words (lib/ai/friendly-error.ts). */
export function fail(code: string): never {
  throw new Error(code);
}
