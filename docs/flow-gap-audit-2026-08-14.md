# StudioCue end-to-end flow gap audit — 2026-08-14

This audit treats a feature as complete only when a user can discover the entry point, complete the action, see a durable receipt, find the resulting native record, and recover safely from interruption or duplication. A route existing in code is not sufficient evidence.

## Audit checklist and disposition

| Area | Entry → durable result → continuation | Deeper-dive result | Disposition |
| --- | --- | --- | --- |
| Authentication and workspace selection | Sign in → active membership → correct portal | Direct browser Firestore transport could time out on the custom domain and leave a valid user without a workspace. | Fixed: forced long polling, authenticated server bootstrap fallback, bounded timeouts, role-area enforcement, and retry. |
| Studio import | Upload/page/email → review decisions → native assets | Activation could create records that were absent from Packages/Questionnaires; duplicate sessions were confusing; the queue hid unresolved rows and approval controls. | Fixed: native package creation, questionnaire-template listing, idempotent activation repair, duplicate protection, bounded queue, full names/prices/counts, sticky next-decision controls, explicit activation destinations, and pending-import recovery notices. |
| Library recovery | Activated import → visible reusable assets | The Library empty state did not expose pending or completed import sessions and did not explain native destinations. | Fixed: pending-import notice and direct destination links. |
| Inquiry and lead review | Inquiry → qualified lead → consultation | Entry and lifecycle actions exist; missing information remains an explicit exception instead of being invented. | Verified in service and lifecycle tests. Clean-account provider acceptance remains a launch check. |
| Consultation and calendar | Availability → booking → Google/Zoom evidence | Availability is prominent; provider failure is surfaced as a reconnect exception. | Verified in availability and provider-routing tests. External OAuth acceptance remains provider-dependent. |
| Package and proposal | Package → proposal → client decision | Package snapshots preserve project pricing; proposal decisions are human-gated. | Verified in package snapshot and proposal workflow tests. |
| Contract, retainer, and booking | Proposal → contract + retainer → authoritative booking gate | Opening Contracts without a project explained the requirement but gave no route forward. | Fixed: direct Open projects recovery action; existing deterministic booking gate tests retained. |
| Questionnaires and planning facts | Template → assigned response → verified facts | Imported templates were stored separately but not rendered on the questionnaire screen. | Fixed: native questionnaire-template listing and pending-import handoff. |
| Schedule and readiness | Facts/rules → draft → publish → acknowledgement | Schedule generation and readiness are evidence-gated; model errors do not silently publish. | Verified in schedule/readiness tests; live model quota remains an operational dependency. |
| Crew and vendor | Profile → ranked assignment → accepted crew → schedule | Portal failures previously had no retry. | Fixed: crew workspace retry. Cascade, conflicts, and acknowledgement covered by tests. |
| Insurance | Project requirement → request → human decision → venue delivery | Project context was lost when entering Insurance, causing aggregate records and a blank project selector. | Fixed: project context, filtering, and preselected project. Legal approval remains human-only. |
| Invoices and balances | Provider reference → reconciliation → action | Project context was discarded on the invoices screen and final-invoice panel. | Fixed: project-scoped history and reconciliation. QuickBooks remains authoritative. |
| Event-day copilot | Published schedule/readiness → role-scoped brief | Copilot reads current evidence and does not mutate records. | Verified in event-day and readiness tests. Offline/provider device acceptance remains a manual launch check. |
| Post-production and delivery | Event complete → milestones → gallery → closeout | Post-production and review routes dropped the selected project. | Fixed: project context is preserved through post-production, delivery, and reviews. |
| Client portal | Assigned project → decisions/messages/delivery | Workspace/data failure had no user-controlled recovery. | Fixed: retry path; project switching remains explicit and tenant-scoped. |
| Navigation and findability | Current work → next valid action | Multiple empty/error states described the problem without preserving context or exposing recovery. | Fixed on import, workspace, generic records, contracts, insurance, invoices, post-production, reviews, client, and crew surfaces. |
| Reliability and custom domain | Browser read → server fallback → retry | A buffering proxy or unstable Firestore WebChannel could make successful data look missing. | Fixed: Firestore long-poll transport plus authenticated, App-Check-protected Admin SDK recovery APIs for workspace and the shared owner/admin studio-record hook, covering allowlisted project, package, questionnaire, message, workflow, and provider records. |
| Billing and entitlements | Trial/product → checkout → webhook → entitlement | Stripe checkout tests existed but were omitted from the default test gate. | Fixed: Stripe checkout added to `npm test`; live webhook acceptance remains an external launch check. |
| Gallery notifications | Delivery approval → client email → evidence | Gallery announcement tests existed but were omitted from the default test gate. | Fixed: gallery announcement added to `npm test`. |
| Reporting claims | Implementation coverage vs observed outcomes | Static capability coverage and observed automation are separate; reports already use “Needs data” when no events exist. | Verified. Import coverage is explicitly labelled “potential draft coverage.” |

## Release acceptance standard

The release is acceptable when typecheck, lint, production build, Functions build/lint, the full unit suite (including Stripe checkout and gallery announcement), and browser smoke tests pass. Provider acceptance that requires a third-party account is tracked as external evidence and must never be represented as an internally verified success.
