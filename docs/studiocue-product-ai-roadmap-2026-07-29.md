# StudioCue product and AI roadmap

Date: July 29, 2026  
Primary evidence: 15:30 workflow interview and screen-share with a working
wedding photographer  
Related research:
[`studiocue-workflow-ux-research-2026-07-29.md`](./studiocue-workflow-ux-research-2026-07-29.md)

## Executive decision

StudioCue should become the operating system that moves one photography job from
inquiry to gallery. It should not feel like a collection of CRM modules with an
AI chat box attached.

The most important product outcome is:

> A photographer imports how the studio already works, then StudioCue prepares,
> coordinates, and follows up on the job while the photographer approves the
> important decisions.

The interview establishes two measurable starting points:

- five to six hours of communication and administration per wedding;
- one to three hours, and sometimes most of a day, to staff an event.

The roadmap should therefore prioritize time removed from those two workflows
before broadening the product.

The first three product bets are:

1. **Import my studio:** upload existing emails, packages, contracts,
   questionnaires, schedules, and instructions; AI turns them into reviewable
   StudioCue assets and workflows.
2. **One project workspace:** the user sees the entire job, its blockers, and
   the next action in one lifecycle—not separate feature modules.
3. **Embedded autopilot:** AI prepares work at each handoff using verified
   project facts and approved studio content. The user should not need to start
   with a blank prompt.

## What the interview says the product must solve

| Observed behavior | Product requirement | AI role | Deterministic authority |
| --- | --- | --- | --- |
| Copy and edit a saved inquiry email | Capture the inquiry, recognize intent, and prepare the correct branded reply | Extract facts, classify inquiry, draft in studio voice, identify missing facts | Contact consent, availability, delivery status |
| Send a second web form and manually offer dates | Progressive intake and self-scheduling using data already supplied | Ask only for missing information and suggest consultation questions | Calendar availability and booking |
| Build photo/video proposal from lists | Package-aware proposal composer grounded in the consultation | Summarize needs and recommend compatible approved packages | Price, tax, package version, proposal approval |
| Populate a Word contract, create a PDF, add signers, and drag signature fields | Reusable contract template with mapped variables and signer roles | Import the old contract, detect variables, roles, and signature anchors | Legal text, approved template version, signature evidence |
| Rebuild a retainer invoice in QuickBooks | Draft the customer and invoice from the accepted proposal | Explain line construction and flag discrepancies | QuickBooks customer, tax, invoice, balance, and payment status |
| Hunt for the schedule form | Project-based questionnaire with obvious completion state and one client link | Select the correct template and surface unanswered or contradictory fields | Submitted response and approved changes |
| Count backward from ceremony time and reformat a run of show | Timing-rule engine plus AI-assisted schedule draft | Convert answers and studio rules into a draft; explain assumptions and conflicts | Approved schedule version and publication |
| Email for a COI, receive it, and forward it to the venue | Visible request, receipt, review, and venue-delivery workflow | Extract certificate facts and flag discrepancies | Human insurance decision and delivery evidence |
| Recalculate the final balance a month before the wedding | Date-relative final invoice workflow | Explain expected balance and identify mismatches | Proposal snapshot, tax, retainer evidence, QuickBooks balance |
| Remember a personal night-before email | Project-aware communication automation | Draft a warm message with relevant reminders | Approved template, send time, delivery evidence |
| Email gallery instructions and chase album selections | Client delivery hub with status and reminders | Personalize instructions, summarize remaining steps, time considerate reminders | Gallery link, client confirmation, album approval |
| Ask for reviews across several sites | Configurable review sequence based on studio preference | Choose copy and timing from engagement context | Approved destinations and recorded engagement |
| Contact crew sequentially in ranked order | Ranked offer cascade with expiry, conflicts, and automatic progression | Recommend eligible crew and explain the ranking | Availability, acceptance, compensation, assignment, calendar event |
| Clients lose artifacts in email | Persistent client project hub | Summarize what is new and what needs attention | Signed contract, schedule, COI, payment, gallery, video links |

## Product definition of “done”

