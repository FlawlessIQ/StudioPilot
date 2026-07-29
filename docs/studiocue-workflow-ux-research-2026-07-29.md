# StudioCue workflow research and UX direction

Date: July 29, 2026
Source: 15:30 recorded workflow interview with a working wedding photographer

## Executive finding

The photographer does not think in software modules. He thinks in one job moving
from inquiry to gallery. The current product contains most of the right domain
capabilities, but the experience still exposes the underlying data model:
inquiries, proposals, contracts, invoices, questionnaires, insurance, schedules,
crew, readiness, post-production, delivery, reviews, documents, workflows, and
tasks are presented as separate destinations.

The redesign should make the project lifecycle the primary information
architecture and treat the individual capabilities as contextual project steps.
AI should appear at the handoffs where the photographer currently copies,
retypes, calculates, converts, or chases—not only in a separate chat screen.

## Observed current workflow

| Stage | Current behavior | Friction observed | StudioCue opportunity |
| --- | --- | --- | --- |
| Inquiry | Website contact notification arrives by email. A saved wedding reply is copied, edited, and sent manually. | Repeated copy/paste, inconsistent edits, inbox is the system of record. | Capture the inquiry, extract facts, draft the acknowledgement in the studio voice, and offer consultation times. |
| Consultation | Client completes a second wedding information form, then receives available dates and books a Zoom or in-person meeting. | Client data is split across email and web forms. | One smart intake that progressively asks only for missing information and creates the project record. |
| Proposal | After the meeting, photo and video packages are assembled from existing lists and sent the following day. | Packages are manually selected and rebuilt from static content. | Generate a proposal draft from consultation notes plus approved package templates. |
| Contract | A Microsoft Word contract is manually populated from the intake and package selection, converted to PDF, then prepared in Dropbox Sign. Signature and date fields are dragged into place every time. | High-risk retyping and document assembly; signer setup is repeated. | Import the existing contract once, map variables and signer roles with AI, then generate a reviewable agreement from verified records. |
| Retainer | QuickBooks invoice is created from scratch with a per-crew-member retainer plus photo/video package lines. | Manual customer matching, arithmetic, and duplicate line entry. | Create the customer and draft invoice from the accepted proposal; retain QuickBooks as payment authority. |
| Planning | A long wedding schedule form collects contacts, family names, locations, ceremony details, timeline facts, and special requests. | The form was difficult to locate during the interview; answers are later re-entered into another document. | Keep the questionnaire inside the project, show completion, extract facts, flag gaps, and feed approved facts into schedule generation. |
| Schedule | A run of show is manually calculated by counting back from ceremony time and applying standard duration rules. | Repeated date/time math and document formatting. | Generate a draft from the photographer’s reusable timing rules and verified questionnaire answers; require human approval before publish. |
| Insurance | Photographer emails a COI request, receives the certificate, and manually forwards it to the venue. | Three-party email chase with no shared status. | Request, extract, compare, approve, and deliver the COI from the project with a visible audit trail. |
| Final confirmation | About one month before the wedding, the schedule is re-sent for confirmation and a final QuickBooks invoice is manually created for package + tax − retainer. | Repeated calculation and manual follow-up. | Date-relative automation creates a review task, confirms changes, and drafts the final invoice from authoritative balances. |
| Event reminder | A personal “excited for tomorrow” email includes a specific reminder such as putting the dress on a hanger. | Easy-to-forget, high-value touchpoint. | A warm studio-voice template with project-specific reminders, queued for approval or automatic delivery. |
| Gallery and album | Images are uploaded to a gallery provider. Client receives an instructional email/video, hearts album selections, and the photographer designs the album manually. | Delivery information and selection status can be lost in email. Album design itself should stay human. | Store gallery and video links in the client portal, guide selections, and automate reminders without automating creative album design. |
| Reviews | Review links for Google, WeddingWire, and The Knot are sent after delivery. | Most requests are ignored and destinations change in importance. | Ask once in the portal at the right moment, prioritize the studio’s preferred destination, and schedule one considerate follow-up. |
| Crew | Crew members are contacted in ranked order. If one declines or does not respond, the next is contacted. Staffing can take hours or a full day. | Serial outreach, manual prioritization, manual calendar setup. | Ranked offer cascade with expiry, conflict checks, accept/decline, automatic next-person offer, calendar event, and current schedule link. |

## Quantified pain

