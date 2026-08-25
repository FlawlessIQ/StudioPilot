/**
 * A provider's error, in words a photographer can act on.
 *
 * `DROPBOX_SIGN_CREATE_FAILED:402:PROVIDER_ERROR` is precise and useless to
 * the person reading it. The status is the part that says what to do.
 *
 * `testMode` matters because the 402 advice used to be "turn on test mode",
 * which is no advice at all to someone who already has. Being told to do
 * the thing you just did reads as the product not knowing its own state.
 */
export function providerFailureHint(
  message: string,
  provider: string,
  testMode: boolean,
): string {
  const status = Number(message.split(":")[1] ?? 0);
  if (status === 402)
    return testMode
      ? `Test mode is on and ${provider} still refused, so the account itself does not have API access. Sending this one outside StudioCue and recording the signature below books the job either way.`
      : `${provider} needs a paid API plan to send agreements. Upgrade it, turn on test mode in Integrations to rehearse the booking, or send this one outside StudioCue and record the signature below.`;
  if (status === 401 || status === 403)
    return `${provider} rejected the connection. Reconnect it in Integrations and try again.`;
  if (status === 400)
    return `${provider} rejected the request — usually the agreement template's signer role does not match. Check the template, then try again.`;
  if (status === 429)
    return `${provider} is rate limiting. Wait a moment and try again.`;
  return `${provider} could not create the request. Check the connection in Integrations, then try again.`;
}
