# StudioCue roadmap release evidence

Date: July 29, 2026

This record separates implemented, automatable evidence from external
production acceptance. Missing live evidence is not represented as success.

## Implemented roadmap

| Release | Outcome | Evidence |
| --- | --- | --- |
| 0–1 | Secure template import and studio memory | quarantine, signature and malware gates; classification/extraction; citations/confidence; review; activation; immutable versions; rollback; redacted evaluation suite |
| 2 | Project lifecycle cockpit | five-stage project view, next action/blocker ownership, AI approval queue, receipts, role-aware search, mobile agenda |
| 3 | Inquiry and booking autopilot | inquiry reply drafts, consultation analysis, grounded package recommendation, approved proposal draft, no automatic delivery |
| 4 | Planning intelligence | sourced questionnaire prefill, provenance/change tracking, approved timing rules, explainable schedule drafts, QuickBooks reconciliation, COI lifecycle |
| 5 | Crew cascade | explainable eligibility/ranking, one active offer, expiry/decline advancement, conflict protection, role-scoped schedule, offline sanitized brief |
| 6 | Client delivery hub | persistent artifact hub, gallery, album, considerate review workflow, deterministic closeout, archive handoff |
| 7 | Pilot hardening | measured-value dashboard, AI outcomes and violations, reliability/retry/cancel evidence, provider health, incidents, evaluation thresholds, privacy hardening, clean-account pilot |
| 8 | Photographer workflow acceptance | project-aware schedule prefill, focused questionnaire review, rule-safe crew workspace, schedule/rate-driven crew handoff, remembered delivery defaults, date-relative wedding messages, and native activation of approved imported messages/delivery instructions |

Every roadmap feature flag is enabled in the registry. Provider, accounting,
signature, insurance, and creative authority remain deterministic and human- or
provider-owned.

## Automated release gates

The final verification command set is:

```text
npm test
npm run test:rules
npm run test:storage-rules
npm run typecheck
npm run lint
npm run build
npm run build:sites
npm run test:e2e
cd functions && npm run build
```

The suite covers:

- tenant isolation, role scope, assigned-project access, and server-only writes;
- import classification, citations, low-confidence blocking, unsupported
  authority claims, activation and rollback;
- AI approval/execution boundaries and correction outcomes;
- idempotent commands, duplicate webhooks, retries, cancellation, provider
  normalization, and dead-letter objectives;
- questionnaire provenance, schedule source trace/change impact, invoice and
  COI provider evidence;
- crew conflicts, decline/expiry sequencing, acceptance, and completion;
- delivery gates, review release, album reminder stops, closeout, and archive;
- clean-account lifecycle, responsive authenticated surfaces, and mobile views.

Record final command results and deployed revision in `docs/build-progress.md`
after the complete release validation.

## Live pilot evidence still required

The application exposes these as amber launch gates until real records exist:

- observed or timestamped baseline handling time for representative weddings;
- AI acceptance/edit/reject data from actual reviewed drafts;
- completed crew cascades demonstrating a median under 15 minutes;
- real provider sandbox/live job health and reconciliation;
- no open S1/S2 incident records;
- owner, coordinator, client, and subcontractor usability sign-off.

These checks require real people, provider accounts, or business/legal judgment
and are listed in `docs/manual-launch-checklist.md`. They do not authorize
StudioCue to invent evidence or weaken deterministic gates.