A backend model, route, or integration contract is not a completed capability by
itself. A roadmap item is done only when:

1. the user encounters it at the correct moment in the project lifecycle;
2. existing project information is prefilled and never requested twice without
   a reason;
3. StudioCue prepares the next piece of work automatically;
4. the user can understand the source, confidence, and consequence;
5. approval is required for legal, financial, insurance, publication, and
   staffing commitments;
6. the action creates reliable provider and audit evidence;
7. the client or crew member can complete their part without staff explanation;
8. the time saved and correction rate can be measured.

## Product principles

### One job, one workspace

The primary object is the project journey:

`Inquiry → Booking → Planning → Event → Delivery`

Contracts, invoices, questionnaires, schedules, insurance, crew, gallery links,
and reviews are contextual parts of that journey. Collection-wide indexes remain
available as operational views, but should not be the normal way to move a job
forward.

### AI prepares; trusted systems decide

AI may:

- classify;
- extract;
- normalize;
- summarize;
- draft;
- compare;
- identify missing information;
- identify contradictions and risk;
- recommend;
- explain;
- propose workflow rules.

AI may not independently declare:

- a contract signed;
- an invoice correct or paid;
- a tax amount authoritative;
- a COI sufficient;
- a crew member booked;
- a schedule published;
- a project ready or complete;
- a communication sent when approval is required.

### No blank-page automation

The default AI interaction is a prepared recommendation with context, not an
empty chat box. “Ask StudioCue” remains useful for exploration, but it is
secondary to:

- “Review this imported contract”;
- “Approve this proposal draft”;
- “Resolve these three missing schedule facts”;
- “Start the crew offer cascade”;
- “Send the final gallery reminder.”

### Automation must be visible and reversible

Every AI or automation action must show:

- why it ran;
- the records and template versions it used;
- what it produced;
- its confidence or validation result;
- who must approve it;
- whether it contacted anyone;
- how to edit, retry, cancel, or roll back.

## Current StudioCue baseline and actual gap

StudioCue has substantial technical groundwork: lifecycle states, workflows,
provider adapters, proposal snapshots, contract evidence, invoice references,
questionnaires, schedules, COI review, crew assignments, delivery records,
communications jobs, audit events, and AI boundaries.

The interview shows that the remaining gap is not simply “add more features.”
It is a combination of migration, orchestration, proactive intelligence, and
usability.

| Capability area | Existing foundation | What is still needed for the photographer |
| --- | --- | --- |
| Lifecycle | Detailed state machine and readiness records | A simple five-stage project journey with the next action and blocker |
| Workflows | Versioned triggers, conditions, actions, jobs, and evidence | AI creation from the studio’s existing documents; plain-language simulation and activation |
| Communications | Template catalog, branded delivery, approval gates | Import the owner’s real copy, learn tone, prefill context, and put drafts in a daily approval queue |
| Proposals | Versioned packages, proposal authoring, PDF, acceptance | Consultation-to-proposal draft with package reasoning and no duplicate entry |
| Contracts | Docusign-oriented provider model | Import and map the current contract; support the owner’s preferred Dropbox Sign path or provide a deliberate migration |
| Accounting | QuickBooks adapter and invoice references | Proposal-to-retainer and final-invoice drafts with transparent line arithmetic |
| Planning | Questionnaire, schedule, COI, approval records | One guided planning experience with missing-fact detection and photographer timing rules |
| Crew | Profiles, invitations, assignments, portal | Ranked cascade, automatic next-person offer, conflict reasoning, expiry, and calendar linkage |
| Delivery | Delivery records, gallery URL, review sequence | Client-facing gallery/video/album hub and status-aware reminders |
| Copilot | Permission-aware AI surface | Embedded recommendations at handoffs, not a separate destination requiring prompts |
| Reporting | Operational and lifecycle records | Time-saved, automation acceptance, correction, and exception metrics tied to business outcomes |

## Target end-to-end experience

### 1. Set up the studio once

The owner selects **Import my studio** and uploads or pastes:

