# Post-Event Operations

Milestone 7 covers the operational lifecycle after an event without attempting to replace editing or gallery products. `postProductionRecords` track evidence-backed steps from backup through archive. `deliveryRecords` store normalized provider references and secure gallery metadata. `reviewRequests` preserve scheduling and engagement evidence. `projectCloseouts` snapshot deterministic closeout requirements.

## Delivery gate

A delivery can be recorded only while the project is in `POST_PRODUCTION` and backup, editing-complete, and gallery-ready evidence all pass. Gallery URLs must use HTTPS. The command atomically creates the delivery record, advances the project to `DELIVERED`, completes the delivery step, schedules review requests, and appends an audit event. Provider adapters reserve Pixieset, Pic-Time, and ShootProof while the initial release supports manual gallery URLs.

## Review sequence

The default sequence schedules the first request three days after delivery and one reminder seven days later. The hourly scheduler creates idempotent email jobs; the communications worker and SendGrid events remain responsible for sent/delivered state.

Opened and clicked states represent engagement only. They never claim a review was posted. A client confirmation or permitted studio confirmation is required to complete the workflow, and that confirmation stops remaining scheduled requests.

## Closeout

Closeout requires verified delivery, final balance evidence or an approved waiver, completed crew obligations, required download/backup evidence, and a resolved review workflow. Only Studio Owners and Studio Admins can execute closeout. Completion moves an eligible project to `CLOSED`, queues a branded closeout summary, and creates an audit event. Archival remains a separate retention-aware transition.

## Reporting

Reporting filters by date, project type, and user. CSV export and print views are available. Financial values are integer-cent QuickBooks references with a visible last-sync timestamp; readiness and automation reliability are deterministic StudioHub records. Browser clients cannot create trusted report snapshots or jobs directly.
