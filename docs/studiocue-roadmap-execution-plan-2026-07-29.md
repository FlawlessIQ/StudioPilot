# StudioCue roadmap execution plan

Date: July 29, 2026  
Source roadmap:
[`studiocue-product-ai-roadmap-2026-07-29.md`](./studiocue-product-ai-roadmap-2026-07-29.md)

## Executive plan

Execute the roadmap as a 26-week, outcome-gated program for a focused 4–6 person
product team.

The program has six customer-facing outcomes:

1. a photographer can import the studio instead of recreating it;
2. each project can be operated from one lifecycle workspace;
3. inquiry through booking becomes an approval-led workflow;
4. planning answers become an explainable run of show;
5. crew staffing becomes a short exception process instead of hours of outreach;
6. clients can always find their contract, schedule, COI, gallery, video, album,
   and review steps.

The sequence is:

`Foundation → Import → Project cockpit → Booking → Planning → Crew → Delivery → Pilot hardening`

Work may overlap, but releases may not skip their evidence gates.

## Planning assumptions

### Recommended team

| Role | Allocation | Primary responsibility |
| --- | --- | --- |
| Product lead / founder | 1.0 | Scope, decisions, pilot relationships, acceptance |
| Product designer / researcher | 1.0 | Journey, prototypes, usability, content, design system |
| Full-stack product engineer | 1.0–2.0 | Studio, client, and crew experiences; application APIs |
| Platform / integration engineer | 1.0 | Workflow commands, providers, jobs, evidence, reliability |
| AI / data engineer | 1.0 | Extraction, studio memory, evaluations, model routing |
| QA / security | 0.5–1.0 | Test strategy, release evidence, privacy, adversarial cases |

The product lead may also be the designer or an engineer in a smaller team.
Ownership must still be explicit even when one person holds multiple roles.

### Schedule by team size

| Team shape | Expected sequence |
| --- | --- |
| 4–6 focused contributors | 26 weeks with controlled overlap |
| 2–3 contributors | 36–44 weeks; run AI/import, product, and platform work mostly sequentially |
| Solo builder | 50+ weeks; ship only the P0 wedding path and one provider per category |

These are planning ranges, not fixed delivery promises. Pilot evidence determines
whether a release advances.

### Scope rule

During the 26-week program:

- wedding photographers are the depth market;
- QuickBooks remains the accounting authority;
- one e-signature path is certified first;
- gallery coordination is built before gallery-provider replacement;
- album design remains human;
- P2 analytics and new vertical kits do not interrupt P0 workflow delivery.

## Program workstreams

### Workstream A — Product experience

Owns:

- lifecycle project cockpit;
- AI approval queue;
- studio import review;
- studio, client, and crew journeys;
- mobile event-day view;
- design system and usability.

Lead: product designer + full-stack product engineer.

### Workstream B — AI and studio memory

Owns:

- asset classification and extraction;
- versioned studio memory;
- variable, signer, workflow, and timing-rule suggestions;
- inquiry, proposal, schedule, and message drafting;
- evaluations, confidence, citations, and feedback.

Lead: AI/data engineer.

### Workstream C — Lifecycle and integrations

Owns:

- deterministic commands and gates;
- workflow execution;
- QuickBooks, calendar, e-signature, email, storage, and meeting providers;
- idempotency, webhooks, reconciliation, and automation receipts.

Lead: platform/integration engineer.

### Workstream D — Data, trust, and operations

Owns:

- event taxonomy and time-saved measurement;
- field provenance and AI action records;
- file safety, authorization, privacy, and audit;
- feature flags, observability, failure recovery, and release evidence.

Lead: platform engineer + QA/security.

### Workstream E — Pilot and adoption

Owns:

- design-partner recruitment;
- template collection and redaction;
- baseline measurement;
- weekly workflow observation;
- onboarding, support, and acceptance evidence.

Lead: product lead.

## Critical dependency chain

The critical path is:

1. event taxonomy, pilot cohort, and AI evaluation fixtures;
2. secure asset ingestion and versioned studio memory;
3. import review, approval, and activation;
4. project lifecycle read model and AI action record;
5. inquiry-to-booking vertical slice;
6. questionnaire provenance and timing rules;
7. schedule generation and change impact;
8. crew recommendation and offer cascade;
9. client delivery hub and closeout;
10. full clean-account pilot and hardening.

The following work must not begin before its dependency is usable:

| Capability | Required dependency |
| --- | --- |
| AI communication drafts | Approved studio voice and message assets |
| Contract generation | Approved imported contract, variable map, signer map |
| Invoice drafts | Accepted immutable proposal and configured tax/product mapping |
| Schedule draft | Verified questionnaire facts and approved timing rules |
| Crew calendar event | Authoritative assignment acceptance |
| Event-day brief | Published current schedule and role-scoped permissions |
| Album reminders | Gallery delivery and album workflow state |
| Time-saved reporting | Consistent action, baseline, correction, and completion events |

## Architecture deliverables

Reuse existing StudioCue records and infrastructure where possible. Add or
extend the following concepts only after a schema review confirms they are not
already represented.

### Studio import and memory

- `studioImportSessions`
- `studioImportItems`
- `studioAssets`
- immutable `studioAssetVersions`
- active version pointers
- source-file references and processing state
- extracted facts, mappings, confidence, and citations
- activation and rollback evidence

### AI operations

- `aiActions`
- capability, model, instruction, and schema versions
- input record and studio-asset references
- structured output and validation result
- user decision and edit delta
- downstream deterministic command reference
- usage cost, latency, and estimated time saved

### Field provenance

Every reusable project fact should identify:

- value;
- source;
- source version;
- supplied or inferred actor;
- verified or unverified state;
- confidence when AI-extracted;
- last change;
- dependent records affected by a change.

### Automation receipts

Project activity should project technical events into plain language:

- trigger;
- inputs used;
- draft or action created;
- approval state;
- external recipient or provider;
- success, failure, retry, or cancellation;
- reversal or follow-up option.

## Release plan

## Release 0 — Foundation and baseline

Weeks: 1–2  
Roadmap scope: instrumentation, pilot, evaluation, decisions  
Release owner: product lead

### Build

- define canonical lifecycle and automation event names;
- instrument owner handling time and elapsed cycle time;
- implement AI accepted, edited, rejected, dismissed, and abandoned events;
- define `studioAsset`, `aiAction`, provenance, and automation-receipt contracts;
- create feature flags for every roadmap release;
- establish redacted evaluation fixtures for messages, packages, contracts,
  questionnaires, schedules, and COIs;
- inventory existing StudioCue capabilities against the new roadmap backlog;
- recruit three to five wedding-photographer design partners.

### Decide

- first e-signature provider: Dropbox Sign or Docusign;
- first gallery-provider workflow to observe;
- pilot communication approval policy;
- exact wedding lifecycle terminology;
- which pilot data may be retained for evaluations.

### Exit gate

- baseline handling time recorded for at least three representative weddings;
- evaluation set has expected structured results and named owners;
- every P0 roadmap item is mapped to an existing capability, extension, or
  net-new build;
- pilot consent, privacy, redaction, and data handling are documented;
- signing-provider decision is made.

## Release 1 — Import my studio

Weeks: 3–8  
Roadmap scope: MIG-01 through MIG-06  
Release owner: AI/data engineer

### Sprint 1 — Secure ingestion

Weeks: 3–4

- create import session and resumable upload flow;
- allowlist PDF, DOCX, TXT, CSV, and safe image inputs;
- implement quarantine, signature validation, malware scanning, size limits,
  and failure messages;
- store original file, checksum, tenant, uploader, and processing state;
- create asynchronous classification job;
- display per-file progress, failure, cancel, and retry.

Sprint acceptance:

- unsafe or unsupported files never reach model processing;
- duplicate upload is detected by checksum;
- import remains tenant-scoped and auditable;
- a failed job can be retried without duplicating assets.

### Sprint 2 — Classification and core extraction

Weeks: 5–6

- classify message, package, proposal, contract, questionnaire, schedule, crew,
  COI, delivery, and review material;
