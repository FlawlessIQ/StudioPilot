export function functionTarget(functionName: string): string | null {
  const runHostSuffix = process.env.FUNCTIONS_RUN_HOST_SUFFIX;
  if (runHostSuffix) {
    return `https://${functionName.toLowerCase()}-${runHostSuffix}`;
  }

  const origin = process.env.FUNCTIONS_HTTPS_ORIGIN;
  return origin
    ? `${origin.replace(/\/$/, "")}/${functionName}`
    : null;
}
