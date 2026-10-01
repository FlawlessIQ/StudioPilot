import { getApp } from "firebase-admin/app";

/**
 * A platform secret read at run time, for a provider that is not switched on
 * everywhere yet.
 *
 * Every other OAuth client secret is bound with `secrets: [...]` on the
 * Functions that need it. That binding is resolved at *deploy* time: name a
 * secret that has no version yet and the deploy of every Function carrying it
 * fails. Outlook's MICROSOFT_CLIENT_SECRET does not exist until someone
 * registers the Azure app, and the Functions that read busy time include the
 * public scheduling link — so binding it would have made the next routine
 * deploy fail on a provider nobody had turned on.
 *
 * So: the process environment first (an emulator's .env.local, or a later
 * binding), then Secret Manager by name with the runtime's own identity.
 * Absent or unreadable means "" — the provider reports itself not configured
 * rather than erroring. The value is cached briefly per instance.
 */

const cache = new Map<string, { value: string; expiresAt: number }>();
const HIT_TTL_MS = 10 * 60_000;
const MISS_TTL_MS = 60_000;

async function runtimeToken(): Promise<string | null> {
  try {
    const response = await fetch(
      "http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token",
      { headers: { "Metadata-Flavor": "Google" } },
    );
    if (!response.ok) return null;
    const body = (await response.json()) as { access_token?: string };
    return body.access_token ?? null;
  } catch {
    return null;
  }
}

function projectId(): string | null {
  try {
    return (
      process.env.GOOGLE_CLOUD_PROJECT ??
      process.env.GCLOUD_PROJECT ??
      getApp().options.projectId ??
      null
    );
  } catch {
    return process.env.GOOGLE_CLOUD_PROJECT ?? process.env.GCLOUD_PROJECT ?? null;
  }
}

export async function platformSecret(name: string): Promise<string> {
  if (!/^[A-Z][A-Z0-9_]{2,100}$/.test(name)) throw new Error("PLATFORM_SECRET_NAME_INVALID");
  const fromEnvironment = process.env[name];
  if (fromEnvironment) return fromEnvironment;
  const cached = cache.get(name);
  if (cached && cached.expiresAt > Date.now()) return cached.value;
  let value = "";
  const project = projectId();
  const token = project ? await runtimeToken() : null;
  if (project && token) {
    try {
      const response = await fetch(
        `https://secretmanager.googleapis.com/v1/projects/${encodeURIComponent(project)}/secrets/${name}/versions/latest:access`,
        { headers: { authorization: `Bearer ${token}` } },
      );
      if (response.ok) {
        const body = (await response.json()) as { payload?: { data?: string } };
        value = body.payload?.data
          ? Buffer.from(body.payload.data, "base64").toString("utf8").trim()
          : "";
      } else if (response.status !== 404) {
        console.warn(
          JSON.stringify({
            severity: "WARNING",
            event: "platform_secret.unreadable",
            name,
            status: response.status,
          }),
        );
      }
    } catch {
      value = "";
    }
  }
  cache.set(name, { value, expiresAt: Date.now() + (value ? HIT_TTL_MS : MISS_TTL_MS) });
  return value;
}