- inquiry and follow-up emails;
- consultation questions;
- photo and video package sheets;
- proposals;
- Word, PDF, or existing e-signature contracts;
- invoice examples;
- wedding information and schedule forms;
- completed run-of-show examples;
- shot lists;
- COI request emails;
- event reminder emails;
- gallery and album instructions;
- review requests;
- crew role and preference lists.

StudioCue produces an import plan:

- reusable content it found;
- variables and signer roles;
- package and pricing candidates;
- questionnaire fields and conditions;
- timing rules inferred from schedules;
- message triggers and delays;
- crew roles and priority lists;
- conflicts, duplicates, and low-confidence items.

The owner reviews a side-by-side diff, approves each asset, runs a sample wedding
simulation, then activates the studio kit. Original files, extracted facts,
approved versions, and activation history remain available.

### 2. Inquiry and consultation

An inquiry creates or matches a contact and project. StudioCue extracts date,
venue, service type, guest count, referral source, and stated needs. It checks
known calendar conflicts and prepares a branded response that:

- acknowledges the inquiry;
- answers known questions from approved studio content;
- requests only missing facts;
- offers consultation availability;
- provides the correct booking link.

Before the consultation, the photographer sees a one-page brief: who the couple
is, what they asked for, likely packages, missing questions, conflicts, and
conversation prompts.

With explicit consent, meeting notes or a transcript can be summarized into
structured, editable project facts. Unverified statements remain visibly
unverified.

### 3. Proposal, contract, and retainer

After the consultation, StudioCue prepares:

- recommended approved package combinations;
- optional alternatives and add-ons;
- a proposal in the studio’s tone;
- a summary of assumptions or missing decisions.

The owner edits and approves. Client acceptance freezes the package and price
snapshot.

The accepted proposal fills the approved contract template. StudioCue maps
signers and signature fields that were approved during import. The owner
previews the exact legal document before sending.

StudioCue then creates a QuickBooks draft using the proposal snapshot and
approved retainer rules. The invoice preview explains every line. QuickBooks
remains the authority for tax, balance, hosted payment, and payment evidence.

When signature and retainer evidence pass, StudioCue books the project and
creates the project folders, calendar entries, portal access, workflow dates,
and client confirmation once.

### 4. Planning and schedule

The client receives a project planning experience rather than a disconnected
form. It saves progress, reuses known answers, and displays why information is
needed.

StudioCue continuously identifies:

- unanswered required questions;
- names, phone numbers, or addresses that disagree;
- insufficient travel time;
- package coverage gaps;
- missing venue or planner contacts;
- missing COI facts;
- changes that affect the schedule or crew.

The schedule generator combines:

- verified questionnaire answers;
- event and location facts;
- selected package coverage;
- crew roles;
- studio-owned timing rules;
- examples approved during import.

It returns a draft plus assumptions, missing facts, conflicts, risks, and
questions. The owner resolves issues and publishes an immutable schedule.

One month before the event, StudioCue asks the client to confirm only facts that
may have changed. Changes generate a visible impact summary rather than silently
editing the schedule.

### 5. Insurance and crew

COI requests have one project status:

`Not required / Needed / Requested / Received / Needs correction / Approved / Delivered`

StudioCue sends the approved request, routes the reply, scans the file, extracts
facts, compares them with the venue requirement, and prepares a discrepancy
summary. A permitted human approves or rejects it. Approved evidence is sent to
the venue and stored in the project and client portal where appropriate.

For staffing, the owner chooses role, terms, response window, and start time.
StudioCue recommends an ordered eligible list based on:

- owner-defined rank;
- stated availability;
- calendar conflict;
- travel feasibility;
- skill and role match;
- existing commitments;
- document readiness.

The owner starts the cascade. StudioCue offers the job to one person at a time,
waits for acceptance or expiry, then moves to the next person. Acceptance creates
the assignment and calendar event with a secure current-schedule link.

### 6. Event day

The studio and each crew member receive a compact mobile brief with only the
information relevant to them:

- current time and next scheduled item;
- call time and assigned segments;
- locations, directions, and parking;
- key contacts;
- responsibilities and shot priorities;
- latest schedule version;
- offline-safe access and acknowledgement.

