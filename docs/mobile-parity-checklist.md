# Mobile parity checklist

Every UI screen in the app today (127 routes), as a checklist for the mobile
build. Goal: every screen a studio, client, or crew member touches gets a
purpose-built mobile layout — and nothing legacy is carried along.

**How to read this:**
- `[ ]` = needs a mobile design/build · `[x]` = done · `[–]` = no mobile work (alias/redirect, or desktop-only by decision)
- **P0** flagship/first · **P1** core parity · **P2** deep/occasional
- **Tab** = the mobile bottom-tab home for the screen (Today · Jobs · Cue · Clients · More)

Source of truth: `app/**/page.tsx`. Generated 2026-09-13. Legacy scan: inbound-link
count per route + file inspection — **no dead studio screens found**; the only
non-screens are one redirect alias and the marketing demo (both marked `[–]`).

---

## 1. Studio workspace — the app (mobile-critical)

### Today tab — the inbox home
- [ ] **P0** `/studio` — Today (ranked inbox home) · **the flagship screen**
- [ ] **P1** `/studio/notifications` — notifications feed · Tab: Today
- [ ] **P1** `/studio/leads` — inbound leads/inquiries list · Tab: Today
- [ ] **P1** `/studio/leads/[id]` — a single lead · Tab: Today
- [ ] **P2** `/studio/tasks` — task list · Tab: Today
- [ ] **P2** `/studio/tasks/new` — new task (sheet on mobile) · Tab: Today

### Jobs tab — the wedding lifecycle
- [ ] **P0** `/studio/projects` — Jobs list (by readiness/date) · Tab: Jobs
- [ ] **P0** `/studio/projects/[id]` — a wedding (readiness + actions) · **flagship-adjacent**
- [ ] **P1** `/studio/projects/new` — create job (sheet/flow) · Tab: Jobs
- [ ] **P1** `/studio/booking` — booking gate/confirmation · Tab: Jobs
- [ ] **P1** `/studio/planning` — run-of-show builder · Tab: Jobs
- [ ] **P1** `/studio/readiness` — readiness board · Tab: Jobs
- [ ] **P1** `/studio/schedules` — schedule versions · Tab: Jobs
- [ ] **P2** `/studio/schedules/[id]` — one schedule version · Tab: Jobs
- [ ] **P2** `/studio/schedules/new` — new schedule · Tab: Jobs
- [ ] **P1** `/studio/questionnaires` — questionnaires · Tab: Jobs
- [ ] **P1** `/studio/proposals` — proposals list · Tab: Jobs
- [ ] **P1** `/studio/proposals/[id]` — a proposal · Tab: Jobs
- [ ] **P2** `/studio/proposals/[id]/preview` — proposal preview · Tab: Jobs
- [ ] **P1** `/studio/proposals/new` — compose proposal · Tab: Jobs
- [ ] **P1** `/studio/contracts` — contracts · Tab: Jobs
- [ ] **P1** `/studio/invoices` — invoices · Tab: Jobs
- [ ] **P1** `/studio/insurance` — COI / insurance · Tab: Jobs
- [ ] **P2** `/studio/documents` — documents · Tab: Jobs
- [ ] **P1** `/studio/event-day` — event-day view (offline-critical) · Tab: Jobs
- [ ] **P1** `/studio/post-production` — post-production · Tab: Jobs
- [ ] **P2** `/studio/post-production/[id]` — one post-prod job · Tab: Jobs
- [ ] **P1** `/studio/delivery` — gallery delivery · Tab: Jobs
- [ ] **P1** `/studio/reviews` — review requests · Tab: Jobs

### Cue tab — the assistant
- [ ] **P0** `/studio/copilot` — Cue (chat assistant) · Tab: Cue
- [ ] **P1** `/studio/ai-queue` — AI review queue (approve-to-send) · Tab: Cue

### Clients/People tab
- [ ] **P0** `/studio/messages` — message threads · Tab: Clients
- [ ] **P1** `/studio/clients` — clients list · Tab: Clients
- [ ] **P1** `/studio/clients/new` — add client · Tab: Clients
- [ ] **P1** `/studio/crew` — crew list · Tab: Clients
- [ ] **P2** `/studio/crew/[id]` — a crew member · Tab: Clients
- [ ] **P2** `/studio/crew/new` — add crew · Tab: Clients
- [ ] **P2** `/studio/team` — internal team · Tab: Clients
- [ ] **P1** `/studio/vendors` — vendors & venues (run-of-show share) · Tab: Clients

### More tab — the deeper shelf
- [ ] **P1** `/studio/calendar` — calendar · Tab: More (or its own)
- [ ] **P1** `/studio/library` — library hub · Tab: More
- [ ] **P1** `/studio/packages` — packages · Tab: More
- [ ] **P2** `/studio/packages/[id]` — a package · Tab: More
- [ ] **P2** `/studio/packages/new` — new package · Tab: More
- [ ] **P2** `/studio/import` — AI import studio · Tab: More
- [ ] **P2** `/studio/setup` — studio setup · Tab: More
- [ ] **P1** `/studio/settings` — studio settings (owner) · Tab: More
- [ ] **P1** `/studio/integrations` — integrations/connections · Tab: More
- [ ] **P2** `/studio/subscription` — billing/subscription · Tab: More
- [ ] **P2** `/studio/workflows` — workflows · Tab: More
- [ ] **P2** `/studio/workflows/[id]` — a workflow · Tab: More
- [ ] **P2** `/studio/workflows/new` — new workflow · Tab: More
- [ ] **P2** `/studio/automations` — automation runs · Tab: More
- [ ] **P2** `/studio/audit` — audit log · Tab: More
- [ ] **P2** `/studio/reports` — insights/reports · Tab: More
- [ ] **P2** `/studio/reports/release-evidence` — launch gates · Tab: More
- [ ] **P1** `/studio/help` — help hub · Tab: More
- [ ] **P2** `/studio/help/example` — example tour · Tab: More
- [–] `/studio/insights` — **redirect alias** → `/studio/reports` (no build)