- extract message copy and variables;
- extract package names, line items, options, and exclusions;
- extract questionnaire fields, choice options, and required state;
- extract contract variables, signer roles, and signature anchors;
- extract schedule items, anchors, durations, and timing-rule candidates;
- return source citations and confidence for each proposed field;
- build redacted regression evaluations for every type.

Sprint acceptance:

- classification meets the agreed evaluation threshold;
- every proposed value has a source citation or is labeled as a suggestion;
- low-confidence content cannot be activated;
- extraction errors are visible and correctable.

### Sprint 3 — Review, activation, and simulation

Weeks: 7–8

- build side-by-side source and StudioCue draft review;
- support edit, split, merge, ignore, approve, and reject;
- suggest variables, triggers, delays, audiences, and timing rules;
- detect duplicates and conflicts with existing studio assets;
- simulate a sample wedding lifecycle without sending or creating provider work;
- activate approved immutable asset versions;
- support rollback to the prior active version;
- display import coverage and missing recommended assets.

Release exit gate:

- a pilot photographer imports the materials demonstrated in the interview;
- at least 80% of common structure is proposed correctly before edits;
- the owner produces a usable draft studio kit without recreating every item;
- no asset becomes active without explicit approval;
- rollback and source traceability pass.

## Release 2 — Project cockpit and AI work queue

Weeks: 5–10; overlaps Release 1 after contracts stabilize  
Roadmap scope: CORE-01 through CORE-05  
Release owner: product designer

### Sprint 2 parallel — Lifecycle read model

- create an aggregated project projection for stage, next action, blocker,
  owner, due date, readiness impact, and external waiting party;
- map technical statuses into plain-language project states;
- define contextual booking, planning, event, and delivery sections;
- implement permission-aware studio, client, and crew projections.

### Sprint 3 parallel — Project cockpit

- build the five-stage project header;
- display “StudioCue is doing,” “Studio needs,” “Client needs,” and “Crew needs”;
- place contract, payment, questionnaire, schedule, COI, crew, and delivery
  records inside the lifecycle context;
- add mobile next-action and blocker presentation.

### Sprint 4 — AI queue and receipts

Weeks: 9–10

- build a daily AI recommendation queue;
- support approve, edit, reject, dismiss, snooze, and explain;
- show sources, confidence, affected records, and downstream consequence;
- build plain-language automation receipts;
- add cancel, safe retry, and link-to-provider evidence where permitted;
- implement universal project search and command creation.

Release exit gate:

- five representative users identify the next action within five seconds;
- a pilot project can be operated without using collection indexes as the
  primary workflow;
- users correctly explain whether a recommendation is a draft or an action;
- all participant projections pass permission tests.

## Release 3 — Inquiry and booking autopilot

Weeks: 9–14  
Roadmap scope: INQ-01 through BOOK-05  
Release owner: full-stack product engineer

### Sprint 4 parallel — Inquiry and consultation

- ingest inquiry facts and match or create contacts safely;
- draft the studio-voice acknowledgement;
- ask only for missing information;
- offer conflict-aware consultation times;
- prepare a consultation brief with needs, risks, questions, and package
  candidates;
- support consent-based pasted notes or transcript summary.

### Sprint 5 — Proposal

Weeks: 11–12

- convert verified consultation facts into package candidates;
- explain why each candidate matches;
- generate proposal copy from approved studio assets;
- show assumptions and unresolved choices;
- preserve existing price, package, and proposal snapshots;
- require owner approval before delivery.

### Sprint 6 — Contract, retainer, and booking

Weeks: 13–14

- fill the active imported contract from verified facts and proposal snapshot;
- apply the approved signer and signature-anchor map;
- preview the exact legal artifact before sending;
- create a QuickBooks retainer draft with explained lines;
- reconcile signature and payment evidence;
- execute the idempotent booking gate once;
- create calendar, storage, portal, workflow, and confirmation side effects.

Release exit gate:

- inquiry response draft is prepared in under one minute;
- owner handling from completed consultation to approved proposal is under 30
  minutes in a representative pilot;
- the imported contract requires no repeated manual field placement;
- duplicate provider events do not duplicate the booking;
- AI cannot authoritatively change price, tax, terms, signature, or payment.