Last-minute changes show an impact summary and require renewed acknowledgement
where appropriate.

### 7. Delivery, album, reviews, and closeout

The client portal becomes the persistent home for:

- signed contract;
- payment links and status;
- approved schedule;
- shared COI;
- gallery link;
- Dropbox video link;
- album-selection instructions and video;
- selection status;
- review links.

StudioCue does not attempt to design the album. It coordinates the workflow:
gallery delivered, instructions viewed, selections pending, selections received,
design sent, revision requested, approved, and fulfilled.

Reminders adapt to the current step and stop when evidence arrives. Review
requests prioritize the destinations selected by the studio and avoid repeated
low-value chasing.

## AI product architecture

Every production AI capability should follow the same pipeline:

`Trigger → trusted context → AI draft/extraction → validation → human review when required → deterministic command → receipt`

### Studio memory

StudioCue needs a tenant-scoped, versioned studio knowledge layer containing:

- approved voice and writing examples;
- business policies and frequently asked questions;
- packages, add-ons, price rules, and exclusions;
- contract template variables and signer maps;
- questionnaire templates;
- timing rules and schedule examples;
- COI request instructions;
- crew roles, skills, and ranking preferences;
- delivery and review instructions.

Only approved assets enter active studio memory. AI must cite the exact asset and
version used for a draft.

### AI action record

Every AI result should preserve:

- tenant, project, actor, and permission scope;
- capability and model version;
- prompt/instruction version;
- source record and content-version references;
- structured output;
- validation result;
- confidence and missing facts where applicable;
- user edits;
- approval, rejection, or dismissal;
- downstream command and provider evidence;
- latency, token/usage cost, and estimated time saved.

Sensitive document text should not be copied into general logs or analytics.

### Confidence behavior

- **High confidence:** prepare the action and place it in the approval queue, or
  execute only if the action is explicitly configured as safe auto-send.
- **Medium confidence:** prepare a draft and highlight the uncertain fields.
- **Low confidence:** ask a targeted question and do not create an authoritative
  record.

Confidence never overrides deterministic gates.

### Studio feedback loop

User edits should improve future drafts only through an explicit, tenant-scoped
feedback process. StudioCue should record:

- what the user changed;
- whether the change is project-specific or a reusable preference;
- whether the owner wants to update the active template or rule.

Do not silently retrain behavior from one edit.

## Prioritized capability backlog

Priority definitions:

- **P0:** required to fulfill the core “import and run my studio” promise;
- **P1:** required for a strong wedding-photographer product;
- **P2:** valuable after the core lifecycle is reliable;
- **Later:** defer until workflow and adoption data justify it.

