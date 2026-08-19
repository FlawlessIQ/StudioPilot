import { createHash, randomBytes } from "node:crypto";
import { getApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { onRequest } from "firebase-functions/v2/https";
import { z } from "zod";
import {
  requireAppCheckOrAppHostingProxy,
  requireIdentity,
} from "../crm/security.js";
import { studioHubCors } from "../security/cors.js";
import { checkProviderConnection } from "../operations/provider-runtime.js";
import { providerUsesPkce } from "./oauth-strategy.js";
import {
  docusignOAuthBaseUrl,
  docusignUserInfoUrl,
  quickBooksApiBaseUrl,
} from "./provider-config.js";

const providerSchema = z.enum([
  "google_calendar",
  "zoom",
  "dropbox",
  "docusign",
  "dropbox_sign",
  "quickbooks",
  "stripe",
]);
type Provider = z.infer<typeof providerSchema>;
const startSchema = z.object({
  provider: providerSchema,
  tenantId: z.string().min(1),
  action: z.enum(["connect", "health", "disconnect"]).default("connect"),
});
type Config = {
  clientId: string;
  clientSecret: string;
  authorizeUrl: string;
  tokenUrl: string;
  scopes: string[];
  extra: Record<string, string>;
};
const environment = (provider: Provider, key: "CLIENT_ID" | "CLIENT_SECRET") =>
  process.env[
    `${provider === "google_calendar" ? "GOOGLE_CALENDAR" : provider.toUpperCase()}_${key}`
  ] ?? "";
const config = (provider: Provider): Config => {
  const clientId = environment(provider, "CLIENT_ID");
  // Stripe Connect's token exchange takes the platform's own secret API
  // key as "client_secret" — Stripe doesn't issue a separate OAuth client
  // secret the way other providers do — so this reuses STRIPE_SECRET_KEY
  // (already configured for saas/stripe.ts's subscription billing) rather
  // than asking for a redundant STRIPE_CLIENT_SECRET.
  const clientSecret =
    provider === "stripe"
      ? (process.env.STRIPE_SECRET_KEY ?? "")
      : environment(provider, "CLIENT_SECRET");
  if (!clientId || !clientSecret)
    throw new Error("OAUTH_PROVIDER_NOT_CONFIGURED");
  const configs: Record<Provider, Omit<Config, "clientId" | "clientSecret">> = {
    google_calendar: {
      authorizeUrl: "https://accounts.google.com/o/oauth2/v2/auth",
      tokenUrl: "https://oauth2.googleapis.com/token",
      scopes: [
        "https://www.googleapis.com/auth/calendar.readonly",
        "https://www.googleapis.com/auth/calendar.events",
      ],
      extra: { access_type: "offline", prompt: "consent" },
    },
    zoom: {
      authorizeUrl: "https://zoom.us/oauth/authorize",
      tokenUrl: "https://zoom.us/oauth/token",
      scopes: [
        "meeting:write:meeting",
        "meeting:read:meeting",
        "meeting:update:meeting",
        "meeting:delete:meeting",
        "meeting:read:list_meetings",
        "meeting:read:summary",
      ],
      extra: {},
    },
    dropbox: {
      authorizeUrl: "https://www.dropbox.com/oauth2/authorize",
      tokenUrl: "https://api.dropboxapi.com/oauth2/token",
      scopes: [
        "files.content.write",
        "files.content.read",
        "files.metadata.write",
        "files.metadata.read",
      ],
      extra: { token_access_type: "offline" },
    },
    docusign: {
      authorizeUrl: `${docusignOAuthBaseUrl()}/oauth/auth`,
      tokenUrl: `${docusignOAuthBaseUrl()}/oauth/token`,
      scopes: ["signature", "extended"],
      extra: {},
    },
    // Confirmed live against a real HelloSign OAuth app: unlike every other
    // provider here, HelloSign rejects any `scope` param outright ("Custom
    // scopes are not supported yet") — access is fixed by what the API app
    // itself is configured for, not requested at authorize time. Keep
    // scopes empty so the URL builder below omits the param entirely.
    dropbox_sign: {
      authorizeUrl: "https://app.hellosign.com/oauth/authorize",
      tokenUrl: "https://app.hellosign.com/oauth/token",
      scopes: [],
      extra: {},
    },
    quickbooks: {
      authorizeUrl: "https://appcenter.intuit.com/connect/oauth2",
      tokenUrl: "https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer",
      scopes: ["com.intuit.quickbooks.accounting"],
      extra: {},
    },
    // Stripe Connect (Standard) OAuth — distinct from the platform's own
    // STRIPE_SECRET_KEY/STRIPE_WEBHOOK_SECRET in saas/stripe.ts, which bill
    // the studio for its StudioCue subscription. This is per-tenant: each
    // studio connects its own Stripe account so client retainer payments
    // land directly with the studio, the same "studio owns the account"
    // shape as QuickBooks. Connect's token endpoint wants client_secret as
    // a body param (not Basic auth) and no redirect_uri — both handled as
    // special cases in exchange() below, alongside google_calendar's.
    stripe: {
      authorizeUrl: "https://connect.stripe.com/oauth/authorize",
      tokenUrl: "https://connect.stripe.com/oauth/token",
      scopes: ["read_write"],
      extra: {},
    },
  };
  return { clientId, clientSecret, ...configs[provider] };
};
const sha256 = (value: string) => createHash("sha256").update(value).digest();
const base64url = (value: Buffer) => value.toString("base64url");
async function runtimeToken() {
  const response = await fetch(
    "http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token",
    { headers: { "Metadata-Flavor": "Google" } },
  );
  const body = (await response.json()) as { access_token?: string };
  if (!response.ok || !body.access_token)
    throw new Error("SECRET_MANAGER_IDENTITY_UNAVAILABLE");
  return body.access_token;
}
async function saveCredential(
  tenantId: string,
  provider: Provider,
  value: Record<string, unknown>,
) {
  const project =
    process.env.GOOGLE_CLOUD_PROJECT ??
    process.env.GCLOUD_PROJECT ??
    getApp().options.projectId;
  if (!project) throw new Error("GOOGLE_CLOUD_PROJECT_REQUIRED");
  const token = await runtimeToken();
  const secretId = `studiohub-${tenantId}-${provider}`
    .replace(/[^a-zA-Z0-9_-]/g, "-")
    .slice(0, 240);
  const parent = `projects/${project}`;
  const create = await fetch(
    `https://secretmanager.googleapis.com/v1/${parent}/secrets?secretId=${encodeURIComponent(secretId)}`,
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ replication: { automatic: {} } }),
    },
  );
  if (!create.ok && create.status !== 409)
    throw new Error("SECRET_MANAGER_CREATE_FAILED");
  const name = `${parent}/secrets/${secretId}`;
  const add = await fetch(
    `https://secretmanager.googleapis.com/v1/${name}:addVersion`,
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        payload: {
          data: Buffer.from(JSON.stringify(value)).toString("base64"),
        },
      }),
    },
  );
  if (!add.ok) throw new Error("SECRET_MANAGER_WRITE_FAILED");
  return `${name}/versions/latest`;
}
function basic(clientId: string, clientSecret: string) {
  return `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`;
}
async function exchange(
  provider: Provider,
  code: string,
  verifier: string | null,
  redirectUri: string,
) {
  const current = config(provider);
  const params = new URLSearchParams({ grant_type: "authorization_code", code });
  // Stripe Connect's token endpoint doesn't take redirect_uri — the
  // redirect is validated against the Connect app's own settings instead.
  if (provider !== "stripe") params.set("redirect_uri", redirectUri);
  if (verifier) params.set("code_verifier", verifier);
  const headers: Record<string, string> = {
    "content-type": "application/x-www-form-urlencoded",
  };
  // Confirmed live: HelloSign's token endpoint rejects HTTP Basic auth
  // ("Parameter client_id is missing") — like google_calendar and stripe,
  // it wants client_id/client_secret as body params instead.
  if (
    provider === "google_calendar" ||
    provider === "stripe" ||
    provider === "dropbox_sign"
  ) {
    params.set("client_id", current.clientId);
    params.set("client_secret", current.clientSecret);
  } else headers.authorization = basic(current.clientId, current.clientSecret);
  const response = await fetch(current.tokenUrl, {
    method: "POST",
    headers,
    body: params,
  });
  const body = (await response.json()) as Record<string, unknown>;
  if (!response.ok || typeof body.access_token !== "string") {
    console.error("integration_oauth_token_exchange_failed", {
      provider,
      status: response.status,
      body,
    });
    throw new Error("OAUTH_TOKEN_EXCHANGE_FAILED");
  }
  return body;
}