## Release 4 — Planning intelligence

Weeks: 15–20  
Roadmap scope: PLAN-01 through PLAN-06, FIN-01 and FIN-02  
Release owner: platform/integration engineer

### Sprint 7 — Questionnaire and timing rules

Weeks: 15–16

- assign the correct imported questionnaire from the project;
- prefill verified facts and preserve provenance;
- save and resume;
- ask conditional follow-ups only when relevant;
- identify missing, contradictory, and changed information;
- build the photographer timing-rule editor seeded from imported schedules.

### Sprint 8 — Schedule generation and confirmation

Weeks: 17–18

- generate a structured schedule from verified facts, package coverage, locations,
  crew roles, and approved timing rules;
- separate items, assumptions, missing facts, conflicts, risks, and questions;
- support owner corrections and rule-update suggestions;
- publish an immutable schedule;
- implement client confirmation one month before the event;
- show change impact and request renewed acknowledgements.

### Sprint 9 — Final invoice and COI

Weeks: 19–20

- prepare final invoice from proposal, tax mapping, retainer evidence, and
  QuickBooks reconciliation;
- explain discrepancies and require review;
- send project-specific COI request;
- safely receive, scan, extract, and compare the certificate;
- require a human insurance decision;
- deliver approved evidence to the venue and show status in the project.

Release exit gate:

- no questionnaire answer is copied manually into a schedule document;
- every schedule item traces to a fact, rule, or labeled assumption;
- obsolete schedules cannot satisfy client or crew acknowledgement;
- final invoice arithmetic is explainable and QuickBooks-authoritative;
- AI cannot approve insurance.

## Release 5 — Crew cascade and event-day operations

Weeks: 19–22; profile work overlaps the end of Release 4  
Roadmap scope: CREW-01 through EVENT-02  
Release owner: full-stack product engineer

### Sprint 9 parallel — Crew data quality

- normalize role, skill, rank, availability, travel area, requirements, and
  calendar signals;
- show incomplete profile data before ranking;
- create eligible-crew recommendation with explanations;
- let the owner reorder or exclude candidates.

### Sprint 10 — Offer cascade and mobile brief

Weeks: 21–22

- configure role, terms, response window, and start time;
- offer to one candidate at a time;
- accept, decline, expire, or escalate;
- stop later offers immediately after authoritative acceptance;
- create assignment and calendar event;
- include secure current-schedule link;
- build role-scoped mobile and offline-safe event brief;
- require renewed acknowledgement after schedule changes.

Release exit gate:

- normal event staffing requires under 15 minutes of owner handling;
- race, retry, expiry, and duplicate-acceptance tests pass;
- crew cannot see unrelated assignments or client financial information;
- current schedule availability and acknowledgement work offline and after
  reconnection.

## Release 6 — Delivery, album, reviews, and closeout

Weeks: 21–24; portal shell may overlap Release 5  
Roadmap scope: DEL-01 through DEL-05  
Release owner: product designer

### Sprint 10 parallel — Client artifact hub

- show signed contract, payment, approved schedule, shared COI, gallery, video,
  and album instructions in one project portal;
- display current status and next client action;
- notify the client when a new artifact becomes available.

### Sprint 11 — Album and review workflow

Weeks: 23–24

- record gallery delivered and instructions viewed;
- track selection pending, received, design sent, revision, approval, and
  fulfillment;
- send context-aware reminders that stop on evidence;
- configure review destinations and priority;
- send one portal-first review request and one considerate reminder;
- implement closeout assistant and archive handoff.

Release exit gate:

- pilot clients find every promised artifact without searching email;
- album design remains human;
- reminder cancellation and duplicate-send tests pass;
- review clicks are not represented as completed reviews;
- closeout requires all authoritative evidence.

## Release 7 — End-to-end pilot and launch decision

Weeks: 25–26  
Roadmap scope: complete wedding lifecycle  
Release owner: product lead

### Sprint 12 — Clean-account pilot

