# Post-wedding delivery — review and plan, 2026-09-28

**The ask.** Review the whole delivery process after the wedding and find
where it can improve. One requirement is fixed: **a job must be able to send
both a photo link and a video link.**

**The headline.** Today it can't. A job can be delivered **once**, with **one
link**, and every word the couple sees says "photographs". A video-led studio
such as GR Productions can't deliver a highlight film after the gallery, or a
full film after the highlight film, without the server refusing it.

---

## How it works today

```
EVENT_COMPLETE → POST_PRODUCTION ──(5 ordered ticks)──► recordDelivery ──► DELIVERED
                   │                                      │
                   │ gallery inbox (1 address/job)        ├─ emailJobs/delivery_*  (couple email)
                   │  → deliveryDrafts (1 link each)       ├─ reviewRequests ×2 (day 3 portal, day 10 email)
                   │                                      ├─ album workflow (optional, 7/14-day reminders)
                   └──────────────────────────────────────┘  + form chains an AI "delivery_note" draft
```

- **Model:** `deliveryRecords` (`features/post-production/schema.ts:32`)
  stores one `galleryUrl`, one access code and one expiry. The provider is
  one of `manual | pixieset | pic_time | shootproof`. It has **no media type,
  no label and no kind** (sneak peek, gallery, highlight film, full film).
- **Post-production:** `postProductionRecords` is one linear photo ladder
  (cull → edit → gallery ready). There is no video track. `targetDeliveryDate`
  is only ever written as null.
- **Package deliverables:** `includedDeliverables` is a list of free-text
  strings. The only thing that reads it is a regex looking for "album".
  **Coverage (photographer/videographer) is never read after the event.**
- **Gallery inbox:** one inbound address per job. Each notification email
  becomes a draft with one link.
- **Studio clicks without the inbox:**
  - 5 checklist ticks, which must go in order;
  - paste the URL;
  - on the first delivery, expand the review-link section;
  - Release.
- **The couple's portal:** shows **one** delivery, `deliveries[0]`, from an
  unordered query. The copy says "Your photographs". A "Video" tile exists
  but can never light up, because the category it looks for isn't in the
  enum.

## Findings

### Blocks photo + video

| # | Finding | Where |
|---|---|---|
| V1 | **A second delivery always fails.** `recordDelivery` requires `POST_PRODUCTION` and moves the job to `DELIVERED`, so the next call throws `PROJECT_NOT_IN_POST_PRODUCTION`. The UI still offers "Release another gallery". | `functions/src/post-event/commands.ts:314, 449`; `delivery-form.tsx:444` |
| V2 | **One URL per record, with no media type or label.** | `schema.ts:37` |
| V3 | **The provider list has no video hosts** (Vimeo, YouTube, Frame.io, Dropbox, Drive). The inbox parser falls back to the "first link", which can be a logo or a tracking redirect. | `schema.ts:36`, `post-event/inbound.ts:74` |
| V4 | **Everything is worded for photos:** the email ("Your photographs are ready"), the portal, and the review notice ("How was your photography experience?"). | `email-templates.ts:815`, `live-client-views.tsx:2695`, `post-event/jobs.ts:83` |
| V5 | **Each release would re-run every follow-up:** a new couple email, 2 more review requests and another album workflow. | `commands.ts:349-448` |
| V6 | **Any email to the inbox ticks cull, edit and gallery-ready**, so a sneak peek or a film teaser opens the delivery gate early. | `inbound.ts:182`, `gallery-evidence.ts:18` |
| V7 | **The portal's Video tile is dead code.** | `live-client-views.tsx:700`, `features/documents/schema.ts:8` |

### Bugs that reach the couple

| # | Bug | Where |
|---|---|---|
| D1 | **Double-click = double delivery.** The Release button never disables, the idempotency key is a fresh UUID on every call, and the server reads state outside a transaction. The result is 2 deliveries, 2 emails and 4 review requests. | `delivery-form.tsx:277, 656`; `lib/post-event/command-client.ts:14`; `commands.ts:307` |
| D2 | **Two delivery emails.** The server queues `emailJobs/delivery_*`, then the form also requests an AI `delivery_note` draft "waiting for your approval". Approving it sends the couple a second email. | `commands.ts:349`; `delivery-form.tsx:303` |
| D3 | **A backdated delivery date fires the review requests on the next hourly run.** | `commands.ts:300` |
| D4 | **Delivery notes are sent to the couple**, but the form doesn't say so. | `route.ts:332`, `delivery-form.tsx:627` |