| ID | Capability | Priority | Outcome | Primary dependency |
| --- | --- | --- | --- | --- |
| MIG-01 | Secure multi-format studio upload | P0 | Existing material enters StudioCue without retyping | Quarantine, type checks, malware scan |
| MIG-02 | Asset classification and extraction | P0 | AI identifies emails, contracts, forms, packages, schedules, and rules | Structured extraction service |
| MIG-03 | Variable and signer mapping | P0 | Imported contracts and emails become reusable templates | Template schemas and document preview |
| MIG-04 | Workflow inference and simulation | P0 | Existing material becomes reviewable triggers, actions, and delays | Workflow draft schema and sandbox runner |
| MIG-05 | Import diff, approval, activation, rollback | P0 | Migration is safe, understandable, and reversible | Versioned studio memory |
| MIG-06 | Guided migration health check | P1 | Owner can see what is imported, missing, or still generic | Asset coverage model |
| CORE-01 | Lifecycle project workspace | P0 | One job shows progress, blockers, owner, due date, and next action | Aggregated project read model |
| CORE-02 | AI recommendation and approval queue | P0 | Prepared work appears without prompting | AI action records and permissions |
| CORE-03 | Plain-language activity and automation receipts | P0 | Users trust and can reverse automation | Domain event and audit projection |
| CORE-04 | Universal project search and command bar | P1 | Users can find any client, artifact, or action quickly | Search index and permission filtering |
| CORE-05 | Mobile daily agenda | P1 | Owner and coordinator see only today’s consequential work | Daily priority projection |
| INQ-01 | Inquiry fact extraction and deduplication | P0 | No manual lead transcription | Lead ingestion and contact matching |
| INQ-02 | Studio-voice acknowledgement draft | P0 | Fast, personal response with no copy/paste | Approved message assets |
| INQ-03 | Missing-information progressive intake | P0 | Clients are not asked twice | Field provenance and form branching |
| INQ-04 | Availability-aware consultation scheduling | P0 | Fewer scheduling emails | Calendar and meeting provider |
| INQ-05 | Consultation brief and note summarization | P1 | Faster, better consultations and proposal handoff | Consent and note/transcript input |
| BOOK-01 | Consultation-to-package recommendations | P0 | Proposal begins with relevant approved choices | Package compatibility rules |
| BOOK-02 | Proposal draft and approval | P0 | Proposal ready shortly after consultation | Verified facts and package snapshots |
| BOOK-03 | Imported contract generation | P0 | No Word/PDF retyping or repeated field placement | MIG-03 and e-sign provider |
| BOOK-04 | Retainer invoice draft | P0 | No rebuilding lines in QuickBooks | Accepted proposal and tax mapping |
| BOOK-05 | Booking gate orchestration | P0 | Signed + paid creates all downstream work once | Provider evidence and idempotent jobs |
| PLAN-01 | Unified progressive questionnaire | P0 | Planning is easy to locate and complete | Project workspace and template import |
| PLAN-02 | Missing and contradictory fact detection | P0 | Errors are resolved before schedule generation | Field provenance and validation rules |
| PLAN-03 | Photographer timing-rule builder | P0 | Owner’s scheduling logic becomes reusable | MIG-02 and structured rules |
| PLAN-04 | Explainable schedule draft | P0 | Run of show is drafted from verified facts | Questionnaire, locations, packages, rules |
| PLAN-05 | Schedule change-impact workflow | P1 | Updates do not invalidate crew or clients silently | Immutable schedule versions |
| PLAN-06 | COI extraction and discrepancy review | P1 | Insurance relay becomes a visible, assisted process | Safe files, inbound routing, human decision |
| FIN-01 | Final invoice preview and scheduling | P0 | Package + tax − retainer is prepared accurately | QuickBooks reconciliation and proposal snapshot |
| FIN-02 | Balance discrepancy assistant | P1 | Staff see why StudioCue and QuickBooks differ | Reconciliation evidence |
| CREW-01 | Skills, role, rank, and availability profiles | P0 | Eligible crew can be ordered intentionally | Crew data quality |
| CREW-02 | Ranked crew offer cascade | P0 | Staffing falls from hours to minutes of owner work | Invitations, expiry, job scheduler |
| CREW-03 | Calendar event and live schedule link | P0 | Accepted crew have current job information | Google Calendar and portal access |
| CREW-04 | Crew conflict and travel reasoning | P1 | Bad recommendations are caught before offers | Locations, calendar, prior assignments |
| EVENT-01 | Mobile role-scoped event brief | P1 | Crew can operate without searching emails | Published schedule and contact permissions |
| EVENT-02 | Offline-safe schedule and acknowledgements | P1 | Event-day access survives poor connectivity | PWA cache and immutable version |
| DEL-01 | Client artifact and delivery hub | P0 | Contract, schedule, COI, gallery, and video never get lost | Project-scoped portal read model |
| DEL-02 | Gallery and album status workflow | P1 | Selection follow-up is visible and automated | Gallery link and client confirmations |
| DEL-03 | Context-aware album reminders | P1 | Fewer manual chases without automating creative work | DEL-02 and communications |
| DEL-04 | Configurable review sequence | P1 | Review asks focus on valuable destinations | Tenant review settings |
| DEL-05 | Deterministic closeout assistant | P1 | Nothing is forgotten at the end of the job | Delivery, balance, crew, review evidence |
| OPS-01 | Admin-time saved analytics | P0 | Product value is measurable per job | AI/automation action records |
| OPS-02 | Automation acceptance and correction analytics | P0 | Low-quality automation can be found and improved | AI edit and decision logging |
| OPS-03 | Cross-project risk and workload forecast | P2 | Studio sees bottlenecks before deadlines slip | Complete lifecycle data |
| OPS-04 | Vertical starter kits | Later | Corporate, sports, school, and vendor workflows reuse the system | Wedding workflow maturity |

