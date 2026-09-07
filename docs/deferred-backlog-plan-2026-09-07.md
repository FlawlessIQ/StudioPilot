# Deferred backlog — implementation plan (2026-09-07)

The items left deferred after the two production audits (`docs/fix-backlog-2026-09-04.md`,
`docs/ux-audit-2-2026-09-04.md`). Each was deferred because it is either **config,
not code** (Stripe dashboard), or a **real feature** needing design/auth testing
that shouldn't be rushed to prod. Same rule as the audits: **every code change
lands with a guard/test.**

Layer reminder (trust boundary): changes flow `features/` (deterministic core) →
`server/` (Admin repos/services) → `functions/` (command/worker) → `lib/` (browser
callers) → `components/`+`app/` (UI).

Grouped smallest-effort/highest-certainty first.

---

## Group A — Stripe Dashboard + one code change (fast, high-trust)

### P9 — Checkout is branded "FlawlessIQ"
- **What:** the subscription checkout (`checkout.stripe.com`) shows "FlawlessIQ" —
  the first money screen names a company the studio has never heard of.
- **Type:** Stripe **Dashboard config**, no code. This is the *platform's* billing
  (StudioCue's SaaS subscription), so the public name should be **StudioCue**, not a
  tenant brand.
- **Do:** Stripe Dashboard → Settings → Business → **Public business name** = StudioCue;
  set the customer-facing **statement descriptor**; add a logo/icon and support URL.
  Verify against a fresh Checkout session.
- **Effort:** XS (config). **Risk:** none. **Owner:** Conor (dashboard).
- **Guard:** n/a (config) — note it in `docs/production-readiness.md` so it isn't lost.

### P11 (payment methods) — Cash App Pay / Klarna offered for a SaaS subscription
- **What:** checkout offers Cash App Pay and Klarna, odd for a monthly B2B SaaS
  subscription; confuses the buyer.
- **Type:** **code** is the reliable fix (dashboard method-toggles are global and
  affect all Stripe usage). `functions/src/saas/stripe-checkout.ts` currently sets
  only `line_items[...]` and leaves method selection to the account default.
- **Do:** in `buildStripeCheckoutParams`, pin
  `payment_method_types[0]=card` (optionally add `us_bank_account` for ACH) instead
  of relying on `automatic_payment_methods`. Keep it a single place so it's testable.
- **Effort:** S. **Risk:** low (restricts to card). **Guard:** extend
  `tests/stripe-checkout.test.ts` to assert the built params request only the intended
  method(s) — mirrors the existing trial_end/email assertions.

---

## Group B — Transactional email hygiene (P3)

### P3 — Auth mail voice + click-tracked auth links
Two distinct problems, both in the auth-mail path (`functions/src/auth/emails.ts`
generates the links via Admin `generateEmailVerificationLink` /
`generatePasswordResetLink`; the actual SendGrid send is built in
`functions/src/operations/jobs.ts:~607` `personalizations` → `POST .../v3/mail/send`).

- **B1 — platform voice.** Verification/reset/workspace mail is dressed as *tenant*
  mail ("StudioCue · powered by StudioCue"). Auth mail is from the **platform**, not a
  studio — it should carry StudioCue's own from-name/branding and copy, clearly
  distinct from tenant→client mail (which correctly says "Ash & Vale · powered by
  StudioCue"). Split the auth templates from the tenant client templates in
  `email-templates.ts` (or give the auth path its own template set) so a studio brand
  never leaks onto a StudioCue account email.
- **B2 — auth links are SendGrid click-tracked (security).** Verification/reset URLs
  arrive wrapped in `u57073990.ct.sendgrid.net/ls/click?...`. Redirect-wrapping an
  **auth** link is a real trust/security issue: the visible host isn't studio-cue.com
  (phishing-adjacent), and a tracking outage can break the link. Disable click/open
  tracking **for auth sends specifically**: add
  `tracking_settings: { click_tracking: { enable: false }, open_tracking: { enable:false } }`
  to the SendGrid payload when the job is an auth type. Cleanest: route auth mail
  through its own send path / SendGrid category with tracking off, leaving marketing/
  tenant mail tracking untouched.
- **Effort:** S–M. **Risk:** low; scoped to the auth category. **Dependency:** know
  which `emailJobs`/send types are "auth" (emailVerification, passwordReset,
  workspace-invite) vs tenant client mail.
- **Guard:** source/unit test asserting (a) the auth send sets
  `click_tracking.enable=false`, and (b) auth templates use platform branding, not a
  tenant `studioName`. Ratchet like the existing email guards.

---

## Group C — Client directory (P22)

### P22 — A booked couple never appears in the Clients directory
- **What:** after booking, the couple isn't in `/studio/clients`, so there's no place
  to see or re-invite them. `app/studio/clients/page.tsx` lists from
  `server/repositories/contact-repository.ts`; booked couples' contacts aren't
  surfaced by that query (the contact/client model diverges between CRM-created
  contacts and invite/booking-created ones).
- **Do (design first):** reconcile the model — decide the single queryable notion of
  "client" (contact with a portal relationship). Options: (a) ensure the
  booking/client-invite path writes/updates a contact the directory query already
  matches; or (b) add a `client`/portal-relationship projection the directory reads.
  Then add a **re-invite** action from the directory row (reuses the client-invite
  command). Must stay tenant-scoped via `TenantRepository`.
- **Effort:** M. **Risk:** medium — touches how clients are registered/queried; get
  the model right so the directory doesn't double-count or miss CRM contacts.
- **Guard:** unit test on the directory query/projection: a booked project's client
  appears exactly once and is re-invitable; a plain CRM contact still appears.
- **Sequence:** do before P19 — durable client sign-in and re-invite share the
  client/portal-relationship model, so settle it here first.

---

## Group D — Durable client sign-in (P19 + N2) — the big one

### P19 — Client portal has no durable/passwordless sign-in; N2 — invite dead-ends
- **What:** clients today must create a **password** account
  (`createUserWithEmailAndPassword` in `invitation-join.tsx`); there's no magic-link,
  no durable re-entry, and (N2) opening the invite while another StudioCue account is
  signed in bounces to a password wall and signs the studio out (one Firebase session
  per browser). A couple who lets their session lapse is dead-ended right when they
  must pay/approve.
- **Do:**
  1. **Passwordless email-link sign-in** for clients: a "email me a sign-in link"
     flow. Server mints the link (Admin `generateSignInWithEmailLink`, or a custom-token
     link for a controlled landing), sent via the (now tracking-free, per P3-B2) auth
     mail path; client clicks → `signInWithEmailLink` → portal. Removes the password
     requirement end-to-end (also simplifies the invite "Create account" step).
  2. **N2 fix:** when the invite token is opened while signed in as a different
     account, offer a **tokened guest view** (read the project via the invite token
     without disturbing the studio session) or a clear "continue as <invited email>"
     that doesn't silently sign the studio out; never prefill the wrong email
     (the audit-2 `studiohub.invitedEmail` prefill already helps the fallback).
  3. Consider **multi-session** tolerance so a solo operator can preview the couple
     view without losing their studio session (or an explicit read-only preview).
- **Effort:** L (multi-day). **Risk:** high — it's auth; needs the rules-tests
  (`npm run test:rules`) and e2e (`npm run test:e2e`) exercised, and careful handling
  of email-link security (link expiry, single-use, domain allow-listing in Firebase
  Auth). **Do not rush to prod.**
- **Guard:** rules tests + e2e for the passwordless flow (link issue → sign-in →
  portal), plus a unit/source guard that the client sign-in no longer *requires* a
  password and that the mismatched-account invite path doesn't force a global sign-out.
- **Dependency:** P3-B2 (tracking-free auth links) and P22 (client/portal model).

---

## Recommended sequencing

1. **P9** (dashboard) + **P11-methods** (code + guard) — a day, ships the billing
   surface cleanly. *Conor does P9 in Stripe; I do P11 in code.*
2. **P3** (auth mail voice + tracking-free auth links) — transactional-email hygiene,
   and a prerequisite for P19's magic links.
3. **P22** (client directory + re-invite) — settles the client/portal model P19 needs.
4. **P19 + N2** (passwordless client sign-in, tokened guest view) — the multi-day
   feature, on top of 2 and 3, with rules + e2e coverage.

Cross-cutting (from audit #1): the "delivery-state surfacing" idea — show real
SendGrid delivered/bounced status on client- and crew-facing sends — would also
harden P3 and is worth folding in when touching the mail path.
