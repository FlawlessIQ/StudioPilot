/**
 * A provider's error, in words a photographer can act on.
 *
 * `DROPBOX_SIGN_CREATE_FAILED:402:PROVIDER_ERROR` is precise and useless to
 * the person reading it. The status is the part that says what to do.
 *
 * `testMode` matters because the 402 advice used to be "turn on test mode",
 * which is no advice at all to someone who already has. Being told to do
 * the thing you just did reads as the product not knowing its own state.
 *
 * `kind` matters because the same statuses mean different things for a
 * signing app and an invoicing one. A Stripe studio whose invoice was refused
 * was told to check its agreement template's signer role, and a 402 from
 * QuickBooks to upgrade an API plan to "send agreements" (wave 3). And a
 * deterministic refusal (a 4xx other than 429) is not something "try again"
 * fixes: the same request is refused the same way, so the hint says what to
 * change first, or what to do instead.
 */
export type ProviderFailureKind = "signing" | "billing";

export function providerFailureHint(
  message: string,
  provider: string,
  testMode: boolean,
  // Callers name it; an invoicing provider named without one is still billing.
  kind: ProviderFailureKind = /quickbooks|stripe/i.test(provider) ? "billing" : "signing",
): string {
  const status = Number(message.split(":")[1] ?? 0);
  return kind === "billing" ? billingHint(message, status, provider) : signingHint(status, provider, testMode);
}

function signingHint(status: number, provider: string, testMode: boolean): string {
  if (status === 402)
    return testMode
      ? `Test mode is on and ${provider} still refused, so the account itself does not have API access. Sending this one outside StudioCue and recording the signature below books the job either way.`
      : `${provider} needs a paid API plan to send agreements. Upgrade it, turn on test mode in Integrations to rehearse the booking, or send this one outside StudioCue and record the signature below.`;
  if (status === 401 || status === 403)
    return `${provider} rejected the connection. Reconnect it in Integrations, then send it again.`;
  if (status === 400)
    return `${provider} rejected the request — usually the agreement template's signer role does not match. Fix the template, then send it again, or record the signature below.`;
  if (status === 429) return `${provider} is rate limiting. Wait a moment and try again.`;
  if (status >= 400 && status < 500)
    return `${provider} refused this request, and sending it again unchanged will be refused the same way. Check the template and connection in Integrations, or send this one outside StudioCue and record the signature below.`;
  return `${provider} could not create the request. Check the connection in Integrations, then try again.`;
}

function billingHint(message: string, status: number, provider: string): string {
  // What the provider said, when it said something readable.
  const said = message
    .split(":")
    .slice(2)
    .join(":")
    .replace(/\s*:\s*null\s*$/i, "")
    .trim();
  const readable = said && /[a-z]/.test(said) && !/^[A-Z0-9_]+$/.test(said) ? said.slice(0, 200) : "";
  if (status === 401 || status === 403)
    return `${provider} rejected the connection. Reconnect it in Integrations, then try again — or record the payment below if it was paid another way.`;
  if (status === 402)
    return `${provider} refused because of your ${provider} account's plan or billing. Sort that out in ${provider} before trying again, or record the payment below if it was paid another way.`;
  if (status === 429) return `${provider} is rate limiting. Wait a moment and try again.`;
  if (status >= 400 && status < 500)
    return readable
      ? `${provider} said: "${readable}" Fix that in ${provider} first — sending the same invoice again is refused the same way — or record the payment below if it was paid another way.`
      : `${provider} refused this invoice, and sending it again unchanged will be refused the same way. Check the customer and invoice settings in ${provider}, or record the payment below if it was paid another way.`;
  return `${provider} could not create the invoice. Check the connection in Integrations, then try again — or record the payment below if it was paid another way.`;
}
