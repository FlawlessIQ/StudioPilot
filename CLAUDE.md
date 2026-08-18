# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

StudioCue (package name `studiohub`) is a multi-tenant photography operations OS. It coordinates the full client and event lifecycle — inquiry, booking, readiness, event-day execution, delivery, review, and closeout — across studio, client, crew, and platform-admin workspaces. The product spans Milestones 1–8; see `docs/build-progress.md` for history and `docs/production-readiness.md` before enabling live integrations.

## Commands

```bash
npm run dev                 # Next.js dev server (http://localhost:3000)
npm run build               # production build (Playwright e2e runs against `npm run start`, not dev)
npm run typecheck           # strict tsc --noEmit (root app only; excludes functions/, cloud-run/)
npm run lint                # ESLint (ignores dist, .next)
npm test                    # fast unit + policy tests (tsx --test, explicit file list — see below)
npm run test:rules          # Firestore rules tests via emulator
npm run test:storage-rules  # Firestore + Storage rules tests via emulator
npm run test:e2e            # Playwright, desktop + mobile (Pixel 7) projects
npm run seed                # emulator-only demo seed (refuses to run outside the emulator)
```

Local bring-up requires Node ≥ 22.13 and Java ≥ 21 (for the Firebase Emulator Suite). Copy `.env.example` to `.env.local` and set a 12+ char `SEED_DEMO_PASSWORD`. Then:

```bash
firebase emulators:start   # Auth 9099, Functions 5001, Firestore 8080, Storage 9199, UI 4000
npm run seed
npm run dev
```

### Running a single test

`npm test` runs an **explicit, curated list** of test files (see the `test` script in `package.json`) — it does not glob `tests/`. New test files must be added to that list to run in the suite. To run one file directly:

```bash
npx tsx --test tests/project-state.test.ts
```

Rules tests must go through the emulator wrapper, e.g. `firebase emulators:exec --only firestore "tsx --test tests/firestore-rules.test.ts"`.

### The `functions/` package is separate

Cloud Functions live in `functions/` with their **own** `package.json`, `tsconfig.json`, and `node_modules`, and their own build. Root `npm run typecheck` explicitly excludes `functions/`. To work on functions:

```bash
cd functions && npm install && npm run build
```

## The trust boundary (read this before writing server logic)

The browser is **never** trusted to authorize sensitive work. This is the central architectural constraint and it dictates where code lives:

- **UI components** (`components/`, `app/`) contain no business-state transitions, readiness/billing/provider decisions, or authorization logic. Client role display is convenience only, never authority.
- **Sensitive mutations go through Cloud Functions command endpoints** (`functions/src/*/commands.ts`), not direct Firestore writes. Browsers have no create permission for leads, packages, package snapshots, command executions, rate-limit counters, or audit events (enforced by `firestore.rules`).
- **Firebase Admin SDK code never enters the browser bundle.** It runs only in `functions/` and `server/` (via `server/firebase/admin.ts`). Provider refresh tokens live in Secret Manager, never in Firestore documents visible to clients.
- The Next.js app relays user commands to **private** 2nd-gen HTTP Functions by minting a Google ID token (audience = the Cloud Run URI) and forwarding the end-user Firebase bearer token separately. Functions stay non-public while preserving user identity for server authorization.

Every sensitive command checks, in order: (1) verified Firebase identity + email state, (2) active tenant membership, (3) role-derived or explicit permission, (4) project assignment / portal relationship, (5) subscription entitlement, (6) request schema + business preconditions.

## Layer layout

The same domain (e.g. "projects", "proposals", "crew") recurs across several directories, each a different layer of the trust boundary:

- **`features/<domain>/`** — framework-neutral domain core: Zod schemas, policies, roles, and **deterministic engines** (state machines, readiness, pricing). No I/O, no Firebase. This is where transition rules like `features/projects/state-machine.ts` live and where most unit tests point.
- **`lib/<domain>/`** — browser-safe helpers and the client-side command callers (e.g. `lib/crm/command-client.ts` posts to a Functions URL, or returns a non-persisting `DEMO-…` result when the URL env var is unset). `lib/firebase/` is browser-safe Firebase init only.
- **`server/<domain>/`** — Admin SDK repositories, services, and provider adapters. `server/repositories/` extends `TenantRepository` (`base-repository.ts`), which **requires `tenantId` on every read** and rejects records whose tenant doesn't match.
- **`functions/src/<domain>/`** — the actual Cloud Functions (commands, webhooks, schedulers, OAuth callbacks). All exports are wired in `functions/src/index.ts`.
- **`components/<domain>/`** and **`app/`** — presentation and routing.
- **`config/`** — demo/seed data. **`scripts/seed.ts`** — emulator-only seeding.

When adding a domain capability, expect to touch the deterministic core in `features/`, a repository/service in `server/`, a command in `functions/`, a client caller in `lib/`, and UI in `components/`+`app/` — in that order of authority.

## Multi-tenancy invariants

