# StudioHub

StudioHub is a multi-tenant photography operations OS. It coordinates the complete client and event lifecycle—from inquiry and booking through readiness, event-day execution, delivery, review, and closeout.

This repository currently contains the validated Milestone 1 foundation,
Milestone 2 Core CRM, and Milestone 3 Workflow Platform:

- Next.js App Router application with strict TypeScript and responsive product shells
- Firebase Authentication client and secure Cloud Functions session architecture
- Tenant and membership models with role and permission enforcement
- Firestore and Storage security rules with tenant and project isolation
- Studio, client, crew, and platform-admin workspaces
- Typed provider-adapter contracts and a development mock provider
- Firebase Emulator configuration and representative demo seeding
- Unit, permission, state-machine, entitlement, provider, and Firestore rules tests
- public lead intake with Zod, App Check, rate limiting, duplicate detection, and audit events
- tenant-scoped contacts, clients, event types, leads, projects, and packages
- deterministic, optimistic-concurrency project transitions
- immutable package-selection snapshots with integer-cent calculations
- authenticated and idempotent CRM Cloud Function commands
- dedicated Leads, Projects, Clients, Packages, and public inquiry interfaces
- immutable workflow versions and project workflow snapshots
- deterministic relative dates, checkpoint dependencies, tasks, and evidence
- expiring owner-authorized waivers and append-only audit events
- idempotent automation runs with retry and approval state
- deterministic readiness enforced by project state transitions
- dedicated Workflows, Tasks, Readiness, Automation Runs, and Audit interfaces

Later product milestones are tracked in [docs/build-progress.md](docs/build-progress.md).

## Local setup

Requirements:

- Node.js 22.13 or newer
- Java 21 or newer for the Firebase Emulator Suite
- A Firebase development project, or the emulator-only configuration

Copy `.env.example` to `.env.local`, populate the Firebase public values, and set a unique `SEED_DEMO_PASSWORD` with at least 12 characters. Never reuse production secrets locally.

Install and run:

```bash
npm install
firebase emulators:start
npm run seed
npm run dev
```

Open `http://localhost:3000`.

The seed command is deliberately restricted to emulator mode. It creates:

- platform admin: `platform@studiohub.test`
- studio owner: `owner@studiohub.test`
- coordinator: `coordinator@studiohub.test`
- photographer: `photographer@studiohub.test`
- client: `client@studiohub.test`
- subcontractor: `crew@studiohub.test`

All seeded users use the `SEED_DEMO_PASSWORD` you supply. The seed also creates
seven projects across wedding, corporate, and sports workflows, their contacts,
a lead, three event types, a versioned package, immutable package snapshots,
a workflow template, questionnaire, schedule, COI requirement, and crew assignment.

The public inquiry is available at `http://localhost:3000/inquiry`. Its live
submission target is `NEXT_PUBLIC_CRM_FUNCTIONS_URL`. When that value is omitted,
the page clearly operates in non-persisting preview mode. Production submissions
require Firebase App Check.

Authenticated workflow mutations use `NEXT_PUBLIC_WORKFLOW_FUNCTIONS_URL`. When
omitted, creation forms disclose non-persisting preview behavior.

## Commands

```bash
npm run dev          # local application
npm run typecheck    # strict TypeScript
npm run lint         # ESLint
npm test             # fast unit and policy tests
npm run test:rules   # Firestore rules tests via emulator
npm run build        # production build
npm run seed         # emulator-only demo data
```

The separate Cloud Functions package lives in `functions/`:

```bash
cd functions
npm install
npm run build
```

## Security posture

The browser is never trusted to authorize sensitive work. Firebase identifies the user; tenant membership, role, explicit permission, and project assignment are checked at the server and rules layers. Provider refresh tokens belong in Secret Manager or an encrypted server-side store and must never be sent to the browser or saved as Firestore plaintext.

Audit records are immutable to browser clients. Destructive business deletion is modeled as an archive or controlled retention workflow.

See [docs/architecture.md](docs/architecture.md), [docs/data-model.md](docs/data-model.md),
[docs/workflow-engine.md](docs/workflow-engine.md),
[docs/readiness-engine.md](docs/readiness-engine.md),
[docs/security.md](docs/security.md), and [docs/product-spec.md](docs/product-spec.md).
