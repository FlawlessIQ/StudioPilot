# UAT plan & run — Gabe's feedback (2026-10-01)

Everything Gabe (GR Productions) asked to have fixed or changed on
**2026-09-30**, each turned into test cases, plus scenarios of the same kind
from the change-your-mind waves (0–3) and the gap fixes that followed. Run on
production through Chrome as the **FlawlessIQ** test studio (Conor's test
account; every record there is test data). Emails only go to `conor+…@
flawlessiq.com` test addresses.

**Who can run it**
- **C** — Claude, through Chrome, as the studio.
- **P** — needs a person: signing in as the couple or crew (Claude never does), or a live QuickBooks/Stripe account (FlawlessIQ's QuickBooks has lapsed).

**Result key:** ✅ pass · ❌ fail (defect logged below) · ⏭ not run (reason given) · 🟡 pass with a finding

---

## Part A — What Gabe asked for, in his words

| # | Gabe said (2026-09-30) | What it became |
|---|---|---|
| G1 | "Cant pick two packages." / "Think we need a back or undo button." | Multi-select on the booking brief; Add / Remove / Start over in the composer picker |
| G2 | (screenshots) "…ant send proposal at all" — Today's *Review package recommendation* / *Prepare proposal draft* said "We couldn't draft this. Try again."; composer "The studio server refused this request" | Blocked AI work routes to "Pick packages"; packages with no terms use default wording; brief no longer disabled |
| G3 | "Just has text from one package here." · "Change 'investment' to packages." · "And these should be bullets. Can i change that in my 'packages' portal?" | Each package's inclusions as bullets under **Packages** (studio page, couple page, PDF); package editor has *What's included* + *Terms* |
| G4 | "Proposal not branded. Should logo be on here?" | Logo upload saves, is trimmed/capped; PDF shows it |
| G5 | "I had $10 retainer. To test payment. It didnt show up here." · "Keeps zeroing out retainer" · "I requested a change from the bride to change packages. But couldnt adjust retainer." · "Maybe start new proposal option?" | Retainer survives every save; retainer field on the draft; discard/withdraw a proposal |
| G6 | "Doesnt have both packages here." (contract) · "Do you think this is hard to read?" | Contract lists every package's coverage + inclusions, grouped under each package with bullets |
| G7 | "Unresponsive typign here again. Like the schedule was the other day. I makes you click inside every character you type." | Sheet dialogs keep focus while typing |
| G8 | "Quickbooks rejected" (retainer invoice; the card blamed an agreement template) | Existing QuickBooks customer matched by name; QuickBooks' own reason shown |
| G9 | "add in a way to add custom stuff other photographers offer like engagement shoot, photobooth, boudoir shoot" | *Add extras* (library or one-off), one-tap ideas |
| G10 | "Delete client is gone. And save button still not a button." | Archive/restore explained (no hard delete); variant-less buttons styled |
| G11 | "Where can i undo or delete proposal." | Discard draft / Withdraw sent proposal |
| G12 | (Conor, for Gabe) "Gabe usually does every shoot but there may be some where he is not there and he sends crew" | Per-job *You're shooting this one / Not me this time* |

---

## Part B — Test cases

### B1. Packages & proposal (G1, G2, G3, G5, G9, G11)

| ID | Who | Steps | Expected |
|---|---|---|---|
| T01 | C | Composer: pick package A, then *Add alongside* package B | Both chips; snapshot shows A + B and combined total |
| T02 | C | Composer: *Remove* an extra package (confirm) | Confirm names what's lost; B gone; total updates |
| T03 | C | Composer: *Start over with this one* | Confirm names what's dropped; only the new package remains |
| T04 | C | Package with **no terms** in composer | Terms prefilled with standard wording (or each package's own terms under its name); *Create draft* works |
| T05 | C | Draft page | Heading **Packages**; each package line has its own bullets |
| T06 | C | Draft: set retainer $10, *Save draft*, reload | $10 kept; schedule shows $10 / balance = total − 10 |
| T07 | C | Draft: change an unrelated field, *Save draft*, reload | Retainer still $10 (not reset) |
| T08 | C | Draft: edit notes then *Approve this proposal* without saving | Edit saved before approving |
| T09 | C | Approved proposal → **PDF** | "PACKAGES" header, bullets per package, $10 retainer, logo (if set) |
| T10 | C | *Add extras* on a package → one-off "Engagement shoot $500" | Saved on the package; total includes it; one-tap ideas listed |
| T11 | C | Discard an unsent draft | Confirm; status *Discarded*; composer allows a new draft at once |
| T12 | C | Record acceptance → *Undo this acceptance* | Proposal back to its prior status; job back to Proposal; unsent agreement draft discarded |
| T13 | P | Send proposal → couple opens → studio *Withdraw* | Couple sees "Your studio has withdrawn this proposal"; can't accept |
| T14 | C | Today with an AI action that failed validation (no package picked) | One "Pick packages" card linking to the brief — no Approve that 400s |

### B2. Package editor (G3)

| ID | Who | Steps | Expected |
|---|---|---|---|
| T15 | C | Edit a package: *What's included* one item per line; *Terms*; Save | Both saved; next proposal shows the lines as bullets and the terms |
| T16 | C | Swap a package on a draft that has a discount | Discount kept (not wiped) |

### B3. Contract (G6, G7)

| ID | Who | Steps | Expected |
|---|---|---|---|
| T17 | C | Booking agreement preview for a 2-package proposal | Coverage "N photographers and M videographer(s)"; each package's inclusions under its own name, bulleted; Part 2 lists both packages with bullets |
| T18 | C | Studio typing in a sheet dialog (Edit job) | Whole string lands with one click; focus stays |
| T19 | P | Couple *Review & sign* → type full name | Typing works without re-clicking |

### B4. Money (G5, G8)

| ID | Who | Steps | Expected |
|---|---|---|---|
| T20 | C | Invoices page labels | Rows read *Retainer* / *Final bill*, not provider ids |
| T21 | C | Final bill held for review | Row has *Check and send*; card headed with the job name; header = button amount, "Was … when it was raised" when they differ |
| T22 | C | Void an unpaid invoice (two-step confirm) | Status Voided, balance $0; provider void "not needed" if it never reached QuickBooks |
| T23 | P | QuickBooks: couple already a customer → retainer invoice | Existing customer reused; no "name already exists" |
| T24 | P | Record a $1 part payment on an invoice out with the couple | *Part paid · $X left*; QuickBooks payment created |
| T25 | C | "Paid another way" amount | Shows the agreed retainer (proposal schedule), not the package's |

### B5. Branding & UI (G4, G10)

| ID | Who | Steps | Expected |
|---|---|---|---|
| T26 | C | Settings → logo upload (large, white margin) | Saves once; stored trimmed and ≤1200px; no accidental clear |
| T27 | C | Clients → *Edit or archive* | *Save client* looks like a button; Archive/Restore present; no "Delete" (by design) |

### B6. Crew & who's shooting (G12 and related)

| ID | Who | Steps | Expected |
|---|---|---|---|
| T28 | C | Job crew card: *Not me this time* → reload → *I'm shooting it* | Text flips; persists across reload |
| T29 | P | Accept a crew offer as crew → run-of-show editor | *Crew on this* lists them with role; day sheet shows "You're on this" |
| T30 | P | *Withdraw* an accepted crew member | They're emailed; calendar invite removed; *Replace* re-offers |

### B7. Going back & undo (Gabe's "undo" ask, generalised)

| ID | Who | Steps | Expected |
|---|---|---|---|
| T31 | C | Cancel a booked job | Confirm lists this job's consequences; "Keep the job"; tell-the-couple off by default |
| T32 | C | *Move back → Undo the cancel* | Job returns to its stage; Google Calendar event restored |
| T33 | C | Undo with an empty reason | "Add a short reason first…" message (not silent) |
| T34 | C | Tasks: add with assignee → edit → mark done → reopen | Row shows "For …"; edits saved; Reopen works |
| T35 | C | Today *Send reply* → *Undo* | Email cancelled, never sent; card returns without reload |

### B8. Communication safety (related)

| ID | Who | Steps | Expected |
|---|---|---|---|
| T36 | C | Approve an AI draft twice (second tab) | Second approval sends nothing ("Already approved") |
| T37 | C | A booking-check blocker on Today | Reads as a sentence, never a code |

---

## Part C — Run log

Run 2026-10-01 on studio-cue.com (Chrome, signed in as the FlawlessIQ owner),
against commit `959b5ab`. Mostly on the **Package bullets test wedding**, plus
Smith, Rivera and **Undo Walktest wedding**.

**Totals (37):** 29 run: 27 ✅, 2 🟡, 0 ❌. 8 not run (⏭): 6 need a person or a live provider (T13, T19, T23, T24, T29, T30); 2 had no data on prod to test with (T14, T37).

| ID | Result | What happened |
|---|---|---|
| T01 | ✅ | *Add alongside* Test video package: both chips, combined $5,000 |
| T02 | ✅ | Confirm: "Take Test video package off the job? Adding it back later starts it at today's price." Removed; total updated |
| T03 | 🟡 | Works; only the new package remains. **Finding F2:** the confirm says "This takes Signing test package and Test video package off the job…" when starting over *with* Signing test package. It names the package you're keeping as being removed |
| T04 | ✅ | Terms prefilled under each package's name; *Create draft* worked |
| T05 | ✅ | Heading **Packages**; each package's inclusions as its own bullets |
| T06 | ✅ | $10 retainer kept after save + reload; schedule $10 / balance |
| T07 | ✅ | Unrelated edit + save: retainer still $10 |
| T08 | ✅ | Unsaved notes edit saved by *Approve this proposal* |
| T09 | 🟡 | PDF: PACKAGES, bullets per package, $10 retainer, logo. **Finding F1:** the PDF leaves out the 10% video discount line. Its lines add up to $6,500 while its total says $6,200. The studio page and the agreement both show the discount |
| T10 | ✅ | One-off "Engagement shoot $500" saved on the package; total includes it; idea chips listed |
| T11 | ✅ | Discard: confirm → *Discarded*; composer free for a new draft at once |
| T12 | ✅ | (earlier walk today) Undo acceptance → back to Proposal; unsent agreement draft discarded |
| T13 | ⏭ P | Needs the couple's view of a withdrawn proposal |
| T14 | ⏭ | No AI action that failed validation exists on FlawlessIQ right now; covered by unit tests (`blocked-ai-actions`) |
| T15 | ✅ | Test video package: *What's included* as 3 lines + new *Terms*. Saved ("New proposals use these numbers…") and both survived a reload |
| T16 | ✅ | 10% discount kept as a percentage after the swap (−$300, total $6,200) |
| T17 | ✅ | Agreement preview: Part 2 lists both packages with bullets, the extras, the discount line and the $10 retainer. Closed without sending |
| T18 | ✅ | Edit job sheet: "The Grand Ballroom" typed in one go, focus kept |
| T19 | ⏭ P | Couple signing: Claude doesn't sign in as the couple |
| T20 | ✅ | (earlier walk) Rows read *Retainer* / *Final bill* |
| T21 | ✅ | (earlier walk) *Check and send* jumps to the card headed with the job name; "Was … when it was raised" line |
| T22 | ✅ | (earlier walk) Two-step void → Voided, $0 |
| T23 | ⏭ P | FlawlessIQ's QuickBooks subscription has lapsed (left as is on purpose). The failure card quotes QuickBooks' own reason, which was the G8 complaint |
| T24 | ⏭ P | Needs live QuickBooks/Stripe |
| T25 | ✅ | "Records $750.00 — the retainer on what the couple accepted" |
| T26 | ✅ | 3000×3000 white-margin logo → stored 1200×303; "Logo uploaded and saved…" |
| T27 | ✅ | *Save client* has a filled background and border; *Archive client* present; no Delete |
| T28 | ✅ | (earlier walk) *Not me this time* ↔ *I'm shooting it* persists across reload |
| T29 | ⏭ P | Needs a crew login |
| T30 | ⏭ P | Needs a crew member who accepted |
| T31 | ✅ | (earlier walk) Cancel confirm lists consequences; *Keep the job*; tell-the-couple off |
| T32 | ✅ | (earlier walk) Undo the cancel → stage restored; Google Calendar event really recreated |
| T33 | ✅ | Empty reason → the browser's "Please fill out this field". Spaces only → "Add a short reason first — at least 10 characters…". Job unchanged |
| T34 | ✅ | (earlier walk) Assignee shown as "For …"; edit, done, reopen |
| T35 | ✅ | *Send reply* → *Undo*: both email jobs cancelled, never sent; card back without a reload (fix `959b5ab`) |
| T36 | ✅ | Smith "Staff second photographer" action open in two tabs. Approved in tab 1; tab 2 says "Already done — this was approved or put away a moment ago, so nothing was sent again." Exactly one task created |
| T37 | ⏭ | No booking blocker on Today right now. Today shows no raw codes anywhere. The wording (`bookingBlockerLabel`) is covered by `tests/prod-walk-fixes.test.ts` |

### Findings

- **F1 — PDF proposal drops the discount line** (T09). Its lines add up to $6,500 and its total says $6,200, so a couple reading the PDF sees numbers that don't add up. *Fix:* render the discount row in the Cloud Run PDF, as the studio page and agreement do.
- **F2 — "Start over" confirm names the kept package as removed** (T03). *Fix:* list only the packages that are actually dropped.
- Minor: the T36 "nothing was sent again" wording is used even when the action was a task, not an email. Harmless.

### Test data left on FlawlessIQ

- **Logo:** the 1200×303 green test bar. Replace or remove it in Studio settings.
- **Package bullets test wedding:** approved proposal, $6,200 with a $10 retainer, extras and a 10% video discount.
- **Undo Walktest wedding** (`conor+undowalk@`).
- **Smith:** cancelled and restored; its final bill superseded. It also has a new *Staff second photographer* task from T36.
- **Rivera:** an empty run-of-show draft.
- **Test video package:** inclusions are now 3 lines, and its terms read "UAT 2026-10-01…".

### What needs a person

T13, T19, T29 and T30 need the couple's or crew's own login, on a test address. T23 and T24 need a live QuickBooks (or Gabe's own once he books).
