# Agreement text StudioCue writes into studios' contracts

StudioCue is not a party to these agreements. Each studio writes or adopts its
own agreement; StudioCue supplies a starting point and fills in job details.
What follows is every piece of wording StudioCue itself contributes.

## 1. Starter agreement

Offered to a studio that has no agreement of its own. Each `[Replace …]`
section must be completed by the studio; `{{…}}` fields are filled from the
job. Source: `features/contracts/sample.ts` (`STARTER_AGREEMENT`).

```text
This agreement is between {{studio.legal_name}} ("the Studio") and {{client.names}} ("the Client") for {{event.type}} coverage on {{event.date}} at {{event.venue}}.

## 1. Services
The Studio will provide the {{package.name}}: {{package.coverage}}. Included:
{{package.deliverables}}

## 2. Fees and payment
The total fee is {{price.total}}. A retainer of {{price.retainer}} reserves the date, and the balance of {{price.balance}} is due as follows:
{{payment.schedule}}

## 3. Cancellation and rescheduling
[Replace with your own cancellation and rescheduling terms.]

## 4. Image use and copyright
[Replace with your own terms on copyright, usage and portfolio rights.]

## 5. Limitation of liability
[Replace with your own terms.]

This agreement was prepared on {{contract.date}}.
```

## 2. Schedule A — event details (every agreement)

Appended to every agreement (or placed where the studio's template puts
`{{event.details}}`). The lock sentence appears only for job types that lock
details (weddings; four weeks by default, set per studio). Example as rendered:

### Schedule A — Wedding details

These details form part of this agreement. Anything marked "To be confirmed" is added when the final details are confirmed, four weeks before the date. After that, changes to locations or times are agreed with us in writing.

- Date: June 12, 2027
- Coverage: 2 photographers, 8 hours
- Getting ready: To be confirmed
- Ceremony: St Mary's Church, 3 Church St
- Reception: To be confirmed
- Times: 3:00 PM

Source: `features/contracts/event-details.ts`.

## 3. Booking amendments

A signed booking changes only through an amendment the client signs. The
amendment restates the whole agreement beneath this preamble (source:
`functions/src/contracts/amendments.ts`, `amendedDocument`):

> **What this changes**
>
> This amends the agreement signed on {date}. It changes only what is listed
> here; the agreement below restates everything as it stands after the change,
> and replaces the earlier version once both parties sign.
>
> - {each change, one line}
>
> **The agreement as amended**

## 4. Pricing clauses

When a studio's own wording states a price (e.g. "$4,500" or "a 25%
retainer"), StudioCue flags the line and asks the studio to replace it with
`{{price.total}}` / `{{price.retainer}}`, so the proposal and agreement
cannot disagree. Nothing is changed for them. Source:
`features/contracts/pricing-clauses.ts`.
