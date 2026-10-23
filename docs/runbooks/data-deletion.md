# Runbook — account and personal-data deletion requests

What we promise (Terms §14, Privacy Policy "Retention and deletion"):
- a closing studio gets **30 days to export**;
- then its workspace data is **deleted**;
- remaining backup copies **expire within 90 days** (backups are kept 84 days).

**Automated since 2026-10-15.** `tenantDeletionWorker`
(`functions/src/saas/tenant-deletion.ts`) runs hourly and carries out step 6
below for every `platform_approved` request whose `deleteAfter` has passed.
It resumes a run that stopped part way, and leaves the request `completed`
with its `manifest` and a "By hand" list in the Console: email the owner, plus
any credential it couldn't destroy. Steps 1–5 and 7 are still people's work.

**Never a live studio (2026-10-22).** One rule,
`tenantDeletionRefusal` (`functions/src/saas/tenant-deletion-policy.ts`),
refuses a studio that is **comped in any mode** (local or a Stripe coupon), or
whose subscription is trialing, active, past due, unpaid, paused, `incomplete`
with a Stripe subscription behind it, unreadable, missing or contradictory.
Only `cancelled`/`canceled`/`incomplete_expired`, or `incomplete` with no
Stripe subscription, may be deleted. It is checked when the Console approves,
when the worker starts, and again immediately before every step. A refusal
stops everything, sets the request to `status: refused` with `refusedReason`
and `refusedAtStep` (the Console shows "Refused: still live" and the reason),
and logs `TENANT_DELETION_REFUSED`. End the billing or the comp, then approve
the refused request again; the worker resumes where it stopped. The owner can
cancel at any point before `completed`, and the worker stops at its next step.

**Response times.** Acknowledge within 5 business days. Complete within 45
days of a verified request (the strictest US state deadline).

---

## A · A studio closes its account

1. **The request arrives.**
   - **In the app:** Settings → Data & account → delete. This writes
     `deletionRequests/{id}` with `status: cooling_off` and `deleteAfter` set
     30 days out (`functions/src/saas/data-lifecycle.ts`).
   - **By email** to support@studio-cue.com: reply to confirm, and ask the
     owner to make the request in the app. If they can't, record it by hand
     with the same fields.
2. **Verify** that the requester is the workspace **owner**. An in-app
   request is verified already. An email must come from the owner's sign-in
   address.
3. **Billing.** Cancel the Stripe subscription at period end (Stripe
   dashboard → customer → subscription). Refunds follow Terms §3: none for
   partial periods; annual plans in full within 14 days of the first annual
   charge.
4. **Export window (30 days).** The owner can export from Settings → Data &
   account. The export does not yet include uploaded files and some
   collections (consultations, conversations, emailJobs, crewMessages,
   contractSignatures, contractDrafts, bookingAmendments, addOns). If the
   owner asks for files, send a zip of `tenants/{tenantId}/` from Storage
   (`gsutil -m cp -r gs://studiohub-prod.firebasestorage.app/tenants/{tenantId} .`).
5. **After `deleteAfter`.** A platform admin approves the request in the
   Console. The request moves to `platform_approved`.
6. **Delete — automatic.** The worker does the following, in this order
   (by hand only if it fails; its `lastError` shows in the Console). The
   refusal rule above is read before each numbered step. Recoverable work
   comes first, then the irreversible steps from cheapest to put right to
   dearest, so a refusal or failure part way leaves as much standing as it can:
   1. **Dry run:** count the documents per top-level collection where
      `tenantId == {tenantId}`, and record the members and connected
      providers on the request before anything goes.
   2. Delete those documents in batches, including the
      `memberships/{tenantId}_*` documents. Recoverable with point-in-time
      recovery (7 days).
   3. Strip personal fields from the studio's `auditEvents`.
   4. Delete the integration secrets `studiohub-{tenantId}-*` in Secret
      Manager. If the tokens are still valid, revoke them at the provider
      first. (Irreversible; the owner can reconnect.)
   5. Delete the Firebase Auth users whose only membership was this tenant.
      Keep anyone who belongs to another studio. (Irreversible.)
   6. Delete the Storage prefixes `tenants/{tenantId}/` and
      `feedback/{tenantId}/`. Last of the irreversible steps: nobody can put
      a studio's files back.
   7. Delete `subscriptions/{id}` and `tenants/{id}`, write the tombstone and
      mark the request `completed`, in one batch.
   8. **Keep:** StudioCue's own billing records (Stripe, 7 years, and the
      `saasInvoices` mirror), the `auditEvents` needed to prove the deletion
      happened (personal fields stripped), and records that name the studio
      but are someone else's or the platform's — `saasReferrals` (a
      referrer's credit or partner's commission), vendor offer codes,
      `vendorInvites`, `saasAttribution`, `saasLeads`, `supportAccess` and the
      Console's own records. The full list, with the reason for each, is
      `TENANT_DELETION_KEPT` in `tenant-deletion-policy.ts`.
7. **Close it out.** Set the request to `status: completed` with
   `completedAt`, and email the owner. Backups roll off within 84 days. No
   restore may bring this tenant back unless the owner asks.

## B · A studio's client, crew member or vendor asks

1. StudioCue processes this data for the studio (Privacy Policy, "Studios and
   their clients"). Forward the request to the studio owner within 5 business
   days, and tell the person we have done so.
2. If the studio asks us to help:
   - **A whole job:** use the per-job purge
     (`functions/src/projects/purge-command.ts`).
   - **A single contact:** delete or anonymise the contact by hand. Keep any
     signed agreement and its evidence the studio must retain, and note that
     on the request.
3. If the studio is gone, or doesn't respond within 30 days, handle it as in
   A6 for that person's records only, and log it.

## C · A studio account owner asks about their own data (access or correction)

Send an export (A4), or correct the data. Log the request and the response in
the support inbox thread.
