"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowUpRight,
  CalendarDays,
  CheckCircle2,
  CircleDollarSign,
  FileSignature,
  HardDrive,
  Landmark,
  LockKeyhole,
  RefreshCw,
  ShieldCheck,
  TriangleAlert,
  Unplug,
  Video,
  X,
  type LucideIcon,
} from "lucide-react";
import { StatusBadge } from "@/components/ui/status-badge";
import { getOptionalAppCheckToken } from "@/lib/firebase/app-check";
import { getFirebaseClient } from "@/lib/firebase/client";
import { dataIsLive } from "@/lib/runtime-mode";
import { setCapabilityProvider } from "@/lib/integrations/command-client";
import {
  eligibleProvidersFor,
  resolveActiveProvider,
  type CapabilitySelections,
} from "@/features/integrations/routing";
import type {
  IntegrationCapability,
  IntegrationProvider,
} from "@/features/integrations/schema";

// The connect/disconnect UI below only has cards for the providers a studio
// can currently OAuth-connect (definitions, further down). The capability
// routing section can reference any provider in the full catalog — e.g. once
// connected, dropbox_sign or stripe become eligible there too — so it uses
// the full schema type rather than a narrower local one.
type Provider = IntegrationProvider;

const connectionStatuses = ["connected", "degraded", "disconnected", "error"] as const;
type ConnectionStatus = (typeof connectionStatuses)[number];
function asConnectionStatus(value: unknown): ConnectionStatus {
  return connectionStatuses.includes(value as ConnectionStatus)
    ? (value as ConnectionStatus)
    : "error";
}

type Connection = {
  provider: Provider;
  status: ConnectionStatus;
  archivedAt: string | null;
  mockMode: boolean;
  displayName: string | null;
  lastHealthCheckAt: string | null;
  lastHealthLatencyMs: number | null;
  lastError: string | null;
  diagnostics: {
    severity?: string;
    credentialPresent?: boolean;
    scopes?: string[];
    webhookEvents7d?: number;
    failedJobs7d?: number;
    lastWebhookAt?: string | null;
    lastReconciledAt?: string | null;
    recommendedAction?: string;
  } | null;
};

const capabilityCopy: Readonly<
  Record<IntegrationCapability, { label: string; description: string }>
> = {
  signing: {
    label: "Document signing",
    description: "Which connected provider sends contracts for signature.",
  },
  invoicing: {
    label: "Invoicing & payment",
    description: "Which connected provider creates and tracks invoices.",
  },
  calendar: {
    label: "Calendar",
    description: "Which connected calendar governs studio availability.",
  },
  meetings: {
    label: "Video meetings",
    description: "Which connected provider creates consultation meeting links.",
  },
  storage: {
    label: "File storage",
    description: "Which connected provider holds project folders and documents.",
  },
};

type Notice = {
  tone: "success" | "danger" | "info";
  message: string;
};

type IntegrationStatus = {
  tenantId: string;
  connections: Connection[];
  selections: CapabilitySelections;
};

async function fetchIntegrationStatus(
  user: { getIdToken(): Promise<string> },
): Promise<IntegrationStatus> {
  const preferredTenantId = window.localStorage.getItem(
    "studiohub.activeTenantId",
  );
  const parameters = preferredTenantId
    ? `?tenantId=${encodeURIComponent(preferredTenantId)}`
    : "";
  const response = await fetch(`/api/integrations/status${parameters}`, {
    headers: { authorization: `Bearer ${await user.getIdToken()}` },
    cache: "no-store",
  });
  const result = (await response.json()) as
    | IntegrationStatus
    | { error?: string };
  if (!response.ok || !("tenantId" in result)) {
    throw new Error(
      "error" in result && typeof result.error === "string"
        ? result.error
        : "INTEGRATION_STATUS_UNAVAILABLE",
    );
  }
  return result;
}