---

## 2. Client portal (external clients — often on a phone)
These are a **separate mobile surface**; couples live on their phones, so this
track is as mobile-critical as the studio app.
- [ ] **P0** `/client` — portal home
- [ ] **P1** `/client/project` — their event
- [ ] **P1** `/client/proposal` — review/accept proposal
- [ ] **P1** `/client/contract` — sign/contract
- [ ] **P1** `/client/payments` — pay retainer/balance
- [ ] **P1** `/client/questionnaire` — planning questionnaire
- [ ] **P1** `/client/schedule` — run of show
- [ ] **P1** `/client/messages` — messages
- [ ] **P1** `/client/delivery` — gallery
- [ ] **P2** `/client/documents` — documents
- [ ] **P2** `/client/package` — package details
- [ ] **P2** `/client/reviews` — leave a review

## 3. Crew portal (second shooters/assistants — the MOST mobile-first users)
Crew are on their phones at venues with bad signal — arguably the highest-value
mobile track. Offline event-day is essential here.
- [ ] **P0** `/crew` — crew home
- [ ] **P1** `/crew/jobs` — assigned jobs
- [ ] **P1** `/crew/pending` — pending offers (accept/decline)
- [ ] **P1** `/crew/accepted` — accepted jobs
- [ ] **P0** `/crew/event-day` — event-day brief (**offline-critical**)
- [ ] **P1** `/crew/schedule` — their segments
- [ ] **P1** `/crew/prep` — prep/requirements
- [ ] **P1** `/crew/requirements` — documents required
- [ ] **P1** `/crew/documents` — upload documents
- [ ] **P1** `/crew/availability` — set availability
- [ ] **P1** `/crew/closeout` — hours/expenses/closeout
- [ ] **P2** `/crew/profile` — profile
- [ ] **P2** `/crew/account` — account

## 4. Auth & onboarding (all surfaces)
- [ ] **P1** `/auth/login`
- [ ] **P1** `/auth/register`
- [ ] **P1** `/auth/onboarding`
- [ ] **P1** `/auth/workspaces` — workspace switcher
- [ ] **P2** `/auth/forgot-password`
- [ ] **P2** `/auth/reset-password`
- [ ] **P2** `/auth/verify-email`
- [ ] **P2** `/auth/email-link`
- [ ] **P2** `/auth/invite` · `/auth/client-invite` · `/auth/crew-invite` — invite acceptance

## 5. Public / marketing (already responsive; separate lower-priority track)
Not part of the "app" — but should still feel good on mobile. Mostly done.
- [x] `/` — home (mobile pass shipped)  · [ ] `/features` · [ ] `/pricing` · [ ] `/integrations`
- [ ] `/for-clients` · [ ] `/for-crew` · [ ] `/wedding-photographers` · [ ] `/corporate-photographers` · [ ] `/sports-photographers`
- [ ] `/support` · [ ] `/privacy` · [ ] `/terms` · [ ] `/docs/zoom`
- [ ] `/inquiry` — public inquiry form (mobile-important — couples submit on phones)
- [ ] `/start-trial` · [ ] `/schedule/consultation` — public consultation booking
- [–] `/studio-preview` — marketing "explore the live product" demo (not the app; review whether still used)

## 6. Utility / token / system (public, minimal UI)
- [ ] `/share/[token]` — vendor run-of-show share (**already mobile-designed** — the recent build)
- [–] `/share/confirmed` — post-confirm (tiny; fine as-is)
- [ ] `/reply/[token]` — studio reply-approval page
- [–] `/reply/sent` — confirmation (tiny)
- [ ] `/offline` — offline fallback (part of the PWA work)

## 7. Platform admin (internal Flawless/ops — DECISION NEEDED)
Not a studio-facing surface. **Decision:** is the mobile app expected to cover
platform-admin, or is desktop-only acceptable here? Recommend desktop-only.
- [–] `/platform-admin` and its 9 sub-pages (audit-logs, failed-jobs, feature-flags,
  integrations, subscriptions, support, system-health, tenants, users) — desktop-only unless decided otherwise.

---

## Summary
- **~57 studio app screens** (the core mobile build), **12 client-portal**, **13 crew-portal**,
  **~11 auth**, **~16 public/marketing**, **5 utility**, **10 platform-admin**.
- **No dead legacy screens.** Only non-builds: `/studio/insights` (redirect alias) and
  `/studio-preview` (marketing demo, confirm if still used).
- **Two tracks are as mobile-critical as the studio app:** the **crew portal** (on-site, offline)
  and the **client portal** (couples on phones). Worth deciding if they're in the same mobile
  initiative or sequenced after the studio app.
- **Open decisions:** (1) platform-admin desktop-only? (2) client + crew portals in-scope now or later?
