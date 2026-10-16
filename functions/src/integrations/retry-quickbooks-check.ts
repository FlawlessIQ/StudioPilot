/** Only read-only reconciliation may be retried by a studio from Today. */
export function assertQuickBooksCheckRetry(input: {
  tenantId: string;
  job: Record<string, unknown>;
  connection: Record<string, unknown>;
}) {
  const { tenantId, job, connection } = input;
  if (job.tenantId !== tenantId) throw new Error("PROVIDER_JOB_NOT_FOUND");
  if (job.type !== "reconcile_quickbooks_money_event") throw new Error("PROVIDER_JOB_NOT_RETRYABLE");
  if (!["failed", "dead_letter"].includes(String(job.status))) throw new Error("PROVIDER_JOB_NOT_RETRYABLE");
  if (connection.tenantId !== tenantId || connection.provider !== "quickbooks" || connection.status !== "connected" || connection.archivedAt)
    throw new Error("QUICKBOOKS_NOT_CONNECTED");
  if (!job.realmId || job.realmId !== connection.providerAccountId) throw new Error("QUICKBOOKS_COMPANY_MISMATCH");
}
