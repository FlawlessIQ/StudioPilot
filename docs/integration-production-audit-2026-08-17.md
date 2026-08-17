# Integration production audit — August 17, 2026

This audit records production evidence without storing credentials, tokens,
webhook secrets, authorization codes, or provider object identifiers.

## Ready now

- **Google Calendar:** token rotation and a production Calendar API probe pass.
- **Dropbox:** token rotation and a production file-metadata probe pass.
- **Stripe Billing:** the live catalog, 14-day trial, Checkout, portal, and
  signed subscription webhook are configured.
- **Stripe Connect:** the live invoice-event webhook and signing secret are
  configured and deployed.
- **SendGrid outbound:** domain-authenticated production mail is delivered.
- **SendGrid inbound:** the inbound subdomain MX, protected parse route, and
  application validation are live.
- **Provider webhook relays:** private Gen 2 function targets are used in App
  Hosting; unauthenticated or malformed smoke tests fail closed.

## Ready after owner reconnection

- **Zoom:** the production client secret and webhook token are configured. The
  previously saved refresh token is revoked, so the tenant connection is marked
  `ZOOM_REAUTHORIZATION_REQUIRED` until an owner reconnects it.

## External approval gates

- **Dropbox Sign:** the owner account can authorize, refresh, call the account
  API, and complete the webhook handshake. The provider API reports the OAuth
  application is not approved. Public authorization therefore remains hidden
  until Dropbox reviews a recorded end-to-end OAuth and signature demo.
- **QuickBooks Online:** the assessment was submitted, token rotation works,
  and the saved sandbox company passes its API probe. The same credentials are
  rejected by the production API. Keep the provider hidden until Intuit grants
  production access and a live company is connected.
- **Docusign:** the production request was declined. The UI and marketing do not
  offer the integration.
- **SendGrid event analytics:** SendGrid permits one account-wide Event Webhook.
  The shared account's endpoint belongs to another product and must not be
  replaced. Create an isolated StudioCue SendGrid account or subuser before
  enabling signed delivery-event analytics.

## Connection truth reconciled

The live connection records were updated after controlled provider probes:

- Google Calendar, Dropbox, and Dropbox Sign reflect a successful health check.
- Zoom is marked as requiring reauthorization rather than incorrectly showing
  as connected.
- QuickBooks is marked as requiring production authorization rather than
  incorrectly showing the sandbox connection as production-ready.

## Re-enable gates

Before making a hidden provider public, require all of the following:

1. Provider production approval or publication.
2. Canonical `https://studio-cue.com` callback and webhook configuration.
3. Production secret versions bound to the deployed functions.
4. OAuth authorization from a non-owner test account.
5. Token refresh after the original access token expires.
6. One create/read/update or lifecycle test using a disposable test object.
7. Signed webhook receipt and idempotent duplicate delivery handling.
8. Cleanup of the disposable provider object and an acceptance record.
