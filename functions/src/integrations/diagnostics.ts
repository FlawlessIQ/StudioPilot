import type { Provider } from "../operations/provider-runtime.js";

export type IntegrationDiagnosticInput = {
  provider: Provider;
  credentialPresent: boolean;
  tokenExpiresAt: string | null;
  scopes: string[];
  latencyMs: number | null;
  webhookEvents7d: number;
  failedJobs7d: number;
  lastWebhookAt: string | null;
  lastReconciledAt: string | null;
  error: string | null;
  /**
   * Something the provider account itself is missing, rather than a fault
   * in the connection.
   *
   * A connection can be perfectly healthy and still produce embarrassing
   * output: a QuickBooks company file with no company name set sends every
   * client an invoice headed "No company name". Nothing was wrong with the
   * integration, so nothing reported it, and the studio found out from a
   * client.
   */
  configurationWarning?: string | null;
};

export type IntegrationDiagnostics = IntegrationDiagnosticInput & {
  checkedAt: string;
  severity: "healthy" | "attention" | "blocked";
  recommendedAction: string;
};

export function buildIntegrationDiagnostics(
  input: IntegrationDiagnosticInput,
  checkedAt = new Date().toISOString(),
): IntegrationDiagnostics {
  let severity: IntegrationDiagnostics["severity"] = "healthy";
  let recommendedAction = "No action required. The connection is responding.";

  if (!input.credentialPresent) {
    severity = "blocked";
    recommendedAction = "Reconnect this provider to restore secure access.";
  } else if (input.error?.includes("401") || input.error?.includes("403")) {
    severity = "blocked";
    recommendedAction =
      "Reconnect the provider and confirm the app still has the required permissions.";
  } else if (input.error) {
    severity = "attention";
    recommendedAction =
      "Retry the health check. If it fails again, review the latest failed provider job.";
  } else if (input.failedJobs7d > 0) {
    severity = "attention";
    recommendedAction = `${input.failedJobs7d} provider job${
      input.failedJobs7d === 1 ? "" : "s"
    } failed in the last seven days. Review and replay the failed work.`;
  } else if (input.configurationWarning) {
    severity = "attention";
    recommendedAction = input.configurationWarning;
  } else if (input.latencyMs !== null && input.latencyMs > 3_000) {
    severity = "attention";
    recommendedAction =
      "The provider is responding slowly. Monitor before running a large reconciliation.";
  }

  return { ...input, checkedAt, severity, recommendedAction };
}
