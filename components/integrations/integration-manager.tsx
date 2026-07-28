"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ArrowUpRight,
  CalendarDays,
  Check,
  CheckCircle2,
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
import { collection, getDocs, query, where } from "firebase/firestore";
import { StatusBadge } from "@/components/ui/status-badge";
import { getAppCheckToken } from "@/lib/firebase/app-check";
import { getFirebaseClient } from "@/lib/firebase/client";
import { dataIsLive, providersAreLive } from "@/lib/runtime-mode";
import { activeMembership } from "@/lib/firebase/active-membership";

type Provider =
  | "quickbooks"
  | "google_calendar"
  | "docusign"
  | "dropbox"
  | "zoom";

type Connection = {
  provider: Provider;
  status: string;
  mockMode: boolean;
  displayName: string | null;
  lastHealthCheckAt: string | null;
  lastError: string | null;
};

type Notice = {
  tone: "success" | "danger" | "info";
  message: string;
};

type Definition = {
  provider: Provider;
  label: string;
  description: string;
  scope: string;
  capabilities: string[];
  icon: LucideIcon;
  accent: string;
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
      "Create secure consultation meetings with waiting rooms enabled.",
    scope: "Authorized studio account",
    capabilities: ["Consultations", "Waiting room", "No recording"],
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
];

const enabledOAuthProviders = new Set(
  (process.env.NEXT_PUBLIC_ENABLED_OAUTH_PROVIDERS ?? "")
    .split(",")
    .map((provider) => provider.trim())
    .filter(Boolean),
);

const oauthEnabled = (provider: Provider) =>
  providersAreLive || enabledOAuthProviders.has(provider);

const callbackErrors: Record<string, string> = {
  GOOGLE_CLOUD_PROJECT_REQUIRED:
    "Authorization reached StudioCue, but the credential vault could not identify its Google Cloud project. This configuration has now been corrected; reconnect to finish.",
  SECRET_MANAGER_CREATE_FAILED:
    "Authorization succeeded, but StudioCue could not create the secure tenant credential. The platform credential-vault permission needs attention.",
  SECRET_MANAGER_WRITE_FAILED:
    "Authorization succeeded, but StudioCue could not write the token to the secure credential vault.",
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
  const [notice, setNotice] = useState<Notice | null>(null);
  const [ready, setReady] = useState(false);
  const [busyProvider, setBusyProvider] = useState<Provider | null>(null);

  const load = useCallback(async () => {
    if (!dataIsLive) {
      setReady(true);
      return;
    }
    try {
      const { auth, firestore } = getFirebaseClient();
      const user = auth.currentUser;
      if (!user) return;
      const membership = await activeMembership(firestore, user.uid);
      const tenantId = membership.data().tenantId;
      if (typeof tenantId !== "string") return;
      const snapshot = await getDocs(
        query(
          collection(firestore, "integrationConnections"),
          where("tenantId", "==", tenantId),
        ),
      );
      setConnections(
        snapshot.docs.map((document) => {
          const value = document.data();
          return {
            provider: value.provider as Provider,
            status: String(value.status),
            mockMode: Boolean(value.mockMode),
            displayName:
              typeof value.displayName === "string" ? value.displayName : null,
            lastHealthCheckAt:
              typeof value.lastHealthCheckAt === "string"
                ? value.lastHealthCheckAt
                : null,
            lastError:
              typeof value.lastError === "string" ? value.lastError : null,
          };
        }),
      );
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
          connection.status === "connected" && connection.mockMode !== true,
      ).length,
    [connections],
  );

  async function tenantContext() {
    const { auth, firestore } = getFirebaseClient();
    const user = auth.currentUser;
    if (!user) throw new Error("Sign in before managing an integration.");
    const membership = await activeMembership(firestore, user.uid);
    const tenantId = membership.get("tenantId");
    if (typeof tenantId !== "string")
      throw new Error("No active studio membership was found.");
    return { user, tenantId };
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
      const appCheckToken = await getAppCheckToken();
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
      const appCheckToken = await getAppCheckToken();
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
            Connect the services your team already uses. StudioCue coordinates
            the work while each provider remains the source of truth.
          </p>
        </div>
        <div className="integration-vault">
          <LockKeyhole />
          <span>
            <strong>Tenant-isolated credential vault</strong>
            <small>
              Refresh tokens are encrypted in Google Secret Manager and never
              returned to the browser.
            </small>
          </span>
        </div>
      </section>

      {notice ? (
        <div
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

      <section className="integration-provider-grid">
        {definitions.map((definition) => {
          const connection = connections.find(
            (value) => value.provider === definition.provider,
          );
          const connected =
            connection?.status === "connected" &&
            connection.mockMode !== true;
          const available = oauthEnabled(definition.provider);
          const busy = busyProvider === definition.provider;
          const Icon = definition.icon;
          return (
            <article
              className={`integration-provider-card ${connected ? "is-connected" : ""}`}
              key={definition.provider}
            >
              <header>
                <span
                  className={`integration-provider-icon provider-${definition.accent}`}
                >
                  <Icon />
                </span>
                <span>
                  <h3>{definition.label}</h3>
                  <small>{definition.scope}</small>
                </span>
                <StatusBadge
                  dot
                  tone={connected ? "success" : available ? "info" : "neutral"}
                >
                  {connected
                    ? "Connected"
                    : available
                      ? "Ready to connect"
                      : "Development mode"}
                </StatusBadge>
              </header>

              <p>{definition.description}</p>

              <ul className="integration-capabilities">
                {definition.capabilities.map((capability) => (
                  <li key={capability}>
                    <Check /> {capability}
                  </li>
                ))}
              </ul>

              <div className="integration-connection-meta">
                <span>
                  <small>Connection</small>
                  <strong>
                    {connected
                      ? connection?.displayName ?? definition.label
                      : available
                        ? "OAuth available"
                        : "Provider adapter only"}
                  </strong>
                </span>
                <span>
                  <small>Health</small>
                  <strong>
                    {connection?.lastError
                      ? readableError(connection.lastError)
                      : relativeCheck(connection?.lastHealthCheckAt ?? null)}
                  </strong>
                </span>
              </div>

              <footer>
                <span className={connected ? "connection-live" : ""}>
                  {connected ? (
                    <>
                      <CheckCircle2 /> Encrypted and active
                    </>
                  ) : available ? (
                    <>
                      <LockKeyhole /> Authorization available
                    </>
                  ) : (
                    <>
                      <ShieldCheck /> Safe development adapter
                    </>
                  )}
                </span>
                <div className="integration-card-actions">
                  {connected ? (
                    <>
                      <button
                        className="integration-action-secondary"
                        type="button"
                        disabled={busy}
                        onClick={() =>
                          void manage(definition.provider, "health")
                        }
                      >
                        <RefreshCw className={busy ? "spin" : ""} />
                        Test
                      </button>
                      <button
                        className="integration-action-secondary"
                        type="button"
                        disabled={busy}
                        onClick={() =>
                          void manage(definition.provider, "disconnect")
                        }
                      >
                        <Unplug />
                        Disconnect
                      </button>
                    </>
                  ) : (
                    <button
                      className="integration-connect-button"
                      type="button"
                      disabled={!ready || busy}
                      onClick={() => void connect(definition.provider)}
                    >
                      {busy ? (
                        <RefreshCw className="spin" />
                      ) : (
                        <ArrowUpRight />
                      )}
                      {available ? "Connect" : "View setup"}
                    </button>
                  )}
                </div>
              </footer>
            </article>
          );
        })}
      </section>
    </div>
  );
}