type Definition = {
  provider: Provider;
  label: string;
  description: string;
  scope: string;
  capabilities: string[];
  icon: LucideIcon;
  accent: string;
  // Why this provider is absent from NEXT_PUBLIC_ENABLED_OAUTH_PROVIDERS.
  // A gated provider must say what is outstanding and who is waiting on it,
  // because "Unavailable" alone reads as a bug in StudioCue rather than an
  // external approval the studio cannot act on. Kept in step with the
  // final-evidence column of docs/integration-production-readiness.md.
  pendingReason?: string;
};

const definitions: ReadonlyArray<Definition> = [
  {
    provider: "google_calendar",
    label: "Google Calendar",
    description:
      "Keep consultations, event dates, and studio availability aligned.",
    scope: "Primary studio calendar",
    capabilities: ["Availability", "Consultations", "Event blocks"],
    icon: CalendarDays,
    accent: "google",
  },
  {
    provider: "zoom",
    label: "Zoom",
    description:
      "Create secure consultations and prepare post-call notes for approval.",
    scope: "Authorized studio account",
    capabilities: ["Consultations", "Waiting room", "AI Companion summary"],
    icon: Video,
    accent: "zoom",
  },
  {
    provider: "dropbox",
    label: "Dropbox",
    description:
      "Build project folders and archive operational documents automatically.",
    scope: "StudioCue project root",
    capabilities: ["Project folders", "Documents", "Delivery"],
    icon: HardDrive,
    accent: "dropbox",
  },
  {
    provider: "quickbooks",
    label: "QuickBooks Online",
    description: "Sync customers, invoices, balances, and payment status.",
    scope: "Accounting source of record",
    capabilities: ["Customers", "Invoices", "Payments"],
    icon: Landmark,
    accent: "quickbooks",
    pendingReason:
      "Intuit is refusing the connection even though the app is live and its keys, callback URL, and permissions all check out. Raised with Intuit — connecting stays closed until it completes reliably.",
  },
  {
    provider: "docusign",
    label: "Docusign",
    description:
      "Send agreements and retain authoritative completion evidence.",
    scope: "Photography agreements",
    capabilities: ["Templates", "Signatures", "Evidence"],
    icon: FileSignature,
    accent: "docusign",
  },
  {
    provider: "dropbox_sign",
    label: "Dropbox Sign",
    description:
      "Send template-based agreements and automatically record completion evidence.",
    scope: "Photography agreements",
    capabilities: ["Templates", "Signatures", "Evidence"],
    icon: FileSignature,
    accent: "dropbox",
    pendingReason:
      "Waiting on Dropbox Sign OAuth app review. The backend is verified end to end, but the API app still reports is_approved=false.",
  },
  {
    provider: "stripe",
    label: "Stripe",
    description:
      "Create client invoices in the studio’s connected account and reconcile payment status.",
    scope: "Studio-owned payments account",
    capabilities: ["Customers", "Invoices", "Payment status"],
    icon: CircleDollarSign,
    accent: "stripe",
    pendingReason:
      "Stripe Connect is verified for platform billing, but the per-studio Connect OAuth app is not configured yet (STRIPE_CLIENT_ID is unset).",
  },
];

// DocuSign remains implemented server-side so an approved production
// integration can be restored later, but it must not be offered in the UI
// until StudioCue has production access.
const hiddenUiProviders = new Set<Provider>(["docusign"]);
const visibleDefinitions = definitions.filter(
  (definition) => !hiddenUiProviders.has(definition.provider),
);

const enabledOAuthProviders = new Set(
  (process.env.NEXT_PUBLIC_ENABLED_OAUTH_PROVIDERS ?? "")
    .split(",")
    .map((provider) => provider.trim())
    .filter(Boolean),
);

const oauthEnabled = (provider: Provider) =>
  enabledOAuthProviders.has(provider);