## Delivery roadmap

The ranges below assume a focused product team with design, full-stack,
AI/platform, and QA capacity. They are sequencing estimates, not commitments.
Several streams can overlap after the shared foundations are stable.

### Release 0 — Baseline and product instrumentation

Indicative duration: 1–2 weeks  
Objective: establish honest measures and prevent the roadmap from shipping
unmeasured feature surface.

Deliver:

- define a canonical workflow event taxonomy for the five lifecycle stages;
- instrument admin minutes, handoffs, corrections, sends, approvals, and provider
  outcomes;
- add explicit AI draft accepted, edited, rejected, and abandoned events;
- measure the current inquiry-to-reply, consultation-to-proposal, booking,
  planning, staffing, delivery, and closeout cycle times;
- recruit three to five wedding studios for workflow and migration design
  partnership;
- establish a redacted evaluation set from representative templates and
  schedules.

Exit criteria:

- baseline metrics are visible for pilot studios;
- an AI evaluation set covers every P0 extraction and drafting capability;
- design partners approve the target lifecycle and terminology.

### Release 1 — Import my studio

Indicative duration: 4–6 weeks  
Objective: eliminate manual setup and make StudioCue reflect the owner’s current
business before asking them to build anything.

Deliver:

- secure PDF, DOCX, TXT, CSV, email-text, and webpage ingestion;
- automatic asset classification;
- package, message, questionnaire, contract, and schedule extraction;
- variable, signer, timing-rule, trigger, reminder, and audience suggestions;
- side-by-side source and StudioCue draft review;
- confidence, validation, duplicate, and conflict display;
- sample-wedding workflow simulation;
- per-asset approval, activation, versioning, and rollback;
- import coverage dashboard.

Exit criteria:

- a design partner can upload the materials shown in the interview and produce
  a usable draft studio kit without manually recreating each template;
- no imported asset becomes active without approval;
- every generated field is traceable to a source or marked as a suggestion;
- at least 80% of common template structure is correctly proposed before owner
  edits on the evaluation set.

### Release 2 — One project workspace and daily AI queue

Indicative duration: 4–6 weeks; may overlap the latter half of Release 1  
Objective: make the project—not the module list—the operating surface.

Deliver:

- five-stage project header and lifecycle timeline;
- “StudioCue is doing / Studio needs / Client needs / Crew needs” sections;
- next action, blocker, owner, due date, and readiness impact on every item;
- contextual tabs for booking, planning, event, and delivery artifacts;
- AI recommendation queue with approve, edit, dismiss, and explain actions;
- plain-language automation receipts and retry/cancel controls;
- universal project search and command creation;
- compact mobile daily agenda.

Exit criteria:

- a user can move a pilot project from inquiry through delivery without using a
  collection index as the primary workflow;
- the next action is identifiable within five seconds in usability testing;
- users can explain why an automation ran and whether it contacted someone.

### Release 3 — Inquiry and booking autopilot

Indicative duration: 5–7 weeks  
Objective: reduce the inquiry-to-booked administrative path from repeated
copy/paste to an approval-led flow.

Deliver:

- inquiry ingestion, deduplication, and verified fact extraction;
- studio-voice acknowledgement and missing-information prompts;
- self-scheduling with calendar conflict awareness;
- consultation brief and optional consent-based note summarization;
- approved-package recommendations and proposal draft;
- imported contract population and signature placement;
- Dropbox Sign support or an explicit Docusign migration path based on pilot
  provider demand;
- QuickBooks retainer draft with line-by-line explanation;
- one-time booking orchestration after signature and payment evidence.

Exit criteria:

- median inquiry acknowledgement draft is ready in under one minute;
- median owner handling time from completed consultation to approved proposal is
  under 30 minutes;
