export async function GET(): Promise<Response> {
  return Response.json({
    service: "studiohub-web",
    status: "ok",
    timestamp: new Date().toISOString(),
    mode: process.env.NEXT_PUBLIC_INTEGRATION_MODE ?? "mock",
  });
}
