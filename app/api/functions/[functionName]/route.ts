import { GoogleAuth } from "google-auth-library";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const functionNames = [
  "aiActionCommand",
  "aiCopilotCommand",
  "aiMessageDraftCommand",
  "aiScheduleCommand",
  "aiTimingRulesCommand",
  "authEmailCommand",
  "bookingCommand",
  "communicationsCommand",
  "billingCommand",
  "clientInvitationCommand",
  "consultationAvailabilityQuery",
  "createSession",
  "crewCommand",
  "crewInvitationCommand",
  "crmCommand",
  "integrationOAuth",
  "integrationsCommand",
  "lifecycleSettingsCommand",
  "membershipCommand",
  "planningCommand",
  "postEventCommand",
  "proposalCommand",
  "publicLeadIntake",
  "publicConsultationScheduling",
  "saasAdminCommand",
  "studioImportCommand",
  "supportTenantSummary",
  "tenantBrandingCommand",
  "tenantDataCommand",
  "tenantExportDownload",
  "tenantOnboardingCommand",
  "workflowCommand",
] as const;

type FunctionName = (typeof functionNames)[number];

const googleAuth = new GoogleAuth();

function isFunctionName(value: string): value is FunctionName {
  return functionNames.some((name) => name === value);
}

async function proxy(
  request: Request,
  context: { params: Promise<{ functionName: string }> },
): Promise<Response> {
  const { functionName } = await context.params;
  if (!isFunctionName(functionName)) {
    return Response.json({ error: "FUNCTION_NOT_FOUND" }, { status: 404 });
  }

  const origin = process.env.FUNCTIONS_HTTPS_ORIGIN;
  if (!origin) {
    return Response.json(
      { error: "FUNCTION_PROXY_NOT_CONFIGURED" },
      { status: 503 },
    );
  }

  const runHostSuffix = process.env.FUNCTIONS_RUN_HOST_SUFFIX;
  const target =
    functionName === "integrationOAuth" &&
    process.env.INTEGRATION_OAUTH_FUNCTION_URL
      ? process.env.INTEGRATION_OAUTH_FUNCTION_URL
      : runHostSuffix
        ? `https://${functionName.toLowerCase()}-${runHostSuffix}`
        : `${origin.replace(/\/$/, "")}/${functionName}`;
  const identityClient = await googleAuth.getIdTokenClient(target);
  const identityHeaders = await identityClient.getRequestHeaders(target);
  const serviceAuthorization = identityHeaders.get("authorization");
  if (!serviceAuthorization) {
    return Response.json(
      { error: "SERVICE_IDENTITY_UNAVAILABLE" },
      { status: 503 },
    );
  }

  const headers = new Headers({
    authorization: serviceAuthorization,
    "x-studiohub-proxy": "app-hosting",
  });
  const forwardedHeaders = [
    "content-type",
    "x-firebase-appcheck",
    "x-studiohub-csrf",
    "cookie",
  ] as const;
  for (const name of forwardedHeaders) {
    const value = request.headers.get(name);
    if (value) headers.set(name, value);
  }
  const userAuthorization = request.headers.get("authorization");
  if (userAuthorization) {
    headers.set("x-studiohub-user-authorization", userAuthorization);
  }

  const incomingUrl = new URL(request.url);
  const targetUrl = new URL(target);
  targetUrl.search = incomingUrl.search;

  const upstream = await fetch(targetUrl, {
    method: request.method,
    headers,
    body:
      request.method === "GET" || request.method === "HEAD"
        ? undefined
        : await request.arrayBuffer(),
    cache: "no-store",
  });

  const responseHeaders = new Headers();
  const contentType = upstream.headers.get("content-type");
  if (contentType) responseHeaders.set("content-type", contentType);
  const setCookie = upstream.headers.get("set-cookie");
  if (setCookie) responseHeaders.set("set-cookie", setCookie);

  return new Response(upstream.body, {
    status: upstream.status,
    headers: responseHeaders,
  });
}

export const GET = proxy;
export const POST = proxy;
