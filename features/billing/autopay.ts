/**
 * Where a studio stands on autopay, for the settings card.
 *
 * Mirrors the payments scope in functions/src/billing/autopay-core.ts — the
 * functions package is separate and cannot be imported here.
 *
 * Pure, no I/O.
 */

export const QUICKBOOKS_PAYMENTS_SCOPE = "com.intuit.quickbooks.payment";

type Row = Record<string, unknown>;

export type AutopayStudioState = {
  /** 1 connect QuickBooks · 2 grant payments · 3 ready to offer. */
  step: 1 | 2 | 3;
  enabled: boolean;
  activeCards: number;
  /** A card was refused because QuickBooks Payments is not active. */
  paymentsRefused: boolean;
};

export function autopayStudioState(input: {
  connection: Row | null;
  tenant: Row | null;
  methods: Row[];
}): AutopayStudioState {
  const connected = input.connection?.status === "connected";
  const granted =
    connected &&
    (input.connection?.mockMode === true ||
      (Array.isArray(input.connection?.scopes) &&
        (input.connection.scopes as unknown[]).includes(QUICKBOOKS_PAYMENTS_SCOPE)));
  const autopay = input.tenant?.autopay;
  const enabled =
    granted && typeof autopay === "object" && autopay !== null && (autopay as Row).enabled === true;
  return {
    step: !connected ? 1 : !granted ? 2 : 3,
    enabled,
    activeCards: input.methods.filter((method) => method.status === "active").length,
    // Only refusals since the current connection — reconnecting is the fix.
    paymentsRefused: input.methods.some(
      (method) =>
        method.status === "failed" &&
        String(method.updatedAt ?? "") > String(input.connection?.connectedAt ?? "") &&
        (method.failureCode === "QUICKBOOKS_PAYMENTS_NOT_ACTIVE" ||
          method.failureCode === "QUICKBOOKS_PAYMENTS_NOT_GRANTED"),
    ),
  };
}
