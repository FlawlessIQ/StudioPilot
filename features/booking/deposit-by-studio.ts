/**
 * A booking whose signature raises no deposit invoice.
 *
 * When the agreement went out with no QuickBooks or Stripe connected, the
 * booking plan records `policy.createRetainerAfterSignature: false`
 * (functions/src/contracts/combined-commands.ts, booking/commands.ts). The
 * client then pays the studio directly — by check, cash or transfer — and the
 * studio records it on the booking page, which books the date.
 *
 * Read the same way by the job's journey ("Record the deposit", never "Create
 * retainer invoice"), Today (connect payments before they sign) and the
 * client portal (arrange it with the studio, never "on its way"). Found
 * walking Riley Park's DJ booking on prod, 2026-10-09.
 */
export function depositByStudio(plan: Readonly<Record<string, unknown>> | null | undefined): boolean {
  if (!plan || plan.status !== "active") return false;
  const policy = (plan.policy ?? {}) as { createRetainerAfterSignature?: unknown };
  return policy.createRetainerAfterSignature === false;
}

/**
 * Whether QuickBooks or Stripe is connected now, from the studio's
 * integration connections. Ignores routing: any one connected means a deposit
 * can be raised when the client signs (booking/orchestration.ts raises it if
 * one was connected after the link went out).
 */
export function paymentsConnected(
  connections: ReadonlyArray<Readonly<Record<string, unknown>>> | null | undefined,
): boolean {
  return (connections ?? []).some(
    (connection) =>
      (connection.provider === "quickbooks" || connection.provider === "stripe") &&
      connection.status === "connected" &&
      !connection.archivedAt,
  );
}