### Bugs that reach the studio

| # | Bug | Where |
|---|---|---|
| D5 | **Drafts never clear.** There's no discard, so Today shows "Approve the gallery delivery" forever for drafts that can never be released. | `features/today/inbox.ts:1290` |
| D6 | **`viewed` is never written**, and neither is the "Couple opened it" step. Closeout can only pass with a manual download mark or an attestation. | `commands.ts:827, 877`; `checklist.ts:98` |
| D7 | **Answer-facts look for status `"delivered"`, which doesn't exist**, so Cue and AI replies never know the gallery link. | `communications/answer-facts.ts:138` |
| D8 | **The job page reads collection `deliveries`**, but every writer uses `deliveryRecords` (also in H1). | `live-project-detail.tsx:842` |
| D9 | **Deadlines are a hard-coded 42 days after the event**, with no turnaround per package and no reminder to the studio. | `features/today/inbox.ts:527` |
| D10 | **The inbox address disappears** once one delivery exists, or once gallery-ready is ticked, so a video notification has nowhere visible to go. | `delivery-form.tsx:454`; `post-production-checklist.tsx:154` |
| D11 | **Nothing moves a job from `DELIVERED` to `REVIEW_REQUESTED` automatically.** | state machine vs review scheduler |
| D12 | **Editors can't help.** Staff can tick steps but can't see drafts or the inbox. Subcontractors (external editors) have no post-production access at all. | `firestore.rules:782`; `roles.ts:143` |

---

## Design

### 1. Deliverables, not "the gallery"

- A job has a list of **deliverables**. Each one has:
  - `mediaType`: `photo | video | album | other`
  - `kind`: `sneak_peek | gallery | highlight_film | full_film | teaser | raw_files | album | other`
  - `label`: e.g. "Highlight film"
  - `final`: whether it counts toward "delivered". A sneak peek doesn't.
  - `dueDate`
  - `status`: `expected → editing → ready → sent → viewed`
- **`deliveryRecords` gains** `deliverableId`, `mediaType`, `kind` and
  `label`. Old records read as `photo / gallery`. The link field stays
  `galleryUrl` so old records keep working, and a video uses the same field.
- **The provider list grows:**
  - photo hosts: `pixieset | pic_time | shootproof | smugmug`
  - video hosts: `vimeo | youtube | frame_io`
  - file transfer: `dropbox | google_drive | wetransfer`
  - `other`
- The provider is **worked out from the URL**, not picked from a list, by one
  function in `features/post-event/link-host.ts`. It also unwraps tracking
  redirects.
  - WeTransfer links set a 7-day expiry automatically and show a warning.
  - For Vimeo, the access code is the video password.
- **Where the expected deliverables come from:**
  - Packages get structured `deliverables: {mediaType, kind, label, turnaroundDays}[]`.
    These replace the free-text `includedDeliverables`, which is still read
    as a fallback, and AI can suggest the structured version from the old
    text for the studio to approve.
  - If a package has no structured list, the default comes from coverage: a
    photographer means a gallery, and a videographer means a highlight film.
  - The list is set on the job when the event is complete, with each due date
    = event date + turnaround. This replaces the hard-coded 42 days (D9).

### 2. Release is repeatable

- `recordDelivery` works in `POST_PRODUCTION` **and** `DELIVERED`. Each call
  releases one or more deliverables, so **photos and a film can go in the
  same click**.
- **When the job becomes `DELIVERED`:** once every *final* deliverable has
  been sent (decision 1). Until then the job page reads "Photos delivered ·
  Highlight film due 12 Nov". "Mark delivery complete" lets the studio close
  early.
- **Review requests and the album workflow run once per job**, triggered when
  the job reaches `DELIVERED`, not on each release. That fixes V5, and D3,
  because the dates come from that moment. Reaching `DELIVERED` also moves
  the job to `REVIEW_REQUESTED` when the first review request goes out (D11).
- **Duplicate releases can't happen:** the idempotency key is kept for the
  life of the form, the button disables while it runs, and the state is read
  inside a transaction (D1).

### 3. One email per release, in the right words

- **The release click is the approval.** Drop the chained AI `delivery_note`
  draft (D2). Instead, the form shows a **preview of the exact email** with an
  optional personal note, which AI can suggest inline.
- **Copy follows the media:**
  - "Your photographs are ready"
  - "Your film is ready"
  - "Your photos and film are ready", with one button per link
  - "A sneak peek from your wedding"
- **Review copy follows the coverage:** "How was your experience with us?"
  instead of "your photography experience".
