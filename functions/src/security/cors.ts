/**
 * Origins a browser may call a function from.
 *
 * Functions are private (invoker IAM) and the app reaches them through its
 * own same-origin relay, so in production this list is a second lock rather
 * than the first. It allowed `*.chatgpt.site` (a prototype host), any
 * `*.studiohub.app` subdomain (a domain StudioCue does not serve from) and
 * localhost — everywhere, including production. Production now allows only
 * StudioCue's own origins; localhost is for the emulator.
 */
const productionOrigins: RegExp[] = [
  /^https:\/\/studio-cue\.com$/,
  /^https:\/\/www\.studio-cue\.com$/,
  /^https:\/\/studiohub--studiohub-prod\.us-east4\.hosted\.app$/,
];

const localOrigins: RegExp[] = [/^https?:\/\/localhost(:\d+)?$/, /^https?:\/\/127\.0\.0\.1(:\d+)?$/];

export const studioHubCors: RegExp[] =
  process.env.FUNCTIONS_EMULATOR === "true" ? [...productionOrigins, ...localOrigins] : productionOrigins;