- create a new studio account and import real redacted studio materials;
- run a new inquiry through consultation and proposal;
- send and complete the contract;
- create and reconcile the retainer;
- book the project and activate the client portal;
- complete questionnaire, schedule, COI, final invoice, and crew cascade;
- publish the event brief;
- record gallery, album, review, closeout, and archive;
- verify all automation receipts, AI action records, and time-saved calculations;
- exercise retries, duplicate webhooks, expired offers, provider failures, and
  rollback.

### Launch decision

The product may enter a broader beta only if:

- no unresolved severity-one or severity-two defects remain;
- P0 lifecycle acceptance tests pass;
- permission and cross-tenant tests pass;
- pilot studios achieve a meaningful reduction from the 5–6 hour baseline;
- staffing handling is under 15 minutes for the normal case;
- no legal, financial, insurance, or staffing authority violation occurs;
- users understand the project cockpit and AI approval model without coaching;
- support and failure-recovery procedures are tested.

## Two-week sprint map

| Sprint | Weeks | Primary outcome | Secondary parallel outcome |
| --- | --- | --- | --- |
| 0 | 1–2 | Baseline, evaluation set, schemas, decisions | Pilot recruitment |
| 1 | 3–4 | Secure studio import | Project read-model design |
| 2 | 5–6 | Classification and extraction | Lifecycle projection |
| 3 | 7–8 | Import review, activation, simulation | Project cockpit |
| 4 | 9–10 | AI queue and inquiry assistance | Consultation brief |
| 5 | 11–12 | Proposal autopilot | Import beta refinements |
| 6 | 13–14 | Contract, retainer, booking | Provider reliability |
| 7 | 15–16 | Questionnaire and timing rules | Crew profile cleanup |
| 8 | 17–18 | Schedule generation and impact | Client portal hub |
| 9 | 19–20 | Final invoice and COI | Crew ranking |
| 10 | 21–22 | Crew cascade and event brief | Delivery hub |
| 11 | 23–24 | Album, reviews, closeout | Cross-lifecycle regression |
| 12 | 25–26 | Clean-account pilot and hardening | Broader-beta decision |

## First sprint: exact execution

### Before day 1

- name the product, design, engineering, AI, QA, and pilot owners;
- block the two-week sprint from unrelated roadmap work;
- identify three prospective design partners;
- prepare a secure method for receiving redacted workflow materials.

### Days 1–2 — Alignment and inventory

- review the workflow recording and product roadmap as a team;
- agree on the primary promise and P0 scope;
- map all 43 backlog items to existing, partial, or net-new capability;
- identify duplicate or obsolete existing routes;
- document the current end-to-end happy path;
- choose the initial e-signature decision deadline.

Deliverable: capability map with named technical owner.

### Days 3–4 — Metrics and event taxonomy

- define owner handling time versus elapsed time;
- define lifecycle transition and AI-decision events;
- define correction, cancellation, retry, and duplicate events;
- instrument current inquiry, proposal, staffing, and schedule journeys;
- create a baseline dashboard or query.

Deliverable: measurable current-state baseline.

### Days 5–6 — Data and safety contracts

- finalize studio asset, version, import item, AI action, provenance, and receipt
  schemas;
- complete permission and retention review;
- define allowed files, maximum sizes, and rejection behavior;
- define model input redaction and logging policy;
- define immutable and reversible boundaries.

Deliverable: approved schemas and threat model.

### Days 7–8 — Evaluation and prototype

- create redacted fixtures from representative emails, contract, questionnaire,
  package sheet, and schedule;
- define expected classification and extraction results;
- prototype upload → analysis → review → activate;
- test the prototype with one photographer without explanation;
- record terminology and trust failures.

Deliverable: evaluation set and tested workflow prototype.

### Days 9–10 — Vertical-slice planning

- break Sprint 1 secure ingestion into implementation tickets;
- define API, job, storage, and UI boundaries;
- define acceptance, error, retry, and audit tests;
- finalize Release 1 feature-flag and pilot rollout plan;
- demonstrate the Sprint 0 evidence and approve or revise Release 1 scope.

Deliverable: ready Sprint 1 backlog and Release 0 exit decision.

## Initial engineering ticket set

### Foundation

