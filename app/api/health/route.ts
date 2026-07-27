import { authMode, dataMode, providerMode } from "@/lib/runtime-mode";

export async function GET(): Promise<Response> {
  return Response.json({
    service: "studiohub-web",
    status: "ok",
    timestamp: new Date().toISOString(),
    modes: {
      auth: authMode,
      data: dataMode,
      providers: providerMode,
    },
  });
}