- no price, tax, contract, signature, or payment state is created solely from AI
  output;
- booking side effects remain idempotent under retries and duplicate webhooks.

### Release 4 — Planning and schedule intelligence

Indicative duration: 6–8 weeks  
Objective: transform questionnaire answers into a trustworthy, reviewable event
plan.

Deliver:

- progressive questionnaire with prefilled facts and one clear client link;
- field provenance, missing-information, and contradiction review;
- owner-editable timing-rule builder seeded from imported schedules;
- schedule draft with assumptions, conflicts, risks, questions, travel, and
  coverage validation;
- client confirmation one month before the event;
- schedule change-impact summary and versioned publication;
- final-invoice draft and reconciliation view;
- COI request, safe receipt, extraction, discrepancy review, approval, venue
  delivery, and portal visibility.

Exit criteria:

- a representative wedding schedule is drafted from the interview inputs and
  approved timing rules without copying answers into a second document;
- every inferred item can be traced to a rule, project fact, or clearly labeled
  assumption;
- client and crew never satisfy readiness with an obsolete schedule;
- insurance and invoice authority remains human/provider-controlled.

### Release 5 — Crew cascade and event-day operations

Indicative duration: 4–6 weeks  
Objective: reduce staffing coordination from hours to one short approval and
exception process.

Deliver:

- role, skill, preference rank, availability, travel, and document readiness
  profile;
- eligible-crew recommendation with explanations;
- sequential offer cascade with expiry and automatic next-person progression;
- accept, decline, counter/contact-studio, and stop-cascade controls;
- assignment and calendar creation after authoritative acceptance;
- live schedule link and renewed acknowledgements;
- role-scoped, offline-safe mobile event brief;
- escalation when a role remains unfilled.

Exit criteria:

- median owner handling time for a normally staffed event is under 15 minutes;
- one accepted person prevents all later offers for the same role;
- compensation and client-private information respect crew permissions;
- schedule changes reliably request renewed acknowledgement.

### Release 6 — Delivery, album, review, and client memory

Indicative duration: 4–5 weeks  
Objective: make the portal the persistent client home and automate coordination
without automating creative album design.

Deliver:

- signed contract, payment, schedule, COI, gallery, and video artifact hub;
- gallery delivery and instruction acknowledgement;
- album selection status, instruction video, and considerate reminders;
- design/revision/approval/fulfillment milestones;
- configurable Google, WeddingWire, The Knot, or other review destinations;
- portal-first review ask with one scheduled reminder;
- closeout assistant and archive handoff.

Exit criteria:

- clients can find every promised artifact without searching email;
- reminders stop when the corresponding evidence arrives;
- album design remains explicitly human;
- review engagement is not misrepresented as a completed review.

### Release 7 — Adaptive studio operations

Indicative duration: ongoing after Releases 1–6  
Objective: improve decisions and expand only after the core wedding workflow
proves reliable.

Deliver:

- automation quality and correction dashboards;
- project risk, workload, and deadline forecast;
- owner-approved reusable preference suggestions from repeated edits;
- cost, latency, and AI model routing controls;
- vertical starter kits for adjacent photography and event vendors;
- integration marketplace priorities driven by real pilot usage.

Exit criteria:

- new recommendations demonstrate measurable lift against the baseline;
- no cross-tenant learning or unapproved studio-memory changes;
- vertical expansion does not weaken the wedding workflow.

## Recommended first 90 days

### Days 1–30

- complete Release 0;
- connect the existing import UI to secure storage and extraction jobs;
- implement the studio asset and AI action records;
- support email, contract, questionnaire, package, and schedule classification;
- prototype the lifecycle project workspace with design partners.

### Days 31–60

- ship import review, variable mapping, activation, and rollback to pilot studios;
- ship the daily AI approval queue and automation receipts;
- begin inquiry extraction, studio-voice drafts, progressive intake, and
  consultation briefs;
- validate Dropbox Sign versus Docusign demand before committing to one signing
  experience.

### Days 61–90

