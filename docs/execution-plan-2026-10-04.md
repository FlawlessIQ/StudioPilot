# Execution plan — everything Claude can build, Oct 4 → November

Everything on the roadmaps and backlogs that does not need Conor's hands,
in the order it ships. Sources: `docs/launch-build-plan-2026-10-05.md` §4–§6,
`docs/launch-checklist-2026-10-05.md`, the job-kinds plan and the open items
in memory. Each item was checked against the code on 2026-10-04; the
**Now** column is what is actually there, not what the plan assumed.

**Rules for every phase.** Each phase is one or more commits on `main`,
gated by `typecheck → test → lint → build` plus `cd functions && npm run
build`. Deploy is functions first (deploy-all, invokers script, every bundle
checked by marker), then an App Hosting rollout verified by commit, then a
walk on prod. A phase is done when its **exit check** passes on prod, not
when it merges.

**Conor's items** (launch Monday, Stripe settings, MFA, secrets, SendGrid
subuser, PITR, DMARC, Dropbox app, Gabe's consent) are not in this plan
except where a phase waits on one; those are marked **⏸ Conor**.

---

## Phase 0 · Launch support — Sun Oct 4 → Mon Oct 5

No feature work. Keep the launch clean.

| # | Item | Notes |
|---|---|---|
| 0.1 | Watch Conor's real-card signup | Logs, Stripe webhook, receipt, portal, cancel, refund. Record the evidence in the checklist |
| 0.2 | List the secrets pasted into chat; redeploy after Conor rotates them | **⏸ Conor** rotates |
| 0.3 | Launch-day watch, every two hours | Errors, 5xx, `_unexpected`, `client_error`, signups, webhooks, email sends. Fix anything new at once |

**Exit:** a real paid trial exists on prod with evidence; no unexplained error.

---

## Phase 1 · Trial-end core — Oct 6–7

The first trials end Oct 19. Today the product does three wrong things
when a studio lapses: staff never see the gate, `unpaid` gets a second free
trial, and an out-of-order webhook can revive a cancelled subscription.

| # | Item | Now | Change |
|---|---|---|---|
| 1.1 | **One access rule** | `entitlement-guard.ts:44-46` and `features/subscriptions/entitlements.ts:73-75` allow only trialing/active; past_due is a hard block; no read-only | One function, mirrored in both places with a drift test: trialing/active = **full**; past_due ≤ 7 days = **full + banner**; past_due > 7 days, unpaid = **read-only**; cancelled = **read-only for 30 days**, then closed; suspended = closed. Read-only means view and export, no sending and no changes |
| 1.2 | **Status mapping** | `stripe.ts:128-145` maps `unpaid` and `incomplete_expired` to `incomplete`; `:321` treats `incomplete` as a first checkout → second free trial | Add `unpaid` to the schema (or map to past_due with `unpaidAt`); `incomplete_expired` → cancelled. `firstCheckout` only when no subscription has ever existed |
| 1.3 | **Webhook ordering** | `event.created` parsed (`stripe.ts:80`), never stored; dedupe by id only (`:402`) | Store `lastStripeEventCreated` on the subscription doc; skip older events in a transaction |
| 1.4 | **Staff see the billing state** | The gate reads `subscriptions/{tenantId}` directly; rules let only the owner read it (`firestore.rules:911-913`); the bootstrap fallback returns no status (`bootstrap/route.ts:95-104`) → staff get the full UI and every command fails | Bootstrap returns `{status, accessLevel, graceEndsAt}` to every member; the gate shows "Ask the studio owner to update billing" for non-owners |
| 1.5 | **Export through the gate** | Server already allows it (`data-lifecycle.ts:82,257`); the UI is hidden because settings sits behind the gate | Exempt Settings → Data from the gate alongside `/studio/subscription` |
| 1.6 | Tests | — | Unit: each status × {studio command, client send, UI gate, export}. Rules test for the bootstrap path |

**Exit:** on prod, a test tenant forced to past_due shows the banner to the
owner **and** a staff member; forced beyond grace, commands are refused with
a read-only message and export still downloads.

---

## Phase 2 · Couples stop hearing from a lapsed studio — Oct 7–8