- EXEC-001: canonical lifecycle event taxonomy
- EXEC-002: AI decision and edit event schema
- EXEC-003: baseline handling-time instrumentation
- EXEC-004: roadmap capability inventory
- EXEC-005: pilot consent and redaction protocol
- EXEC-006: feature flags and release cohort model

### Import platform

- IMP-001: import-session model and authorization
- IMP-002: resumable tenant-scoped upload session
- IMP-003: checksum and duplicate detection
- IMP-004: file signature and allowlist validation
- IMP-005: quarantine and malware-scan handoff
- IMP-006: asynchronous classification job
- IMP-007: extraction result schema with citations
- IMP-008: message and variable extractor
- IMP-009: package and price-structure extractor
- IMP-010: questionnaire extractor
- IMP-011: contract variable and signer extractor
- IMP-012: schedule and timing-rule extractor
- IMP-013: import review and correction UI
- IMP-014: duplicate/conflict resolution
- IMP-015: asset version activation and rollback
- IMP-016: sample-wedding simulation
- IMP-017: extraction evaluation harness
- IMP-018: import coverage dashboard

### Project and AI operations

- CORE-101: aggregated lifecycle project projection
- CORE-102: external waiting-party and blocker derivation
- CORE-103: five-stage cockpit UI
- CORE-104: contextual project sections
- CORE-105: AI action record and command linkage
- CORE-106: AI approval queue
- CORE-107: automation receipt projection
- CORE-108: safe cancel and retry commands
- CORE-109: permission-aware project search
- CORE-110: mobile daily agenda

Each ticket must include:

- customer outcome;
- source roadmap ID;
- owner;
- dependency;
- permission and failure behavior;
- analytics events;
- automated acceptance tests;
- pilot validation step.

## Definition of ready

A ticket is ready only when:

- customer outcome and affected role are named;
- source roadmap capability is linked;
- design or interaction is available when user-facing;
- input and output schemas are agreed;
- deterministic authority is identified;
- permissions and sensitive data are identified;
- dependency and provider behavior are known;
- success, error, empty, retry, and cancellation states are specified;
- analytics and pilot evidence are specified.

## Definition of done

A capability is done only when:

- the end-to-end user journey is usable in its lifecycle context;
- duplicate entry is removed where the roadmap promises it;
- AI sources, confidence, and uncertainty are visible;
- authoritative decisions remain deterministic;
- provider actions are idempotent and reconciled;
- accessibility and responsive behavior pass;
- authorization, tenant isolation, and audit tests pass;
- failure, retry, cancellation, and rollback pass;
- evaluation thresholds pass;
- a pilot user completes the task without staff explanation;
- handling-time and correction data are recorded;
- documentation and support guidance are updated.

## Quality and evaluation strategy

### Automated layers

- unit tests for rules, schemas, confidence routing, and arithmetic;
- security-rule and authorization tests;
- provider-contract and webhook replay tests;
- AI fixture evaluations for extraction, citation, and unsupported claims;
- workflow idempotency, retry, timeout, and dead-letter tests;
- browser journey tests for studio, client, crew, and guest roles;
- responsive and accessibility checks;
- clean-account end-to-end lifecycle test.

### AI release thresholds

Set thresholds per capability rather than one global score.

Minimum gates:

- classification accuracy agreed on the representative fixture set;
- critical contract, price, date, and identity fields require field-level
  validation;
- unsupported legal, financial, or insurance claims block activation;
- source citation coverage is complete for extracted values;
- low-confidence values are never silently promoted;
- regression evaluations run on every instruction, model, or schema change.

### Pilot rollout

1. internal fixture-only environment;
2. internal dogfood with synthetic studio;
3. one design partner with redacted assets;
4. three-to-five studio closed pilot;
5. broader beta behind feature flags;
6. general release only after measured workflow and trust gates.

## Operating cadence

### Weekly

- Monday: metric review, sprint risks, dependency decisions;
- Tuesday–Thursday: build and at least one observed workflow session;
- Thursday: model/evaluation and provider-reliability review;
- Friday: integrated demo using one project, release evidence, and backlog
  adjustment.

### Every sprint

