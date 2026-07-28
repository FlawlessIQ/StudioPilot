# StudioCue authenticated-product visual audit

Date: July 28, 2026

## Scope

This pass covers every static, authenticated destination in the product:

- 41 Studio workspace routes
- 11 client portal routes
- 8 crew portal routes
- 10 platform-administration routes
- Desktop and mobile viewport behavior
- Navigation labels, active states, page hierarchy, empty states, form rhythm, action clarity, and explanatory copy

Record-detail routes are covered through their shared shells and components. They remain subject to workflow-specific end-to-end tests as representative records are added.

Follow-up correction: the initial pass did not exercise the live project command
center deeply enough. A subsequent real-record audit added explicit coverage for
project-context destinations and every dynamic record-detail family.

## Findings

### 1. Several route families bypassed the intended card spacing

Reports, subscription, data controls, support access, crew creation, and some operational forms rendered `.panel` containers without dependable internal padding. On Reports, this compressed metric labels and values against their borders and made the QuickBooks disclosure look like an accidental footer.

Resolution:

- Added explicit semantic component classes for metrics, plans, data controls, support boundaries, and dense operational forms.
- Made their padding and internal rhythm independent from generic selectors.
- Added responsive rules so cards remain spacious without becoming oversized on phones.

### 2. Empty states explained absence but did not guide action

Many client and crew pages displayed a large white container with a short “nothing yet” message. The state was technically accurate but visually unfinished and did not explain the participant’s journey.

Resolution:

- Added designed empty-state surfaces with clear hierarchy.
- Added concise three-step journey guides to the client and crew portals.
- Preserved truthful states: the interface does not invent projects, assignments, payments, or provider activity.

### 3. Navigation vocabulary did not match user intent

“People” mixed client language with a route that primarily serves client records, while Tasks was hidden behind the Projects active group. This made common work harder to discover and caused the wrong navigation item to appear active.

Resolution:

- Renamed “People” to “Clients.”
- Added Tasks as a first-class workspace destination.
- Corrected active-route grouping so the user always knows where they are.

### 4. Page hierarchy felt repetitive and visually flat

Repeated white cards on a nearly uniform neutral background made distinct workflows feel interchangeable. Important information competed with helper copy, and some pages lacked a strong operational focal point.

Resolution:

- Introduced a consistent authenticated-page header treatment with a subtle StudioCue accent rail.
- Increased distinction among filters, primary metrics, operational content, and system-of-record disclosures.
- Added restrained color coding, icon treatments, tonal backgrounds, and depth while retaining the calm StudioCue identity.
- Avoided decorative gradients and visual noise.

### 5. Operational copy described architecture more than outcomes

Some headings and notes emphasized implementation details instead of answering what the user can do, what happens next, or which system is authoritative.

Resolution:

- Rewrote key Reports and subscription copy around decisions and outcomes.
- Reframed the financial disclosure as “QuickBooks remains your financial source of truth.”
- Kept security and authority boundaries explicit where they protect users from incorrect financial, legal, insurance, or AI assumptions.

### 6. The project lifecycle exposed technical states instead of a usable flow

The original project overview displayed eight small state-machine labels in one
row. It did not explain the larger operating phases, connect the current stage
to the correct tool, or offer a controlled stage update. Its light action
buttons also inherited white text from a dark parent, producing white-on-white
labels.

Resolution:

- Replaced the state row with five understandable phases: Inquiry, Booking,
  Planning, Event, and Delivery.
- Added the exact current deterministic state inside its phase.
- Added a state-aware recommended action that links to the correct project
  workspace.
- Added an explicit, confirmed stage-update control backed by the audited CRM
  command and server-side transition rules.
- Added contrast regression checks for every visible text action.
- Added responsive project-flow coverage and project-context return-path checks.
- Added representative mock records for proposal, schedule, crew,
  post-production, workflow, and proposal-preview detail routes so those
  surfaces can be visually tested without production data.

## Design standard applied

Every authenticated page should now:

1. State the user-facing purpose in the first screenful.
2. Surface the primary action without making every action visually primary.
3. Use meaningful grouping and dependable internal spacing.
4. Show a designed, instructive empty state when no records exist.
5. Preserve a clear active navigation location.
6. Fit desktop and mobile viewports without horizontal overflow.
7. Avoid empty links, fake actions, invented metrics, or ambiguous provider status.
8. Clearly identify an external source of truth when StudioCue displays synchronized data.

## Regression coverage

`e2e/authenticated-visual-shell.spec.ts` visits every static authenticated route in both desktop Chromium and a Pixel 7 viewport. It verifies:

- A visible application shell
- A visible page heading
- Visible StudioCue branding
- No document-level horizontal overflow
- No empty or `#` navigation links

This is intentionally a structural safety net. Workflow tests remain responsible for action-specific behavior, permissions, record access, and provider interactions.