| # | Item | Now | Change |
|---|---|---|---|
| 2.1 | **Outreach hold** | `clientOutreachStop` (`post-event/client-outreach.ts:49-61`) checks only the project; no scheduler or the email queue reads subscription status | One helper `tenantOutreachAllowed(tenantId)` (from 1.1's rule, cached per run). Called in: the email job worker (`operations/jobs.ts`), autopay, the final-invoice scheduler, event/contract/form/questionnaire/COI/review/album reminders, the lifecycle scheduler and the crew-offer follow-ups |
| 2.2 | **Held, not dropped** | — | A blocked job is marked `held_billing` with its original send time. On reactivation (webhook → active), held jobs are released, skipping any now past their useful date (re-checked by the scheduler, per *scheduled client email must recheck*) |
| 2.3 | **Trial-ending banner** | Only on the subscription page (`live-subscription.tsx:118,173`) | App-wide banner from 3 days out: date, plan and amount, link to Plan & billing |
| 2.4 | Tests | — | Every scheduler: held while lapsed, released on reactivation, never double-sent |

**Exit:** on prod, a lapsed test tenant with a due reminder and a due
autopay sends neither; reactivating it releases the reminder and the charge
once.

---

## Phase 3 · Access and data correctness — Oct 8–9

| # | Item | Now | Change |
|---|---|---|---|
| 3.1 | **Invitees never see "Create your workspace"** | `workspace-routing.ts:32`, `auth-boundary.tsx:101-113` and Google sign-in send anyone without a membership to onboarding | Before routing, a server lookup of pending client/crew invitations for the verified email; if found, go to the invitation |
| 3.2 | **Crew messages** | Both queries (`live-record-detail.tsx:313-317`, `crew-parts.tsx:184-190`) lack `projectId`; rules need it for coordinators/subcontractors (`firestore.rules:748-756`) → empty thread | Add `where("projectId", "==", …)`; composite index; check on prod as a crew member and a coordinator |
| 3.3 | **The 250-record cap** | `studio/records/route.ts:65-80` takes 250 unordered, then filters by project | Filter by `projectId` / `projectIds array-contains` in the query; add indexes; add the subscription check the route lacks |
| 3.4 | **Counsel package** | — | One folder by Oct 9 per build plan §6: the legal set as published, e-sign consent + nine questions, contract text, notices, open questions, v1.1 change-log template |

**Exit:** an invited couple signing in with Google lands on their portal; a
coordinator sees crew messages; a project with records beyond the first 250
shows them all.

---

## Phase 4 · Security hardening — Oct 9–13

| # | Item | Now | Change |
|---|---|---|---|
| 4.1 | **Browser writes in rules** | Owners/managers can create/update `projects`, `contacts`, `memberships`, `tenants`, and users their own doc (`firestore.rules:114-178`) — bypassing commands and the subscription guard | First confirm no UI path writes these directly (grep `setDoc/updateDoc/addDoc`). Then `if false` for each the app does not use; keep the narrow `users` key update if it is used. Rules tests with adversarial cases; deploy rules |
| 4.2 | **Client IP for rate limits** | The relay forwards the leftmost `x-forwarded-for` (`functions/[functionName]/route.ts:134-135`) — client-controlled | Use the hop App Hosting appends (rightmost trusted); same in `crm/security.ts:40-42` and the public Places route |
| 4.3 | **Public Places quota** | No App Check, 120/hour per hashed slug+IP+UA (`public/places/route.ts`) | App Check token required (the inquiry page already loads App Check) plus a daily cap per tenant |
| 4.4 | **CORS** | `security/cors.ts:1-6` allows `localhost` and `*.chatgpt.site` everywhere | Environment switch: prod allows `studio-cue.com` (and the hosted.app origin) only; emulator keeps localhost. Remove `app/chatgpt-auth.ts` if unused |
| 4.5 | **SVG on public branding** | `storage.rules:176-181` allows `image/svg+xml` with public read | Drop SVG; check existing branding uploads for any SVG and convert |
| 4.6 | **Dropbox Sign webhook** | Still exported (`functions/src/index.ts:33`) | Remove the export and delete the function; drop it from the invokers allowlist |

**Exit:** rules tests green with new adversarial cases; a spoofed
`X-Forwarded-For` does not reset a rate limit; a cross-origin call from a
non-allowed origin is refused.

---

## Phase 5 · Prove the lifecycle, harden email, add CI — Oct 12–16

| # | Item | Now | Change |
|---|---|---|---|
| 5.1 | **Lifecycle proof on prod** | — | A test tenant driven through trial-end, payment failure, grace, read-only, reactivation and cancel, using `trialEndOverride` and Stripe test events through the real handler. Screenshots and log lines recorded in the checklist |
| 5.2 | **PDF service** | 1 Gi, concurrency 4 (`cloud-run/capacity-policy.yaml:3-11`); OOM seen | 2 Gi, concurrency 2, in the policy file and the apply script; re-render a long contract |
| 5.3 | **Delivery reconciler** | Every 15 min, throws on 429, no Retry-After (`delivery-reconciler.ts:100-185`) | Honour Retry-After, back off and stop the run on 429. **⏸ Conor** creates the SendGrid subuser; then wire and verify its Event Webhook |
| 5.4 | **Test-address guard** | None | Never send to `example.com/.org/.net`, `.test`, `.invalid`, `.localhost`; mark the job `suppressed_test_address`. Check SendGrid's suppression list for bounces before a client send |
| 5.5 | **CI** | No `.github/` | GitHub Action on push to main: typecheck, `npm test`, lint, functions build, rules tests in the emulator |

**Exit:** the lifecycle evidence table is complete; no reconciler 429 errors
for 48 hours; CI is green on main.

---

## Phase 6 · Tidy and watch the first trial-end — Oct 16–19

| # | Item | Change |
|---|---|---|
| 6.1 | **Archive the four test tenants** | Keep what Zoom's review needs; list them for Conor before archiving |
| 6.2 | **Stale docs** | `production-readiness.md` (09-09), `integration-production-readiness.md` (09-28) and `manual-launch-checklist.md` (10-01) brought up to date, or folded into one |
| 6.3 | **Oct 19 live watch** | Every trial conversion, failure and email that day; fix anything at once |

**Exit:** the first studios convert or lapse correctly, and their couples
see the right thing either way.

---

## Phase 7 · Product backlog — from Oct 20

Ordered by how directly it touches a real studio's money or a couple's
experience.

| # | Item | Now | Change |
|---|---|---|---|
| 7.1 | **Multi-package delivery and billing** | 25 files read only `packageSnapshotId`. Crew is fine; delivery (`delivery-closeout-workspace.tsx`, `post-event/commands.ts:910`) and billing (`final-invoice.ts`, `invoice-corrections.ts`, payment components, `job-package-facts.ts`, `today/inbox.ts`) ignore additional packages | One `jobPackages(project)` reader; a job is DELIVERED only when every package's deliverables are; final balance and Today read all packages. Prod walk with a photo + film job, plus a QuickBooks void |
| 7.2 | **Help copy by job kind** | ~137 lines say "couple" in `features/help/` (explainers 78, glossary 31, video manifest 21) | Route help text through `vocab(kind)`; ratchet the job-kind copy guard over `features/help` |
| 7.3 | **Mobile couple and crew screens on a real device** | Redesigned for phones but only CSS-checked | Walk every couple and crew screen in the iOS Simulator and at Pixel width on prod; fix what breaks |
| 7.4 | **Cue checks on prod** | Prompt fingerprint bumped; A2/A4 and a family-job turn not re-run | Re-run and record |
| 7.5 | **Questionnaire AI mapping** | Built, unproven on prod | One real questionnaire on a FlawlessIQ job; check each mapped field |
| 7.6 | **Lead capture end to end** | Forwarding path unproven with a real Gmail filter | **⏸ Conor** sets the Gmail filter; Claude verifies the trust path and the job created |
| 7.7 | **Corporate agreement draft** | None | A corporate starter agreement for counsel, in the same structure as the wedding one |
| 7.8 | **Group events (job types Phase 5)** | Design doc first | Write the design doc; build after Conor approves |
| 7.9 | **Counsel's edits → v1.1** | Waiting on counsel | Apply, bump versions in both copies, email studios 30 days ahead where the Terms require it |
| 7.10 | **Zoom summaries step** | Waiting on Zoom's re-review | On approval, switch the outside step on and walk one real consultation |

**Needs a decision from Conor before building:** whether the first reply to
an inquiry carries pricing (lead plan 4.4); GR's starter backfill (GR is a
real studio).

---

## Timeline

| When | Phase |
|---|---|
| Sun Oct 4 → Mon Oct 5 | 0 · Launch support |
| Tue Oct 6 → Wed Oct 7 | 1 · Trial-end core |
| Wed Oct 7 → Thu Oct 8 | 2 · Outreach hold + trial banner |
| Thu Oct 8 → Fri Oct 9 | 3 · Access and data correctness · counsel package |
| Fri Oct 9 → Tue Oct 13 | 4 · Security hardening |
| Mon Oct 12 → Fri Oct 16 | 5 · Lifecycle proof, email, CI |
| Fri Oct 16 → Mon Oct 19 | 6 · Tidy and watch the first trial-end |
| From Tue Oct 20 | 7 · Product backlog |

Phases 1–3 can start as soon as launch day is quiet; nothing in them waits
on Conor.
