"use client";
import { useEffect, useState } from "react";
import { Cable, CheckCircle2, FlaskConical, RefreshCw } from "lucide-react";
import { collection, getDocs, limit, query, where } from "firebase/firestore";
import { StatusBadge } from "@/components/ui/status-badge";
import { getAppCheckToken } from "@/lib/firebase/app-check";
import { getFirebaseClient } from "@/lib/firebase/client";
import { dataIsLive, providersAreLive } from "@/lib/runtime-mode";
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
};
const definitions: ReadonlyArray<{
  provider: Provider;
  label: string;
  description: string;
  scope: string;
}> = [
  {
    provider: "quickbooks",
    label: "QuickBooks Online",
    description: "Customers, invoices, and payment status",
    scope: "Accounting source of record",
  },
  {
    provider: "google_calendar",
    label: "Google Calendar",
    description: "Availability, consultations, and production events",
    scope: "Selected production calendar",
  },
  {
    provider: "docusign",
    label: "Docusign",
    description: "Templates, envelopes, and completion evidence",
    scope: "Photography agreements",
  },
  {
    provider: "dropbox",
    label: "Dropbox",
    description: "Project folders and document storage",
    scope: "Configured StudioHub root",
  },
  {
    provider: "zoom",
    label: "Zoom",
    description: "Consultations with waiting room and no recording",
    scope: "Authorized studio account",
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

export function IntegrationManager() {
  const [connections, setConnections] = useState<Connection[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    let active = true;
    async function load() {
      if (!dataIsLive) {
        setReady(true);
        return;
      }
      try {
        const { auth, firestore } = getFirebaseClient();
        const user = auth.currentUser;
        if (!user) return;
        const memberships = await getDocs(
          query(
            collection(firestore, "memberships"),
            where("userId", "==", user.uid),
            where("status", "==", "active"),
            limit(1),
          ),
        );
        const tenantId = memberships.docs[0]?.data().tenantId;
        if (typeof tenantId !== "string") return;
        const snapshot = await getDocs(
          query(
            collection(firestore, "integrationConnections"),
            where("tenantId", "==", tenantId),
          ),
        );
        if (active)
          setConnections(
            snapshot.docs.map((document) => {
              const value = document.data();
              return {
                provider: value.provider as Provider,
                status: String(value.status),
                mockMode: Boolean(value.mockMode),
                displayName:
                  typeof value.displayName === "string"
                    ? value.displayName
                    : null,
                lastHealthCheckAt:
                  typeof value.lastHealthCheckAt === "string"
                    ? value.lastHealthCheckAt
                    : null,
              };
            }),
          );
      } catch {
        if (active) setNotice("Live integration status is unavailable.");
      } finally {
        if (active) setReady(true);
      }
    }
    void load();
    return () => {
      active = false;
    };
  }, []);
  async function connect(provider: Provider) {
    if (!oauthEnabled(provider)) {
      setNotice(
        "Provider connections remain in safe mock mode until production credentials are configured.",
      );
      return;
    }
    const endpoint = process.env.NEXT_PUBLIC_INTEGRATION_FUNCTIONS_URL;
    if (!endpoint) {
      setNotice("OAuth is not configured for this environment.");
      return;
    }
    try {
      const { auth, firestore } = getFirebaseClient();
      const user = auth.currentUser;
      if (!user) throw new Error("Sign in before connecting an integration.");
      const memberships = await getDocs(
        query(
          collection(firestore, "memberships"),
          where("userId", "==", user.uid),
          where("status", "==", "active"),
          limit(1),
        ),
      );
      const tenantId = memberships.docs[0]?.data().tenantId;
      if (typeof tenantId !== "string")
        throw new Error("No active studio membership was found.");
      const appCheckToken = await getAppCheckToken();
      const response = await fetch(
        `${endpoint.replace(/\/$/, "")}/integrationOAuth`,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            authorization: `Bearer ${await user.getIdToken()}`,
            ...(appCheckToken ? { "x-firebase-appcheck": appCheckToken } : {}),
          },
          body: JSON.stringify({ provider, tenantId }),
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
      setNotice(
        caught instanceof Error ? caught.message : "OAuth could not start.",
      );
    }
  }
  return (
    <>
      {
        <div className="integration-health-grid">
          {definitions.map((definition) => {
            const connection = connections.find(
              (value) => value.provider === definition.provider,
            );
            const connected = connection?.status === "connected";
            const mock = connection?.mockMode ?? !oauthEnabled(definition.provider);
            return (
              <article
                className="panel integration-health-card"
                key={definition.provider}
              >
                <div className="integration-mark">
                  {mock ? <FlaskConical /> : <Cable />}
                </div>
                <div>
                  <h2>{definition.label}</h2>
                  <p>{definition.description}</p>
                </div>
                <StatusBadge tone={connected && !mock ? "success" : "warning"}>
                  {connected
                    ? mock
                      ? "Mock mode"
                      : "Connected"
                    : "Not connected"}
                </StatusBadge>
                <dl>
                  <div>
                    <dt>Resource</dt>
                    <dd>{connection?.displayName ?? definition.scope}</dd>
                  </div>
                  <div>
                    <dt>Health</dt>
                    <dd>
                      {connection?.lastHealthCheckAt
                        ? new Date(
                            connection.lastHealthCheckAt,
                          ).toLocaleString()
                        : "Not checked"}
                    </dd>
                  </div>
                </dl>
                <footer>
                  {connected && !mock ? (
                    <>
                      <CheckCircle2 size={15} /> OAuth connection healthy
                    </>
                  ) : (
                    <>
                  <FlaskConical size={15} />{" "}
                  {mock ? "Safe mock mode" : "Credentials required"}
                    </>
                  )}
                  <button
                    type="button"
                    disabled={!ready}
                    onClick={() => void connect(definition.provider)}
                  >
                    <RefreshCw size={14} />
                    {connected ? "Reconnect" : "Connect"}
                  </button>
                </footer>
              </article>
            );
          })}
        </div>
      }
      {notice ? (
        <p className="form-notice" role="status">
          {notice}
        </p>
      ) : null}
    </>
  );
}