// Every provider shares OAUTH_CALLBACK_URL by default, but each provider's
// registered redirect URI lives in that provider's own dashboard — if one
// was set up against a different host (e.g. Dropbox Sign's app is
// registered against studio-cue.com rather than the *.hosted.app default),
// an env var named `${PROVIDER}_OAUTH_CALLBACK_URL` overrides just that
// provider without touching the others' already-working redirect URI.
function redirectUriFor(provider: Provider, fallback: string): string {
  return process.env[`${provider.toUpperCase()}_OAUTH_CALLBACK_URL`] || fallback;
}

export const integrationOAuth = onRequest(
  {
    cors: studioHubCors,
    invoker: "private",
    secrets: [
      "DROPBOX_CLIENT_SECRET",
      "GOOGLE_CALENDAR_CLIENT_SECRET",
      "ZOOM_CLIENT_SECRET",
      "DOCUSIGN_CLIENT_SECRET",
      "DROPBOX_SIGN_CLIENT_SECRET",
      "QUICKBOOKS_CLIENT_ID",
      "QUICKBOOKS_CLIENT_SECRET",
      "STRIPE_SECRET_KEY",
    ],
  },
  async (request, response) => {
    const db = getFirestore();
    const defaultRedirectUri = process.env.OAUTH_CALLBACK_URL;
    let failureProvider: string | null = null;
    let failureTenantId: string | null = null;
    if (!defaultRedirectUri) {
      response.status(503).json({ error: "OAUTH_CALLBACK_URL_REQUIRED" });
      return;
    }
    try {
      if (request.method === "POST") {
        await requireAppCheckOrAppHostingProxy(request);
        const identity = await requireIdentity(request);
        const input = startSchema.parse(request.body);
        failureProvider = input.provider;
        failureTenantId = input.tenantId;
        const membership = await db
          .doc(`memberships/${input.tenantId}_${identity.uid}`)
          .get();
        if (
          !membership.exists ||
          membership.get("status") !== "active" ||
          !["studio_owner", "studio_admin"].includes(
            String(membership.get("role")),
          )
        )
          throw new Error("FORBIDDEN");
        if (input.action === "health") {
          const result = await checkProviderConnection(
            input.tenantId,
            input.provider,
          );
          response.status(200).json(result);
          return;
        }
        if (input.action === "disconnect") {
          const connectionId = `${input.tenantId}_${input.provider}`;
          const reference = db.doc(`integrationConnections/${connectionId}`);
          const connection = await reference.get();
          if (!connection.exists) throw new Error("CONNECTION_NOT_FOUND");
          const now = new Date().toISOString();
          const batch = db.batch();
          batch.update(reference, {
            status: "disconnected",
            encryptedCredentialRef: null,
            disconnectedAt: now,
            lastError: null,
            updatedAt: now,
            updatedBy: identity.uid,
          });
          batch.create(db.collection("auditEvents").doc(), {
            tenantId: input.tenantId,
            projectId: null,
            actorId: identity.uid,
            actorType: "user",
            action: "integration.disconnect",
            entityType: "integrationConnection",
            entityId: connectionId,
            timestamp: now,
            before: { status: connection.get("status") },
            after: { provider: input.provider, status: "disconnected" },
            ipAddress: request.ip ?? null,
            userAgent: request.get("user-agent") ?? null,
            correlationId: `disconnect_${Date.now()}`,
            automationRunId: null,
            providerEventId: null,
          });
          await batch.commit();
          response.status(200).json({ provider: input.provider, status: "disconnected" });
          return;
        }
        const current = config(input.provider);
        const redirectUri = redirectUriFor(input.provider, defaultRedirectUri);
        const verifier = providerUsesPkce(input.provider)
          ? base64url(randomBytes(48))
          : null;
        const state = base64url(randomBytes(32));
        const challenge = verifier ? base64url(sha256(verifier)) : null;
        const now = new Date();
        await db
          .doc(
            `oauthStates/${createHash("sha256").update(state).digest("hex")}`,
          )
          .create({
            tenantId: input.tenantId,
            userId: identity.uid,
            provider: input.provider,
            verifier,
            redirectUri,
            expiresAt: new Date(now.valueOf() + 10 * 60000).toISOString(),
            createdAt: now.toISOString(),
          });
        const url = new URL(current.authorizeUrl);
        url.searchParams.set("response_type", "code");
        url.searchParams.set("client_id", current.clientId);
        url.searchParams.set("redirect_uri", redirectUri);
        if (current.scopes.length > 0) {
          url.searchParams.set("scope", current.scopes.join(" "));
        }
        url.searchParams.set("state", state);
        if (challenge) {
          url.searchParams.set("code_challenge", challenge);
          url.searchParams.set("code_challenge_method", "S256");
        }
        for (const [key, value] of Object.entries(current.extra))
          url.searchParams.set(key, value);
        response.status(200).json({ url: url.toString() });
        return;
      }
      if (request.method !== "GET") {
        response.status(405).json({ error: "METHOD_NOT_ALLOWED" });
        return;
      }
      const state = String(request.query.state ?? "");
      const code = String(request.query.code ?? "");
      if (!state || !code) throw new Error("OAUTH_CALLBACK_INVALID");
      const stateReference = db.doc(
        `oauthStates/${createHash("sha256").update(state).digest("hex")}`,
      );
      const saved = await stateReference.get();
      if (
        !saved.exists ||
        new Date(String(saved.get("expiresAt"))) < new Date()
      )
        throw new Error("OAUTH_STATE_INVALID");
      const provider = providerSchema.parse(saved.get("provider"));
      const tenantId = String(saved.get("tenantId"));
      failureProvider = provider;
      failureTenantId = tenantId;
      const token = await exchange(
        provider,
        code,
        typeof saved.get("verifier") === "string"
          ? String(saved.get("verifier"))
          : null,
        String(saved.get("redirectUri")),
      );
      // Stripe Connect (Standard) access tokens don't expire and aren't
      // issued with a refresh_token — token.expires_in is genuinely absent,
      // not just omitted. Defaulting to a 1-hour expiry there (as the other
      // providers correctly do when their response omits it) would make
      // refreshCredential() demand reauthorization every hour with no
      // refresh_token to actually do it with.
      const expiresAt =
        provider === "stripe"
          ? null
          : new Date(Date.now() + Number(token.expires_in ?? 3600) * 1000).toISOString();
      const credential: Record<string, unknown> = {
        accessToken: token.access_token,
        refreshToken: token.refresh_token ?? null,
        expiresAt,
      };
      let accountId = String(request.query.realmId ?? "");
      let displayName: string = provider;
      if (provider === "docusign") {
        const userInfo = await fetch(
          docusignUserInfoUrl(),
          {
            headers: { authorization: `Bearer ${String(token.access_token)}` },
          },
        );
        const body = (await userInfo.json()) as {
          accounts?: Array<{
            account_id?: string;
            base_uri?: string;
            account_name?: string;
            is_default?: boolean;
          }>;
        };
        const account =
          body.accounts?.find((value) => value.is_default) ??
          body.accounts?.[0];
        accountId = account?.account_id ?? "";
        credential.accountId = accountId;
        credential.baseUrl = account?.base_uri;
        displayName = account?.account_name ?? provider;
      } else if (provider === "dropbox_sign") {
        const account = await fetch("https://api.hellosign.com/v3/account", {
          headers: { authorization: `Bearer ${String(token.access_token)}` },
        });
        const body = (await account.json()) as {
          account?: { account_id?: string; email_address?: string };
        };
        accountId = body.account?.account_id ?? "";
        credential.accountId = accountId;
        displayName = body.account?.email_address ?? provider;
      } else if (provider === "zoom") {
        // Zoom's account id is stored and never read. Every Zoom operation
        // addresses /v2/users/me/... using the meeting scopes above — the
        // health probe, meeting creation, and summary fetch in
        // provider-runtime.ts — unlike Docusign (accountId) and QuickBooks
        // (realmId), which genuinely need theirs.
        //
        // /v2/users/me needs a user-profile scope this app deliberately does
        // not request, so the call fails by design and treating that as fatal
        // rejected the whole connection with ZOOM_ACCOUNT_LOOKUP_FAILED
        // *after* a successful token exchange — the studio had already granted
        // consent, and the only remedy on offer was to widen the scope for a
        // value nothing consumes. Best effort instead: take the friendlier
        // label when the scope happens to be granted, connect when it is not.
        const account = await fetch("https://api.zoom.us/v2/users/me", {
          headers: { authorization: `Bearer ${String(token.access_token)}` },
        }).catch(() => null);
        const profile =
          account && account.ok
            ? ((await account.json()) as {
                account_id?: string;
                display_name?: string;
                email?: string;
              })
            : null;
        if (profile?.account_id) {
          accountId = profile.account_id;
          credential.accountId = accountId;
        }
        displayName = profile?.display_name ?? profile?.email ?? "Zoom";
        if (!profile) {
          console.info(
            JSON.stringify({
              severity: "INFO",
              event: "integration.zoom.profile_unavailable",
              status: account?.status ?? null,
              detail:
                "connected without /v2/users/me; add a user-read scope only if a real account label is wanted",
            }),
          );
        }
      } else if (provider === "quickbooks") {
        credential.realmId = accountId;
        credential.baseUrl = quickBooksApiBaseUrl();
      } else if (provider === "stripe") {
        // Connect returns the connected account id directly in the token
        // response — no separate userinfo call needed.
        accountId = String(token.stripe_user_id ?? "");
        credential.accountId = accountId;
        displayName = accountId;
      }
      const credentialReference = await saveCredential(
        tenantId,
        provider,
        credential,
      );
      const now = new Date().toISOString();
      const connectionId = `${tenantId}_${provider}`;
      const batch = db.batch();
      batch.set(
        db.doc(`integrationConnections/${connectionId}`),
        {
          id: connectionId,
          tenantId,
          provider,
          status: "connected",
          providerAccountId: accountId || null,
          meetingSummaryEnabled: provider === "zoom" ? true : null,
          displayName,
          encryptedCredentialRef: credentialReference,
          selectedResourceId: null,
          scopes: config(provider).scopes,
          connectedAt: now,
          // A fresh authorization proves the provider issued a token; it does
          // not prove the credential can do any work, and this write must not
          // claim otherwise. Stamping `now` here made the card read
          // "Connected · Checked <just now>" with no error while QuickBooks
          // was in fact answering 403 ApplicationAuthorizationFailed on every
          // production call.
          //
          // The whole probe result is cleared, not just the timestamp: this
          // set() merges, so a previous probe's latency and diagnostics
          // otherwise survive and pair with the new timestamp. That is how
          // Zoom came to display a brand-new "Checked" time next to 388 ms
          // measured days earlier by a probe that had failed. Null leaves the
          // UI at "Not tested yet" until a real health check runs — the Test
          // control, or the scheduled sweep in saas/jobs.ts.
          lastHealthCheckAt: null,
          lastHealthLatencyMs: null,
          diagnostics: null,
          diagnosticSeverity: null,
          diagnosticRecommendation: null,
          diagnosticFailedJobs7d: null,
          lastError: null,
          mockMode: false,
          createdAt: now,
          updatedAt: now,
          createdBy: String(saved.get("userId")),
          updatedBy: String(saved.get("userId")),
          archivedAt: null,
        },
        { merge: true },
      );
      batch.delete(stateReference);
      batch.create(db.doc(`auditEvents/oauth_${stateReference.id}`), {
        id: `oauth_${stateReference.id}`,
        tenantId,
        projectId: null,
        actorId: String(saved.get("userId")),
        actorType: "user",
        action: "integration.connect",
        entityType: "integrationConnection",
        entityId: connectionId,
        timestamp: now,
        before: null,
        after: { provider, status: "connected" },
        ipAddress: request.ip ?? null,
        userAgent: request.get("user-agent") ?? null,
        correlationId: stateReference.id,
        automationRunId: null,
        providerEventId: null,
      });
      await batch.commit();
      response.redirect(
        `${process.env.NEXT_PUBLIC_APP_URL ?? "https://studiohub.app"}/studio/integrations?connected=${provider}`,
      );
    } catch (caught: unknown) {
      const message = caught instanceof Error ? caught.message : "OAUTH_FAILED";
      console.error("integration_oauth_failed", {
        code: message,
        method: request.method,
        provider: failureProvider,
        tenantId: failureTenantId,
      });
      if (request.method === "GET") {
        response.redirect(
          `${process.env.NEXT_PUBLIC_APP_URL ?? "https://studiohub.app"}/studio/integrations?error=${encodeURIComponent(message)}`,
        );
        return;
      }
      response
        .status(message === "FORBIDDEN" ? 403 : 400)
        .json({ error: message });
    }
  },
);