- ship proposal and contract drafting for the pilot path;
- create QuickBooks retainer drafts from accepted proposal snapshots;
- run the complete inquiry-to-booked pilot;
- begin timing-rule import and questionnaire-to-schedule evaluation;
- publish the first measured time-saved report.

## Metrics

### North-star metric

**Verified owner/coordinator minutes saved per completed project.**

Time saved must be based on completed actions and measured baselines, not generic
industry estimates.

### Primary outcome targets

| Metric | Interview baseline | Initial target |
| --- | --- | --- |
| Communication/admin time per wedding | 5–6 hours | 2 hours or less |
| Owner handling time to staff a standard event | 1–3 hours, sometimes a day | Under 15 minutes |
| Inquiry to prepared response | Manual and variable | Under 1 minute |
| Consultation to approved proposal | Usually the following day | Under 30 minutes of owner work |
| Duplicate entry of client facts | Repeated across form, contract, invoice, schedule | Zero intentional re-entry |
| Client artifact retrieval | Spread across email and services | All promised artifacts in one portal |
| Schedule preparation | Manual count-back and formatting | Draft generated; owner focuses on exceptions |

### AI quality metrics

- extraction field precision and recall by asset type;
- percentage of AI drafts approved unchanged, edited, rejected, or abandoned;
- median number and severity of corrections;
- unsupported-claim and missing-citation rate;
- high-, medium-, and low-confidence calibration;
- time from AI recommendation to human decision;
- model cost and latency per completed business outcome.

### Guardrail metrics

Targets are zero for:

- AI-authorized legal changes;
- AI-authorized payment or tax state;
- AI-approved COIs;
- duplicate invoices, envelopes, assignments, or external messages;
- messages sent after cancellation or completion;
- cross-tenant context leakage;
- private client data exposed to crew or guests.

## Research and validation plan

Before general release, test with:

- solo wedding photographer;
- multi-photographer wedding studio;
- photographer who provides both photo and video;
- coordinator-heavy studio;
- studio using Dropbox Sign;
- studio using Docusign;
- at least two gallery providers;
- at least one business with formal venue COI requirements.

For each release:

1. run the workflow with the owner’s real redacted materials;
2. measure baseline versus StudioCue handling time;
3. observe without explaining the interface;
4. record every moment the user searches, retypes, questions an AI result, or
   leaves StudioCue;
5. fix P0 comprehension and trust failures before adding the next stage.

## Product and business decisions required

| Decision | Recommended default |
| --- | --- |
| Initial depth market | Wedding photographers first |
| Primary product promise | Import your studio and run each job from one workspace |
| AI posture | Proactive preparation with approval, not autonomous authority |
| Signing provider | Support the pilot’s actual Dropbox Sign workflow or make migration friction explicit; do not assume Docusign is sufficient |
| Accounting | Keep QuickBooks authoritative |
| Gallery strategy | Integrate links and workflow status first; do not replace gallery providers |
| Album strategy | Coordinate selections and reminders; keep design human |
| Portal strategy | Persistent client home for every promised artifact |
| Navigation | Seven high-level destinations with project-contextual operations |
| Success measure | Verified administrative time removed per completed project |
| Expansion | Earn wedding workflow depth before broader vendor verticals |

## Explicitly out of scope for the core roadmap

- replacing QuickBooks as accounting authority;
- replacing e-signature legal evidence with model output;
- automatically approving contracts, insurance, or payments;
- AI album design;
- AI image editing or culling;
- replacing Pixieset, Pic-Time, ShootProof, or another gallery provider in the
  first release;
- fully autonomous client communication without studio-configured approval
  rules;
- adding more navigation modules as a substitute for orchestration;
- expanding to every event business before the wedding workflow meets its time
  and adoption targets.

## Final sequencing recommendation

Do not start by adding more generic Copilot actions.

Build in this order:

1. import the owner’s real studio;
2. make the project the operating surface;
3. prepare inquiry and booking work automatically;
4. turn planning answers into a schedule;
5. automate ranked crew coordination;
6. make the portal the persistent delivery home;
7. use measured corrections and time saved to improve the system.

This order directly follows the demonstrated workflow and attacks the largest
repeated transfers of information first.
