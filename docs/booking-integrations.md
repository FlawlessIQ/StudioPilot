# Booking Integration Adapters

Milestone 4 normalizes Google Calendar, Zoom, Docusign, QuickBooks Online, and Dropbox behind typed provider contracts.

OAuth refresh tokens are never sent to browsers or stored as Firestore plaintext. `integrationConnections.encryptedCredentialRef` points to tenant-scoped encrypted material managed in Secret Manager.

- Google Calendar handles availability and event lifecycle with saved provider IDs.
- Zoom handles meeting lifecycle, join URLs, waiting room, and password policy.
- Docusign handles templates, signers, envelopes, completion evidence, and completed downloads.
- QuickBooks handles customer matching, invoice creation, hosted payment URLs, and balance reconciliation.
- Dropbox handles folders and files by ID, revision, canonical path, and scoped temporary link.

Every create call accepts an idempotency key. Webhooks normalize to internal domain events. Development mocks are explicit and return stable IDs without implying a live connection.

## Busy time from every connected calendar (Google, Outlook, Apple)

Consultation availability (`functions/src/booking/consultation-availability-query.ts`,
`public-scheduling.ts` `slotsForTenant`, and the amendment clash check) subtracts busy
time from **every** calendar the studio has connected, unioned:
`getCalendarBusyIntervals` in `functions/src/operations/provider-runtime.ts` lists the
tenant's connected busy-time providers (`BUSY_TIME_PROVIDERS` in
`functions/src/integrations/busy-time.ts`), asks each in parallel, and merges the
intervals. A provider that fails is logged (`calendar_busy.provider_skipped`) and
skipped; the others still count. Only when nothing connected answers is the result
`ok:false`, which callers treat as "no extra busy time" — the slot list never fails
because a calendar did.

Outlook and Apple are **busy time only**: their `providerCapabilities` are empty, so
they never take the `calendar` capability (putting consultation events on a calendar),
which stays with Google.

### Outlook / Microsoft 365 (`outlook_calendar`)

OAuth 2.0 authorization-code flow (with PKCE) against the Microsoft identity platform
`common` authority, scopes `offline_access Calendars.Read` — read-only. Busy time comes
from Graph `GET /me/calendarView` (`Prefer: outlook.timezone="UTC"`), keeping
`showAs` busy / tentative / oof, skipping cancelled events, and placing all-day events
on the studio's own calendar day. `calendarView` rather than `getSchedule` because
getSchedule needs the mailbox address, caps a request at 62 days and is not available
to personal outlook.com accounts.

The client id is `MICROSOFT_CLIENT_ID` (plain env, `functions/.env.studiohub-prod`).
The client secret `MICROSOFT_CLIENT_SECRET` lives in Secret Manager and is **read at run
time** (`functions/src/integrations/platform-secret.ts`), not bound with `secrets:` —
binding a secret that has no version yet fails the deploy of every Function carrying
it, and the busy-time readers include the public scheduling link. Until both exist the
connect start answers `OAUTH_PROVIDER_NOT_CONFIGURED`, and the Integrations card says
"Coming soon" for as long as `outlook_calendar` is absent from
`NEXT_PUBLIC_ENABLED_OAUTH_PROVIDERS`.

**Switching Outlook on** (once):

1. Azure portal → Microsoft Entra ID → App registrations → New registration.
   - Name: `StudioCue`.
   - Supported account types: **Accounts in any organizational directory and personal
     Microsoft accounts**.
   - Redirect URI: platform **Web**, `https://studio-cue.com/api/integrations/oauth/callback`
     (the shared `OAUTH_CALLBACK_URL`; never the `*.hosted.app` host).
2. App → API permissions → Add → Microsoft Graph → **Delegated** → `Calendars.Read` and
   `offline_access`. Leave `User.Read` (added by default) or remove it; nothing uses it.
   No admin-consent-only permission is requested.
3. App → Certificates & secrets → New client secret. Copy the **Value** (not the ID).
   Note its expiry: Azure caps secrets at 24 months, and an expired one makes every
   Outlook refresh fail with `OUTLOOK_CALENDAR_TOKEN_REFRESH_FAILED`.
4. App → Branding & properties: publisher domain `studio-cue.com`, and complete
   **publisher verification** (Microsoft Partner Network ID). Many work tenants only let
   users consent to verified publishers' apps; without it those studios see "Need admin
   approval".
5. Store the values:
   ```bash
   ./scripts/configure-production-secrets.sh studiohub-prod provision   # creates + grants MICROSOFT_CLIENT_SECRET
   printf '%s' '<secret value>' | gcloud secrets versions add MICROSOFT_CLIENT_SECRET --data-file=- --project=studiohub-prod
   ```
   and set `MICROSOFT_CLIENT_ID=<Application (client) ID>` in `functions/.env.studiohub-prod`.
6. Deploy functions (all of them — `provider-runtime.ts` is shared), then add
   `outlook_calendar` to `NEXT_PUBLIC_ENABLED_OAUTH_PROVIDERS` in `apphosting.yaml` and
   roll out the app. `scripts/verify-production-integration-config.sh` checks
   `MICROSOFT_CLIENT_ID` for it.

### Apple Calendar / iCloud (`apple_calendar`)

iCloud has no OAuth for calendars. The studio enters its Apple ID email and an
**app-specific password** (account.apple.com → Sign-In and Security → App-Specific
Passwords) on the Integrations card. `integrationOAuth` (`action: "connect_apple"`)
checks the role, refuses anything that is not app-specific-password shaped, proves the
credential with CalDAV discovery against `https://caldav.icloud.com`
(`current-user-principal` → `calendar-home-set` → event calendars), stores the password
in Secret Manager exactly as OAuth tokens are stored, and only then writes the connection
document — Apple ID, calendar URLs and names, never the password
(`appleConnectionRecord` in `functions/src/integrations/apple-calendar.ts` takes no
password argument). A wrong password writes nothing.

Busy time is a CalDAV `REPORT calendar-query` per calendar with a `time-range` filter and
`<expand>`, parsed for VEVENT DTSTART/DTEND/DURATION (UTC, TZID, floating, all-day on the
studio's day), skipping `TRANSP:TRANSPARENT` and `STATUS:CANCELLED`; simple RRULEs are
expanded locally if the server leaves them unexpanded. Credentials are only ever sent to
`caldav.icloud.com` / `pNN-caldav.icloud.com`; redirects are followed by hand and only
there. A refused password marks the connection `error / APPLE_CALENDAR_AUTH_FAILED` so
the card asks for a reconnect. Disconnect destroys the secret's versions like any other
provider. Nothing to configure on StudioCue's side; the card is live wherever the
integration Functions are.
