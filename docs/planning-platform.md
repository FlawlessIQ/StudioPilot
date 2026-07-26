# Planning Platform

Milestone 5 adds versioned questionnaires, reusable vendors, a human-approved COI workflow, immutable run-of-show schedules, structured AI drafts, and schedule PDFs.

Questionnaire templates snapshot their version into each response. Conditional, required, locked, and internal-only fields are validated server-side. Clients save and submit through trusted commands.

SendGrid inbound COI replies use project-specific tokens stored only as hashes. PDF type and size are checked before restricted temporary storage, malware scanning, and AI extraction. AI comparisons remain advisory. Only permitted studio owners/admins can approve or reject with a reason.

Schedules are structured records. Publishing creates a new immutable version, supersedes the prior version, queues a branded PDF, resets current-version crew acknowledgement, and records an audit event. Conflict rules cover time overlap, travel gaps, locations, assignments, and package coverage.

Vertex AI schedule output must match the strict `aiScheduleDraftSchema`. Assumptions, missing information, conflicts, risks, and questions are displayed separately. No model output is saved as approved or published without human review.
