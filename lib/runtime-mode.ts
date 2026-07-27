type RuntimeMode = "live" | "mock";

const legacyMode = process.env.NEXT_PUBLIC_INTEGRATION_MODE;

function mode(value: string | undefined): RuntimeMode {
  return value === "live" ? "live" : "mock";
}

export const authMode = mode(process.env.NEXT_PUBLIC_AUTH_MODE ?? legacyMode);
export const dataMode = mode(process.env.NEXT_PUBLIC_DATA_MODE ?? legacyMode);
export const providerMode = mode(process.env.NEXT_PUBLIC_PROVIDER_MODE ?? legacyMode);

export const authIsLive = authMode === "live";
export const dataIsLive = dataMode === "live";
export const providersAreLive = providerMode === "live";
