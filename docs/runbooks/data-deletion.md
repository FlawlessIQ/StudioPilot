# Runbook — account and personal-data deletion requests

What we promise (Terms §14, Privacy Policy "Retention and deletion"):
- a closing studio gets **30 days to export**;
- then its workspace data is **deleted**;
- remaining backup copies **expire within 90 days** (backups are kept 84 days).

Until the automated path exists (launch plan follow-up: nothing processes a
`platform_approved` deletion request yet, and there is no Auth user deletion),
every request is handled by hand, as below.

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
6. **Delete.** Run a reviewed one-off script with the Admin SDK and
   `tenantId == {tenantId}`, in this order:
   1. **Dry run:** count the documents per top-level collection where
      `tenantId == {tenantId}`. Paste the counts into the request record.
   2. Delete those documents in batches, including the `tenants/{id}`,
      `subscriptions/{id}` and `memberships/{tenantId}_*` documents.
   3. Delete the Storage prefix `tenants/{tenantId}/`.
   4. Delete the integration secrets `studiohub-{tenantId}-*` in Secret
      Manager. If the tokens are still valid, revoke them at the provider
      first.
   5. Delete the Firebase Auth users whose only membership was this tenant.
      Keep anyone who belongs to another studio.
   6. **Keep:** StudioCue's own billing records (Stripe, 7 years) and the
      `auditEvents` needed to prove the deletion happened. Strip personal
      fields from those audit events.
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