- Identity is Firebase Auth. A user may hold memberships in multiple tenants. The **membership document ID is `${tenantId}_${userId}`** — deliberate denormalization so Firestore rules resolve one deterministic doc without a query. The membership doc holds role, explicit permissions, status, and permitted project IDs.
- Collections are **top-level with a mandatory `tenantId`** (not deeply nested). Every tenant document carries `tenantId`; every project document also carries `projectId`. Every repository query includes `tenantId`, and composite indexes in `firestore.indexes.json` start with `tenantId`.
- **Immutable/versioned records** (package snapshots, proposal pricing/terms, contract evidence, workflow run inputs, approved schedule versions, audit events, webhook payload hashes) are never mutated; mutable root records reference the current version. Money is integer cents.

## Determinism, idempotency, and AI

- **State transitions** are deterministic and enforced server-side with optimistic concurrency. Some transitions are **evidence-controlled** — see `evidenceControlledProjectTransitions` in `features/projects/state-machine.ts` (proposal, docusign, booking_gate, readiness, delivery). The booking gate only accepts signature-verified provider events as external completion evidence.
- **Idempotency**: commands carry an idempotency key; webhooks are verified, hashed, and inserted once into `webhookEvents` under a provider-derived unique key; retries return the prior result. Automation runs are created before any side effect.
- **AI is advisory only** (`lib/ai`, `functions/src/ai`). The `AiProvider` takes a routing task + Zod output schema and rejects on schema failure. AI output **may never write** legal, payment, signature, permission, or readiness-completion fields — it produces drafts and flags discrepancies for human decision (e.g. COI extraction always leaves `humanDecision` pending). AI usage is charged against subscription entitlement before execution and audited after.

## Runtime mode switches

`lib/runtime-mode.ts` reads `NEXT_PUBLIC_AUTH_MODE` / `DATA_MODE` / `PROVIDER_MODE` (each `live` or defaulting to `mock`). Many client command callers degrade to explicit **non-persisting preview mode** when their Functions URL env var (`NEXT_PUBLIC_CRM_FUNCTIONS_URL`, `NEXT_PUBLIC_WORKFLOW_FUNCTIONS_URL`, `NEXT_PUBLIC_BILLING_FUNCTIONS_URL`, `NEXT_PUBLIC_SAAS_ADMIN_FUNCTIONS_URL`) is omitted — the UI discloses this rather than failing. Provider adapters (`server/integrations/`) have deterministic mock implementations that contact no third parties.

## Deployment note

Deployment targets Firebase App Hosting (`apphosting.yaml`). The Next.js app is also packaged through a Cloudflare-compatible runtime (`vinext` / wrangler) via the `*:sites` scripts for preview. Heavier work (PDF rendering, document extraction, safe file processing, larger AI) is designed to run in `cloud-run/`, out of the functions path.

## Working across clones (read before committing to `main`)

This project is checked out in **more than one place** on this machine, and both
checkouts push to the same remote. `main` has drifted three times
(2026-07-30, 2026-08-06, 2026-08-18); each reconcile was manual and each one
risked reverting the other clone's work.

**Rules:**

1. **Never commit directly to `main`.** Branch from `origin/main`, then open a PR:
   ```bash
   git fetch origin && git switch -c feat/<name> origin/main
   ```
2. **`git fetch` before starting anything.** Confirm you are not behind:
   ```bash
   git rev-list --left-right --count origin/main...HEAD
   ```
3. **When reconciling divergence, `origin/main` is always the base.** Replay local
   work on top of it; never fast-forward `main` over upstream. If upstream deleted
   a component you still want, keep it as its own importable module rather than
   re-mounting it during the merge — that keeps lint green without losing the work.
4. **The `functions/` build is a separate gate.** Root `npm run typecheck` excludes
   `functions/`, so a merge can typecheck cleanly and still not compile. Always run
   `cd functions && npm run build` after touching anything under `functions/`.
5. **Deploy order is functions first, then the app.** Pushing `main` triggers the
   App Hosting rollout on its own, but Cloud Functions do not deploy with it. If a
   push ships UI that calls a new function, deploy functions *first*:
   ```bash
   cd functions && npm run build
   firebase deploy --only functions --project production
   ./scripts/configure-production-function-invokers.sh studiohub-prod us-east4
   ```
   That last script is **not optional** — this org resets Cloud Run invoker IAM on
   every function revision, and any new function must also be added to the script's
   allowlist in the same change or it 403s with an HTML body (which surfaces
   client-side as `Unexpected token '<'`). See `docs/deployment.md`.

A `pre-push` hook enforces rule 1 by refusing any push that would not
fast-forward `main`. Enable it once per clone:

```bash
git config core.hooksPath .githooks
```

Bypass only for a deliberate history rewrite: `git push --no-verify`.

## Where to read more

`docs/architecture.md` is the authoritative overview. Domain-specific docs: `data-model.md`, `workflow-engine.md`, `readiness-engine.md`, `booking-gate.md`, `booking-integrations.md`, `proposals.md`, `communications.md`, `webhooks.md`, `crew-operations.md`, `post-event-operations.md`, `saas-operations.md`, `security.md`, `deployment.md`, and ADRs in `docs/adr/`.
