# Intuit payments scope — draft assessment answers (2026-09-28)

For adding `com.quickbooks.online.payments` to StudioCue's production Intuit
app (decision: docs/autopay-spike-2026-09-15.md, "Decision, 2026-09-27").
Drafted from the code so the answers are true of what ships. **Not submitted.**
Conor reviews each answer; nothing goes to Intuit without his yes.

Questions on the live form will be worded differently; match by subject.

## What the app does with payments

StudioCue is operations software for wedding and event photographers. With the
payments scope, a studio can offer its couples **optional autopay of the final
balance**: the couple saves a card once, and StudioCue charges that card on the
final invoice's due date through the QuickBooks Payments API, recording the
payment against the QuickBooks invoice. Nothing else is charged.

- **Opt-in at every level.** The studio switches autopay on (it is refused
  without the payments scope); each couple chooses whether to save a card.
  Couples who don't keep paying through the QuickBooks invoice link as today.
- **One charge, one retry.** On the due date, and once more three days later if
  declined. At most two attempts per invoice.
- **Money** is paid to the studio's own QuickBooks Payments merchant account.
  StudioCue never holds, routes or touches funds.

## Card data (PCI)

- **Card details never reach StudioCue's servers.** The couple's browser sends
  the card number, expiry, CVC and postcode directly to Intuit's tokens
  endpoint (`/quickbooks/v4/payments/tokens`) and receives a single-use token
  (`lib/client/portal-client.ts` `tokenizeCardWithIntuit`).
- StudioCue's server receives **only that token**, and exchanges it for a
  saved card in the studio's Intuit wallet (`createFromToken`).
- StudioCue stores: the Intuit card reference, brand, last four digits, expiry
  month/year, status, and the consent record (below). **No full card number,
  no CVC.**
- Charges use Intuit's `Request-Id` header, derived from the job, so a retried
  request cannot charge twice.

## Consent

Before a card is saved the couple sees, and agrees to, a server-written
statement naming the studio, the amount, the date and the retry — e.g. "I
authorise {studio} to charge this card {amount} for my final balance on
{date}, and to try once more 3 days later if that charge is declined. I can
remove the card before then." StudioCue records that exact text, the amount,
the date, the time, the IP address and the browser, and writes an audit event.
The couple can remove the card at any time before the charge.

## Notifications

A receipt email after a successful charge; an email after a declined charge,
with the invoice link and whether a retry is coming. The studio is notified of
declines and if QuickBooks Payments is not active.

## Security and data handling

- **OAuth tokens** (access and refresh) are held in Google Secret Manager, never
  in the database or in any browser.
- **Hosting:** Google Cloud (Firebase: App Hosting, Cloud Functions, Firestore),
  region us-east4. Data encrypted at rest and in transit (Google-managed).
- **Access control:** multi-tenant; every record carries its studio's tenant id
  and security rules plus server checks confine each studio to its own data.
  Payment commands run server-side only, after verifying the signed-in user,
  their studio membership and role.
- **Audit:** consent, card saves and removals, and charges are written to an
  append-only audit log.
- **Deletion:** a studio can export its data or request deletion from Settings →
  Data & account; a couple can remove a saved card themselves.

## Scopes requested

`com.intuit.quickbooks.accounting` (already approved: invoices, payments sync)
and `com.intuit.quickbooks.payment` (new: save a card by token, charge it).
The payments scope is requested **only** when a studio chooses "Reconnect for
payments"; an ordinary QuickBooks connect does not ask for it.

## For Conor to fill in

- Company legal name, address, contact — as on the existing app listing.
- Anything asking for a security contact, incident-response owner, or
  penetration-test history: answer from FlawlessIQ's actual position; the code
  doesn't say.
- Expected volume: pilot scale (one or two studios; a handful of charges a
  month) until launch.
