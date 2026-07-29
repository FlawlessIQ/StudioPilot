# StudioCue roadmap capability inventory

Date: July 29, 2026  
Purpose: Pass 1 implementation baseline for the
[`product and AI roadmap`](./studiocue-product-ai-roadmap-2026-07-29.md)

Status definitions:

- **Foundation exists:** the trusted model or provider boundary is implemented,
  but the roadmap outcome may still need lifecycle UX and automation.
- **Partial:** some product or technical behavior exists, but it does not yet
  satisfy the roadmap acceptance criteria.
- **Missing:** no dependable end-to-end implementation was found.

## Import and studio memory

| ID | Baseline | Evidence and next build |
| --- | --- | --- |
| MIG-01 | Partial | Import UI existed; Pass 1 adds shared file policy, item/session contracts, authorization, audit, and validation. Secure storage, quarantine, signature check, and malware processing are next. |
| MIG-02 | Missing | Filename heuristics exist only in the UI. Build asynchronous classification and structured extraction. |
| MIG-03 | Missing | Versioned email templates and Docusign concepts exist, but no general imported variable/signer mapping. |
| MIG-04 | Missing | Workflow schemas and simulation foundations exist; no AI inference from uploaded studio material. |
| MIG-05 | Partial | Immutable template patterns exist. Pass 1 adds studio asset/version contracts; review, activation, and rollback commands remain. |
| MIG-06 | Missing | Build coverage scoring after activated asset records exist. |

## Project operating experience

| ID | Baseline | Evidence and next build |
| --- | --- | --- |
| CORE-01 | Partial | Lifecycle states and redesigned dashboard exist; project detail still needs the complete aggregated cockpit. |
| CORE-02 | Partial | Dashboard recommendations and Copilot exist; no persistent, cited AI action queue. Pass 1 adds its contract. |
| CORE-03 | Partial | Audit and automation records exist; plain-language receipts, cancel, and safe retry are not projected in the project. |
| CORE-04 | Missing | No permission-filtered universal project search and command surface. |
| CORE-05 | Partial | Responsive routes and daily priorities exist; no unified mobile lifecycle agenda. |

## Inquiry and consultation

| ID | Baseline | Evidence and next build |
| --- | --- | --- |
| INQ-01 | Partial | Lead intake and AI-supported qualification foundations exist; fact provenance and dependable deduplication need completion. |
| INQ-02 | Partial | Branded inquiry acknowledgement exists; imported studio voice and embedded approval are missing. |
| INQ-03 | Partial | Conditional forms exist; progressive intake across inquiry and project provenance is incomplete. |
| INQ-04 | Foundation exists | Calendar, Zoom, public consultation, conflicts, and booking contracts exist; the lifecycle handoff needs consolidation. |
| INQ-05 | Partial | Copilot summaries exist; consent-based consultation note/transcript workflow is missing. |

## Proposal, contract, invoice, and booking

| ID | Baseline | Evidence and next build |
| --- | --- | --- |
| BOOK-01 | Missing | Packages and snapshots exist; no grounded consultation-to-package recommendation. |
| BOOK-02 | Partial | Proposal composer, PDF, approval, delivery, and acceptance exist; AI preparation from consultation facts is missing. |
| BOOK-03 | Partial | Docusign envelope and contract evidence exist; imported contract population and Dropbox Sign decision remain. |
| BOOK-04 | Partial | QuickBooks customer/invoice adapters exist; no proposal-derived, explained retainer draft in the lifecycle UX. |
| BOOK-05 | Foundation exists | Deterministic booking gate and idempotent downstream side effects exist; provider certification and cockpit orchestration remain. |

## Planning, schedule, finance, and insurance

| ID | Baseline | Evidence and next build |
| --- | --- | --- |
| PLAN-01 | Partial | Versioned conditional questionnaires exist; project-first progressive UX and imported assignment remain. |
| PLAN-02 | Partial | Questionnaire review and AI insights exist; cross-record provenance and change dependency are incomplete. |
| PLAN-03 | Missing | No owner-facing timing-rule builder seeded from prior schedules. |
| PLAN-04 | Partial | Strict AI schedule schema, conflicts, risks, questions, and human approval exist; imported rules and verified-fact orchestration remain. |
| PLAN-05 | Foundation exists | Immutable versions, impact, renewed crew acknowledgement, and publication notices exist; lifecycle UX needs consolidation. |
| PLAN-06 | Foundation exists | Safe inbound COI, extraction, discrepancy review, human decision, delivery, and archival exist; pilot/provider completion remains. |
| FIN-01 | Partial | Daily final-invoice scheduling and QuickBooks reconciliation exist; explained project preview and owner approval need completion. |
| FIN-02 | Partial | Provider diagnostics exist; no project-specific balance discrepancy assistant. |

## Crew and event day

| ID | Baseline | Evidence and next build |
| --- | --- | --- |
| CREW-01 | Partial | Profiles, availability, roles, terms, requirements, and assignments exist; explicit rank and travel recommendation data need completion. |
| CREW-02 | Missing | Invitations and acceptance exist; no sequential expiring offer cascade. |
| CREW-03 | Partial | Calendar acknowledgement and schedule links exist; automatic accepted-assignment calendar creation needs lifecycle verification. |
| CREW-04 | Missing | No explainable role, calendar, travel, and commitment recommendation engine. |
| EVENT-01 | Foundation exists | Role-scoped mobile timeline, contacts, parking, directions, call time, and acknowledgement exist. |
| EVENT-02 | Partial | PWA support and current-version acknowledgement exist; explicit offline event-brief acceptance remains. |

## Delivery, reviews, and closeout

| ID | Baseline | Evidence and next build |
| --- | --- | --- |
| DEL-01 | Partial | Project-scoped client portal exposes major records; one artifact-first delivery home and Dropbox video presentation need completion. |
| DEL-02 | Missing | Manual gallery URL exists; album selection and design milestone workflow is missing. |
| DEL-03 | Missing | Communications scheduler exists; no evidence-aware album reminder sequence. |
| DEL-04 | Partial | Review requests, clicks, reminders, and completion boundaries exist; tenant destination priority and portal-first UX remain. |
| DEL-05 | Foundation exists | Evidence-controlled closeout and archive boundaries exist; a simple closeout assistant is missing. |

## Measurement and future operations

| ID | Baseline | Evidence and next build |
| --- | --- | --- |
| OPS-01 | Partial | Reports and estimated time-saved concepts exist; Pass 1 adds verified handling-time events and calculation. |
| OPS-02 | Partial | AI quotas and usage exist; Pass 1 adds approval, edit, rejection, validation, cost, and latency contracts. Persistent analytics remain. |
| OPS-03 | Partial | At-risk projects and readiness exist; predictive workload forecast remains P2. |
| OPS-04 | Foundation exists | Wedding, corporate, and sports templates exist; expansion is deliberately deferred until wedding targets pass. |

## Pass 1 conclusion

Of 44 roadmap capabilities:

- 9 have a strong underlying foundation;
- 24 are partial;
- 11 are missing.

The immediate critical path is unchanged:

1. secure import processing;
2. imported asset review and activation;
3. persistent AI action and automation receipt records;
4. lifecycle project cockpit;
5. inquiry-to-booked vertical slice.

Pass 1 establishes the shared contracts and tests needed to begin the first item
without inventing a second parallel data model.