- planning against outcomes and exit gates;
- mid-sprint dependency review;
- pilot usability session;
- security and data review for new boundaries;
- complete vertical-slice demo;
- retrospective focused on handling time, correction rate, and failures.

### Monthly

- roadmap scope review;
- pilot cohort and support review;
- AI cost, latency, and quality review;
- provider health and credential review;
- go/no-go decision for the next customer lifecycle stage.

## Decision log

Use an ADR or product decision record for:

- signing provider;
- studio asset and AI action schemas;
- auto-send eligibility policy;
- model/provider selection and routing;
- retention of uploaded source files;
- client and crew offline behavior;
- gallery integration boundary;
- any change to legal, financial, insurance, or readiness authority.

No unresolved decision may remain hidden inside an implementation ticket.

## Risk register

| Risk | Signal | Mitigation | Owner |
| --- | --- | --- | --- |
| Scope expands into generic CRM work | P2 work enters a P0 sprint | P0 freeze and roadmap-ID requirement | Product lead |
| “AI” becomes another chat surface | More prompts than prepared actions | Require lifecycle trigger and prepared recommendation | Product designer |
| Imported templates are inaccurate | High correction or rejection rate | Citations, confidence, eval fixtures, approval, rollback | AI lead |
| Sensitive documents leak into logs | Contract/client text in telemetry | Structured redaction, log policy, security tests | Platform lead |
| Provider certification blocks pilot | OAuth works but real path fails | Select one provider early; certify complete path | Integration lead |
| Users do not trust automation | Recommendations dismissed or verified elsewhere | Sources, receipts, reversible actions, observed pilots | Product lead |
| Duplicate external actions | Repeated invoice, email, offer, envelope | Stable idempotency keys and replay tests | Platform lead |
| Crew race conditions | Two accept the same role | Transactional claim and immediate cascade stop | Platform lead |
| Schedule AI invents detail | Unsupported items appear | Strict schema, provenance, labeled assumptions, approval | AI lead |
| Team runs releases in parallel too early | Rework and incompatible models | Respect critical dependency chain | Engineering lead |
| Pilot does not show time savings | Handling time remains near baseline | Stop feature expansion and fix orchestration | Product lead |
| Existing modules remain the default workflow | Users keep navigating indexes | Project-first usability gate | Product designer |

## Program dashboard

Report weekly:

- release and exit-gate status;
- P0 capabilities complete, in progress, and blocked;
- pilot projects by lifecycle stage;
- owner handling time by stage;
- AI accepted, edited, rejected, and abandoned rate;
- correction severity;
- automation success, retry, cancellation, and duplicate-prevention rate;
- provider health;
- open severity-one and severity-two defects;
- current top dependency and decision;
- forecast versus the 26-week plan.

Do not report story points as the primary measure of progress.

## Resourcing fallback

If capacity falls below four focused contributors, preserve this order:

1. Release 0 foundation;
2. Release 1 import;
3. Release 2 project cockpit;
4. Release 3 inquiry-to-booked with one signing provider;
5. Release 4 questionnaire and schedule;
6. Release 5 crew cascade;
7. Release 6 delivery hub.

Reduce breadth by:

- supporting fewer input formats initially;
- certifying one provider per category;
- using one wedding workflow;
- deferring universal search, offline mode, COI AI, advanced gallery status, and
  P2 analytics.

Do not reduce:

- tenant isolation;
- approval and authority boundaries;
- idempotency;
- source citations;
- file safety;
- rollback;
- measurement;
- end-to-end pilot evidence.

## Immediate next actions

The next ten actions, in order, are:

1. name the program owners;
2. recruit the first three design partners;
3. inventory the 43 roadmap capabilities against the current codebase;
4. choose the initial signing-provider decision date;
5. establish baseline handling-time events;
6. approve the studio asset, AI action, provenance, and receipt contracts;
7. create the redacted AI evaluation set;
8. build the upload and quarantine vertical slice;
9. test the import-review prototype with one photographer;
10. hold the Release 0 exit review and start secure ingestion.

This plan deliberately makes **Import my studio** the first customer-facing
release. It is the clearest response to the stated AI gap and becomes the
foundation for every later draft, recommendation, and automation.