const callbackErrors: Record<string, string> = {
  GOOGLE_CLOUD_PROJECT_REQUIRED:
    "StudioCue could not finish saving this connection. Reconnect to try again.",
  SECRET_MANAGER_CREATE_FAILED:
    "StudioCue could not create a secure connection record. Contact support before trying again.",
  SECRET_MANAGER_WRITE_FAILED:
    "StudioCue could not securely save this connection. Contact support before trying again.",
  OAUTH_TOKEN_EXCHANGE_FAILED:
    "The provider rejected the authorization result. Confirm the production app credentials and exact callback URL, then reconnect.",
  OAUTH_STATE_INVALID:
    "This authorization session expired or was already used. Start a new connection.",
  OAUTH_CALLBACK_INVALID:
    "The provider did not return a valid authorization result. Start the connection again.",
  OAUTH_PROVIDER_NOT_CONFIGURED:
    "This provider’s production application credentials are not configured.",
};

function readableError(value: string): string {
  return (
    callbackErrors[value] ??
    value
      .replaceAll("_", " ")
      .toLowerCase()
      .replace(/^./, (character) => character.toUpperCase())
  );
}

function relativeCheck(value: string | null): string {
  if (!value) return "Not tested yet";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.valueOf())) return "Tested recently";
  return `Checked ${parsed.toLocaleString()}`;
}