- The photographer estimated five to six hours of client communication and
  administration per wedding.
- Staffing an event can take one to three hours and sometimes most of a day.
- At least seven separate external surfaces appeared in the walkthrough:
  website/forms, email, Word, PDF, Dropbox Sign, QuickBooks, and gallery
  delivery.
- The most error-prone moments are all transfers between systems: copying client
  facts, rebuilding package lines, placing signature fields, calculating
  invoices, translating questionnaire answers into a run of show, and relaying
  insurance.

## Current StudioCue comparison

StudioCue already models the correct broad lifecycle:

1. Inquiry
2. Booking
3. Planning
4. Event
5. Delivery

It also already has valuable provider and safety boundaries: proposal snapshots,
signature evidence, QuickBooks invoice references, questionnaire review,
schedule approval, COI review, crew acknowledgement, delivery records, and
review requests.

The usability gap is presentation and orchestration:

- The shell previously promoted feature destinations over the five-stage
  lifecycle.
- The dashboard emphasized metrics rather than the next piece of work.
- AI was primarily represented by “Ask Copilot,” which makes the user formulate
  a question instead of having AI appear where repetitive work starts.
- Workflow creation still asks a user to manually describe and select the
  workflow even when their existing documents already contain that knowledge.
- Project context exists, but related records still feel like separate apps.
- Technical language such as provider evidence, gates, deterministic state, and
  record types is useful for implementation and auditability but should usually
  sit behind plain-language task copy.

## Target experience

### 1. The project is the workspace

Every project has one visual journey:

`Inquiry → Booking → Planning → Event → Delivery`

Opening a project should show:

- what is complete;
- what StudioCue is doing;
- what needs the studio;
- what needs the client, venue, or crew;
- the next safe action.

Contracts, invoices, questionnaires, schedules, insurance, delivery, and
reviews remain real records, but users reach them through the project rather
than navigating the database structure.

### 2. AI is a capability, not a destination

Use AI for:

- importing existing studio materials;
- extracting and normalizing facts;
- generating drafts from verified facts and approved studio templates;
- spotting missing or contradictory information;
- suggesting the next action;
- summarizing changes;
- routing routine follow-up.

Do not let AI silently decide:

- legal terms;
- final prices or tax;
- payment or signature completion;
- insurance approval;
- crew acceptance;
- schedule publication;
- readiness or project completion.

### 3. “Import my studio” is the first AI win

The owner should be able to upload or paste:

- inquiry and follow-up emails;
- package sheets and proposals;
- contracts;
- questionnaires;
- schedules and run-of-show documents;
- shot lists;
- delivery instructions;
- review requests.

StudioCue should identify reusable assets, map variables, propose workflow
triggers, and create drafts in a review queue. Nothing becomes active until the
owner approves it.

### 4. Automation is visible and reversible

Each automated step should say:

- what triggered it;
- what it used;
- what it created or sent;
- whether approval is required;
- how to stop, edit, or retry it.

## Implemented UX slice

This pass implements:

- a shorter seven-destination navigation built around work rather than domain
  tables;
- a persistent “AI studio” entry point;
- a vibrant, compact dashboard command center;
- a five-stage project lifecycle rail;
- an AI recommendation queue grounded in the recorded workflow;
- an interactive template import studio for files, pasted email, or a public
  page;
- an approval-first import plan that maps source material to StudioCue draft
  assets;
- responsive behavior for desktop, tablet, and mobile;
- a warmer plum, coral, violet, gold, blue, and mint visual system.

The template import interaction in this slice is the product surface and review
flow. Production extraction, persistence, and activation should use the
existing authenticated job infrastructure and Vertex AI boundary, with uploaded
files passing file-safety checks before model access.

## Recommended delivery order

The complete product, AI, sequencing, dependency, measurement, and release plan
is maintained in
[`studiocue-product-ai-roadmap-2026-07-29.md`](./studiocue-product-ai-roadmap-2026-07-29.md).

1. Connect the import studio to a secure file upload, extraction job, and draft
   template persistence.
2. Make the project detail page the complete lifecycle workspace and move
   secondary domain indexes into contextual views.
3. Add ranked crew offer cascades with response expiry and calendar creation.
4. Turn questionnaire answers plus owner timing rules into schedule drafts.
5. Add client-portal gallery, album-selection, and review milestones.
6. Add automation receipts and a plain-language activity history to every
  project.
