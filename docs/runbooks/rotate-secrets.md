# Rotating secrets

Every provider secret lives in Google Secret Manager (`studiohub-prod`) and is
read by Cloud Functions at deploy time. Nothing secret is in the repo,
Firestore or the browser. Rotating one is: make a new value at the provider,
add it as a new Secret Manager version, redeploy the functions that read it,
check, then revoke the old value at the provider.

**Why now:** some values were pasted into chat or shown in screenshots during
the build (`manual-launch-checklist.md` §1). Public launch makes StudioCue a
target. Rotate those first.

## The steps, for any secret

1. **Provider console** — create the new key or secret. Keep the old one
   working until step 5.
2. **Add it as a new version** (paste the value when prompted; it never
   touches the shell history or disk):
   ```bash
   read -rs VALUE && printf %s "$VALUE" | gcloud secrets versions add NAME --data-file=- --project studiohub-prod && unset VALUE
   ```
3. **Redeploy every function**, so each picks up the new version, then
   re-apply invokers and check freshness (CLAUDE.md "Working on main"):
   ```bash
   cd functions && npm run build && cd ..
   firebase deploy --only functions --project production --force
   ./scripts/configure-production-function-invokers.sh studiohub-prod us-east4
   ./scripts/verify-deployed-function-freshness.sh studiohub-prod us-east4
   ```
   (`--force` is needed because one function has a retry policy. Before using
   it, confirm every production function is exported from
   `functions/src/index.ts`, or it will be deleted.)
4. **Check** the thing the secret powers (table below).
5. **Revoke the old value** at the provider, then disable the old version:
   ```bash
   gcloud secrets versions list NAME --project studiohub-prod
   gcloud secrets versions disable OLD_VERSION --secret NAME --project studiohub-prod
   ```

## Rotate first (pasted or shown during the build)

| Secret | Where to make a new one | Check after |
| --- | --- | --- |
| `SENDGRID_API_KEY` | SendGrid → Settings → API Keys → Create (Mail Send + Email Activity read) | Send a test email from a FlawlessIQ job; Messages shows Delivered |
| `STRIPE_SECRET_KEY` | Stripe → Developers → API keys → Roll secret key (choose an expiry for the old one, e.g. 1 hour) | Plan & billing → Open customer portal opens |
| `STRIPE_WEBHOOK_SECRET` | Stripe → Developers → Webhooks → the studio-cue.com endpoint → Roll secret | Stripe shows the next event delivered 200 |
| `DROPBOX_CLIENT_SECRET` | Dropbox App Console → the StudioCue app → Settings → App secret (regenerate) | FlawlessIQ → Integrations → Dropbox still connected; a job folder appears |
| `GOOGLE_CALENDAR_CLIENT_SECRET` | Google Cloud → APIs & Services → Credentials → the OAuth client → Add secret, then delete the old one after step 4 | Consultation availability still shows busy times |
| `ZOOM_CLIENT_SECRET` | Zoom Marketplace → the app → App Credentials → Regenerate | A consultation booking creates a Zoom link |

Connected studios do not need to reconnect for any of these: their refresh
tokens are per studio (`studiohub-tenant_…` secrets) and stay valid when the
app's client secret changes.

## Rotate if they were ever shared

| Secret | Where | Check after |
| --- | --- | --- |
| `STRIPE_CONNECT_WEBHOOK_SECRET` | Stripe → Webhooks → the Connect endpoint → Roll secret | Next Connect event delivered 200 |
| `ZOOM_WEBHOOK_SECRET_TOKEN` | Zoom Marketplace → the app → Feature → Event subscriptions → Secret token | Zoom's endpoint validation passes |
| `QUICKBOOKS_CLIENT_SECRET` | Intuit Developer → the app → Keys & credentials (Production) | QuickBooks still connected on GR and FlawlessIQ |
| `QUICKBOOKS_WEBHOOK_VERIFIER_TOKEN` | Intuit Developer → Webhooks → Show verifier token (regenerate) | Next QuickBooks webhook accepted |
| `SENDGRID_INBOUND_TOKEN` | Generate a random value; update the Inbound Parse URL `?token=` in SendGrid to match | A forwarded inquiry still lands |
| `INBOUND_REPLY_SIGNING_SECRET` | Generate a random value | A client's reply to a studio email still threads. Replies to emails sent before the rotation stop threading |
| `DOCUSIGN_CLIENT_SECRET` | DocuSign held — rotate or delete | — |
| `googlePlacesApiKey` | Google Cloud → Credentials → the Places key → Regenerate (read by App Hosting, so redeploy the app, not functions) | Address autocomplete on the inquiry form |

Generate a random value with:
```bash
python3 -c "import secrets; print(secrets.token_urlsafe(32))"
```

## Not read by any code — candidates to disable

`DROPBOX_WEBHOOK_SECRET`, `DROPBOX_SIGN_API_KEY`, `DROPBOX_SIGN_CLIENT_SECRET`
(Dropbox Sign retired), `INTEGRATION_TOKEN_ENCRYPTION_KEY`,
`SESSION_COOKIE_SECRET`, `GUEST_LINK_SIGNING_SECRET`, `TWILIO_AUTH_TOKEN`
(SMS held). `SENTRY_DSN` has no versions and is read only to stay quiet
(StudioCue reports browser errors to its own `/api/client-errors`). Disable
rather than delete, so a forgotten reader fails loudly and can be turned back
on:

```bash
gcloud secrets versions disable latest --secret NAME --project studiohub-prod
```