export function IntegrationManager() {
  const [connections, setConnections] = useState<Connection[]>([]);
  const [selections, setSelections] = useState<CapabilitySelections>({});
  const [tenantId, setTenantId] = useState<string | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [ready, setReady] = useState(false);
  const [busyProvider, setBusyProvider] = useState<Provider | null>(null);
  const [savingCapability, setSavingCapability] =
    useState<IntegrationCapability | null>(null);
  const noticeRef = useRef<HTMLDivElement | null>(null);

  // The notice banner renders near the top of a long, scrollable page — a
  // provider card far down the list (e.g. Dropbox Sign) can leave a new
  // notice entirely off-screen, which reads as "clicking Connect did
  // nothing." Bring it into view whenever a new one appears.
  useEffect(() => {
    if (notice) noticeRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [notice]);

  const load = useCallback(async () => {
    if (!dataIsLive) {
      setReady(true);
      return;
    }
    try {
      const { auth } = getFirebaseClient();
      await auth.authStateReady();
      const user = auth.currentUser;
      if (!user) throw new Error("AUTH_SESSION_UNAVAILABLE");
      const status = await fetchIntegrationStatus(user);
      setTenantId(status.tenantId);
      setConnections(
        status.connections.map((connection) => ({
          ...connection,
          status: asConnectionStatus(connection.status),
        })),
      );
      setSelections(status.selections);
    } catch {
      setNotice({
        tone: "danger",
        message: "Live integration status could not be loaded.",
      });
    } finally {
      setReady(true);
    }
  }, []);

  useEffect(() => {
    queueMicrotask(() => {
      void load();
      const parameters = new URLSearchParams(window.location.search);
      const error = parameters.get("error");
      const connected = parameters.get("connected");
      if (error) {
        setNotice({ tone: "danger", message: readableError(error) });
      } else if (connected) {
        const provider = definitions.find(
          (definition) => definition.provider === connected,
        );
        setNotice({
          tone: "success",
          message: `${provider?.label ?? "Provider"} connected securely.`,
        });
      }
      if (error || connected)
        window.history.replaceState({}, "", window.location.pathname);
    });
  }, [load]);

  const connectedCount = useMemo(
    () =>
      connections.filter(
        (connection) =>
          !hiddenUiProviders.has(connection.provider) &&
          connection.status === "connected" && connection.mockMode !== true,
      ).length,
    [connections],
  );

  const visibleConnections = useMemo(
    () =>
      connections.filter(
        (connection) => !hiddenUiProviders.has(connection.provider),
      ),
    [connections],
  );

  const capabilityRows = useMemo(
    () =>
      (Object.keys(capabilityCopy) as IntegrationCapability[]).map(
        (capability) => {
          const eligible = eligibleProvidersFor(capability, visibleConnections);
          const resolution = resolveActiveProvider({
            capability,
            routing: { selections },
            connections: visibleConnections,
          });
          return { capability, eligible, resolution };
        },
      ),
    [selections, visibleConnections],
  );

  async function changeCapabilityProvider(
    capability: IntegrationCapability,
    provider: Provider | "",
  ) {
    const nextProvider = provider === "" ? null : provider;
    setSavingCapability(capability);
    const previous = selections;
    setSelections((current) => ({ ...current, [capability]: nextProvider }));
    try {
      if (!tenantId) throw new Error("No active studio membership was found.");
      await setCapabilityProvider(capability, nextProvider, tenantId);
      setNotice({
        tone: "success",
        message: `${capabilityCopy[capability].label} now uses ${
          nextProvider
            ? definitions.find((definition) => definition.provider === nextProvider)?.label ?? nextProvider
            : "automatic selection"
        }.`,
      });
    } catch (caught: unknown) {
      setSelections(previous);
      setNotice({
        tone: "danger",
        message:
          caught instanceof Error
            ? readableError(caught.message)
            : "Could not change the connected provider.",
      });
    } finally {
      setSavingCapability(null);
    }
  }

  async function tenantContext() {
    const { auth } = getFirebaseClient();
    const user = auth.currentUser;
    if (!user) throw new Error("Sign in before managing an integration.");
    if (tenantId) return { user, tenantId };
    const status = await fetchIntegrationStatus(user);
    setTenantId(status.tenantId);
    return { user, tenantId: status.tenantId };
  }

  async function connect(provider: Provider) {
    if (!oauthEnabled(provider)) {
      setNotice({
        tone: "info",
        message:
          "This provider is still using its development adapter. Add its production OAuth application before connecting.",
      });
      return;
    }
    const endpoint = process.env.NEXT_PUBLIC_INTEGRATION_FUNCTIONS_URL;
    if (!endpoint) {
      setNotice({
        tone: "danger",
        message: "OAuth is not configured for this environment.",
      });
      return;
    }
    setBusyProvider(provider);
    try {
      const { user, tenantId } = await tenantContext();
      const appCheckToken = await getOptionalAppCheckToken();
      const response = await fetch(
        `${endpoint.replace(/\/$/, "")}/integrationOAuth`,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            authorization: `Bearer ${await user.getIdToken()}`,
            ...(appCheckToken
              ? { "x-firebase-appcheck": appCheckToken }
              : {}),
          },
          body: JSON.stringify({ provider, tenantId, action: "connect" }),
        },
      );
      const result = (await response.json()) as {
        url?: string;
        error?: string;
      };
      if (!response.ok || !result.url)
        throw new Error(result.error ?? "OAuth could not start.");
      window.location.assign(result.url);
    } catch (caught: unknown) {
      setNotice({
        tone: "danger",
        message:
          caught instanceof Error
            ? readableError(caught.message)
            : "OAuth could not start.",
      });
      setBusyProvider(null);
    }
  }

  async function manage(provider: Provider, action: "health" | "disconnect") {
    const endpoint = process.env.NEXT_PUBLIC_INTEGRATION_FUNCTIONS_URL;
    if (!endpoint) {
      setNotice({
        tone: "danger",
        message: "Integration services are unavailable.",
      });
      return;
    }
    setBusyProvider(provider);
    try {
      const { user, tenantId } = await tenantContext();
      const appCheckToken = await getOptionalAppCheckToken();
      const response = await fetch(
        `${endpoint.replace(/\/$/, "")}/integrationOAuth`,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            authorization: `Bearer ${await user.getIdToken()}`,
            ...(appCheckToken
              ? { "x-firebase-appcheck": appCheckToken }
              : {}),
          },
          body: JSON.stringify({ provider, tenantId, action }),
        },
      );
      const result = (await response.json()) as { error?: string };
      if (!response.ok)
        throw new Error(result.error ?? "Integration action failed.");
      setNotice({
        tone: "success",
        message:
          action === "health"
            ? "Provider connection tested successfully."
            : "Provider disconnected. You can reconnect at any time.",
      });
      await load();
    } catch (caught: unknown) {
      setNotice({
        tone: "danger",
        message:
          caught instanceof Error
            ? readableError(caught.message)
            : "Integration action failed.",
      });
    } finally {
      setBusyProvider(null);
    }
  }

  return (
    <div className="integration-center">
      <section className="integration-overview">
        <div className="integration-overview-copy">
          <span>
            <ShieldCheck size={15} /> Secure connection center
          </span>
          <h2>
            {connectedCount
              ? `${connectedCount} provider${connectedCount === 1 ? "" : "s"} connected`
              : "Build your connected studio"}
          </h2>
          <p>
            Connect the services your team already uses, then manage them from
            one place.
          </p>
        </div>
        <div className="integration-vault">
          <LockKeyhole />
          <span>
            <strong>Protected connection details</strong>
            <small>
              Sign-in details are encrypted and are never shown in the browser.
            </small>
          </span>
        </div>
      </section>

      {notice ? (
        <div
          ref={noticeRef}
          className={`integration-notice integration-notice-${notice.tone}`}
          role={notice.tone === "danger" ? "alert" : "status"}
        >
          {notice.tone === "danger" ? (
            <TriangleAlert />
          ) : (
            <CheckCircle2 />
          )}
          <span>{notice.message}</span>
          <button
            type="button"
            aria-label="Dismiss message"
            onClick={() => setNotice(null)}
          >
            <X />
          </button>
        </div>
      ) : null}

      <section className="ds-card ds-int-list" aria-label="Connected providers">
        {visibleDefinitions.map((definition) => {
          const connection = connections.find(
            (value) => value.provider === definition.provider,
          );
          const connected =
            connection?.status === "connected" &&
            connection.mockMode !== true;
          const available = oauthEnabled(definition.provider);
          const busy = busyProvider === definition.provider;
          const Icon = definition.icon;
          const healthText = connection?.lastError
            ? readableError(connection.lastError)
            : connection?.lastHealthLatencyMs
              ? `${relativeCheck(connection.lastHealthCheckAt)} · ${connection.lastHealthLatencyMs} ms`
              : connected
                ? relativeCheck(connection?.lastHealthCheckAt ?? null)
                : available
                  ? "Ready to authorize"
                  : "Setup not finished";
          return (
            <article
              className={`ds-int-row ${connected ? "is-connected" : ""}`}
              key={definition.provider}
            >
              <span
                className={`ds-int-icon provider-${definition.accent}`}
              >
                <Icon />
              </span>
              <span className="ds-int-copy">
                <strong>{definition.label}</strong>
                <p>{definition.description}</p>
                <span className="ds-int-caps">
                  {definition.capabilities.join(" · ")}
                </span>
              </span>
              <StatusBadge
                dot
                tone={connected ? "success" : available ? "info" : "neutral"}
              >
                {connected
                  ? "Connected"
                  : available
                    ? "Ready to connect"
                    : "Setup required"}
              </StatusBadge>
              <span className="ds-int-health">
                <small>Health</small>
                <strong>{healthText}</strong>
              </span>
              <div className="ds-int-actions">
                {connected ? (
                  <>
                    <button
                      className="ds-btn ds-btn-ghost ds-btn-sm"
                      type="button"
                      disabled={busy}
                      onClick={() =>
                        void manage(definition.provider, "health")
                      }
                    >
                      <RefreshCw size={14} className={busy ? "spin" : ""} />
                      Test
                    </button>
                    <button
                      className="ds-btn ds-btn-ghost ds-btn-sm"
                      type="button"
                      disabled={busy}
                      onClick={() =>
                        void manage(definition.provider, "disconnect")
                      }
                    >
                      <Unplug size={14} />
                      Disconnect
                    </button>
                  </>
                ) : available ? (
                  <button
                    className="ds-btn ds-btn-primary ds-btn-sm"
                    type="button"
                    disabled={!ready || busy}
                    onClick={() => void connect(definition.provider)}
                  >
                    {busy ? (
                      <RefreshCw size={14} className="spin" />
                    ) : (
                      <ArrowUpRight size={14} />
                    )}
                    Connect
                  </button>
                ) : null}
              </div>

              {/* A gated provider gets an explanation instead of a primary
                  button, because a disabled green control reading
                  "Unavailable" offers an action, denies it, and gives no
                  reason — it reads as a broken button rather than an external
                  approval nobody in the studio can unblock. It spans its own
                  row: .ds-int-actions is a flex-shrink:0 cell in a six-column
                  grid, so a sentence placed there widens the whole list. */}
              {!connected && !available ? (
                <p className="ds-int-pending">
                  <LockKeyhole size={14} aria-hidden />
                  <span>
                    {definition.pendingReason ?? "Not open for connection yet."}
                  </span>
                </p>
              ) : null}

              {connection?.diagnostics ? (
                <details className="ds-int-detail">
                  <summary>Connection diagnostics</summary>
                  <dl>
                    <div>
                      <dt>Connection</dt>
                      <dd>
                        {connected
                          ? connection?.displayName ?? definition.label
                          : available
                            ? "Ready to authorize"
                            : "Setup not finished"}
                      </dd>
                    </div>
                    <div>
                      <dt>Credential vault</dt>
                      <dd>
                        {connection.diagnostics.credentialPresent
                          ? "Available"
                          : "Reconnect required"}
                      </dd>
                    </div>
                    <div>
                      <dt>Webhooks · 7 days</dt>
                      <dd>{connection.diagnostics.webhookEvents7d ?? 0}</dd>
                    </div>
                    <div>
                      <dt>Failed jobs · 7 days</dt>
                      <dd>{connection.diagnostics.failedJobs7d ?? 0}</dd>
                    </div>
                    <div>
                      <dt>Granted scopes</dt>
                      <dd>{connection.diagnostics.scopes?.length ?? 0}</dd>
                    </div>
                  </dl>
                  <p>
                    {connection.diagnostics.recommendedAction ??
                      "Run a connection test to generate recommendations."}
                  </p>
                </details>
              ) : null}
            </article>
          );
        })}
      </section>

      <section className="integration-routing">
        <header>
          <h2>Capability routing</h2>
          <p>
            When more than one connected provider can do a job, choose which
            one StudioCue uses.
          </p>
        </header>
        <ul className="integration-routing-list">
          {capabilityRows.map(({ capability, eligible, resolution }) => {
            const copy = capabilityCopy[capability];
            const saving = savingCapability === capability;
            const selectedValue =
              resolution.outcome === "resolved" &&
              eligible.length > 1
                ? resolution.provider
                : "";
            return (
              <li key={capability} className="integration-routing-row">
                <span className="integration-routing-copy">
                  <strong>{copy.label}</strong>
                  <small>{copy.description}</small>
                </span>
                {eligible.length > 1 ? (
                  <select
                    value={selectedValue}
                    disabled={saving}
                    onChange={(event) =>
                      void changeCapabilityProvider(
                        capability,
                        event.target.value as Provider | "",
                      )
                    }
                  >
                    <option value="">Choose a provider…</option>
                    {eligible.map((provider) => (
                      <option key={provider} value={provider}>
                        {definitions.find(
                          (definition) => definition.provider === provider,
                        )?.label ?? provider}
                      </option>
                    ))}
                  </select>
                ) : (
                  <span className="integration-routing-status">
                    {resolution.outcome === "resolved" ? (
                      <>
                        <CheckCircle2 />
                        {definitions.find(
                          (definition) =>
                            definition.provider === resolution.provider,
                        )?.label ?? resolution.provider}
                      </>
                    ) : (
                      <>
                        <TriangleAlert />
                        Connect a provider to enable this
                      </>
                    )}
                  </span>
                )}
              </li>
            );
          })}
        </ul>
      </section>
    </div>
  );
}