- **The notes field says plainly that the couple will see it** (D4).

### 4. Portal: "Your photos" and "Your films"

- Every release is listed, newest first, grouped by media type. Each has its
  own button, access code or password, and expiry.
- Sneak peeks appear as their own item.
- Delete the dead Video tile, or point it at deliverables (V7).
- **Optional:** a reminder to the couple before a gallery expires ("download
  your photos before 1 Dec"). Couples value it, and many studios use it to
  sell prints.

### 5. Gallery inbox v2

- **Recognise video hosts** and unwrap SendGrid and Mailchimp tracking links
  before picking the link (V3).
- **Classify each email:** the media type from the host, and the kind from
  keywords ("sneak peek", "highlight", "teaser", "full film"). Match it to an
  expected deliverable, so the draft already reads "Highlight film — ready to
  release".
- **Tick only the checklist steps for that deliverable's track.** A sneak
  peek ticks nothing (V6).
- **Discard, and supersede automatically:** releasing a deliverable clears
  the other drafts for it, and every draft gets a Discard button (D5).
- **Keep the inbox address visible** until closeout (D10).

### 6. Checklist: fewer gates, one per track

- The **one required gate** is **backup verified**, the step that protects
  the files.
- Cull, edit and "ready" become **progress per deliverable** (photo track,
  video track). They show status but don't block the release (decision 4).

### 7. Real "viewed"

- Links to the couple go through **`studio-cue.com/d/{token}`**. The first
  open stamps `viewedAt` and redirects to the stored URL. The redirect can
  only go to that stored URL; it is not an open redirect.
- This makes `viewed` real (D6), gives closeout true evidence, and lets Today
  show "Harper & Lane opened their film".
- It works for both email and portal clicks. SendGrid click tracking already
  exists, but it only covers email.

### 8. Editors (v2)

- Staff photographers and videographers, and subcontractor editors with a
  job-scoped grant, can **submit a deliverable**: paste the link and mark it
  ready. That creates a draft the studio approves. Editors never release to
  the couple themselves (D12).

### Small fixes

- The answer-facts status (D7).
- The `deliveryRecords` read on the job page (D8).

---

## Ship order

| # | Slice | Size | Notes |
|---|---|---|---|
| 0 | **D1 double release, D2 double email**, D3, D4, D5 discard, D7, D8 | S–M | Independent. D1 and D2 reach the couple. Do them first. |
| 1 | Deliverable fields + link-host detection + repeatable release + job→DELIVERED rule + follow-ups once per job | M–L | **This unblocks photo + video** |
| 2 | Email copy by media type with preview, portal photos/films sections, review copy | M | Render worker: verify the deployed bundle |
| 3 | Structured package deliverables + turnaround → expected list and due dates; Today due/late | M | Replaces the hard-coded 42 days |
| 4 | Gallery inbox v2: video hosts, unwrapping, classification, ticks per track | M | |
| 5 | `/d/{token}` view tracking → real `viewed`, closeout evidence | S–M | |
| 6 | Simpler checklist (backup gate + progress per deliverable) | S | |
| 7 | Gallery expiry reminder to the couple (optional) | S | Must recheck the project, like other scheduled client email |
| 8 | Editors submit deliverables (v2) | M | Rules + roles change |
| 9 | **Walk on prod:** one job, photos by inbox, then a highlight film by paste, then a full film; check the portal, the emails and the review timing | — | Needs Conor, ideally Gabe's real Vimeo link |

Slices 0–2 are the minimum for "photo + video works". Everything touches
`functions/` and email templates, so the deploy-all and freshness rules in
CLAUDE.md apply. In particular, **check the `operationsTaskWorker` bundle**:
it has twice missed delivery-copy changes.

---

## Open decisions

1. **When is a job "delivered"?** Recommended: when every *final* deliverable
   has been sent, with an override. The alternative is on the first release.
2. **When do review requests go out?** Recommended: after the **last** final
   deliverable. Films often arrive weeks after photos, and asking for a
   review before the film lands hurts a video-led studio.
3. **Delivery email:** the release click is the approval, with an inline
   preview and personal note (recommended). The alternative keeps the
   separate AI draft to approve.
4. **Checklist:** only "backup verified" is required (recommended), or keep
   the 5 ordered ticks?
5. **View tracking** through a StudioCue redirect link (recommended), or
   direct provider links with no view evidence?
6. **Should editors submit deliverables in v1** (not recommended: v2), and
   should the gallery expiry reminder to the couple be in v1?
