# Inquiry form feels slow — investigation, 2026-09-28

**Report.** Gabe, testing as a couple, found the inquiry form's fields "slow
and very unresponsive". This is the first StudioCue screen a couple ever
sees, and the one that has to convert. It needs to feel instant.

**Status.** A first pass over the code, plus one page-load measurement on
production. The live typing measurement was not run: the production browser
check needs Conor's permission. Five causes are likely, and two of them are
confirmed in the code.

## Measured (production, `/inquiry`, first page load)

The load measured was the page served for a studio link that doesn't exist.
It loads the same code bundle as the real form.

| | Value | What it should be for a one-form public page |
|---|---|---|
| JavaScript | **~1.5 MB** decoded, 10 scripts (largest chunk 672 KB) | < 250 KB |
| CSS | **~684 KB**, **5,918 rules** (all of `globals.css` + design system + legacy bridge) | < 50 KB |
| Time to first byte | ~1.06 s | < 300 ms |
| DOM content loaded | ~1.8 s on a desktop connection | a phone will be several times slower |

## Likely causes, ranked

### 1. Anything typed before the page is ready gets erased (high confidence)

- The server sends the form as plain HTML, so it **looks** ready straight
  away. A couple starts typing.
- Then 1.5 MB of JavaScript loads and starts up (hydration). On a mid-range
  phone that takes seconds.
- When it does, `react-hook-form`'s `register` writes each field's
  `defaultValues` entry (`""`) into the input. **Whatever they typed
  disappears.**
- To the person typing, the fields "don't respond" or "lose what I typed".
- The form already guards the submit button on `hydrated` for this reason,
  but not the inputs.
- `components/crm/lead-intake-form.tsx:27, 67-79`.

### 2. The venue field re-renders the whole form on every keystroke, and changes City while you type (confirmed in code)

- Each keystroke in the venue box runs
  `AddressField.type` → `onChange(unverifiedPlace(text))` → `applyVenue`.
  That does three things:
  - `setVenue` re-renders the **entire form**;
  - `setValue("venue", …, { shouldValidate: true })` runs the **full Zod
    schema**;
  - `setValue("city", …, { shouldValidate: true })` runs it **again**.
- **Bug:** `placeCity()` on typed (unverified) text takes the third-from-last
  comma part as the city. Typing "The Barn, 12 Main St, Hope, NJ" rewrites
  City on every comma, **overwriting a city the couple already entered**. The
  comment above `applyVenue` promises the opposite.
- `lead-intake-form.tsx:88-96`, `features/places/schema.ts:103-110`,
  `components/forms/address-field.tsx` (`type()`).

### 3. Address suggestions arrive late (confirmed in code; latency not measured)

Each suggestion request to `/api/public/places` makes these calls one after
another:

1. a tenant lookup by `slugAliases`;
2. if that misses, a **second** lookup by `publicSlug`;
3. a **Firestore transaction** for the rate limit;
4. the Google Places call.

On top of that there is a 260 ms debounce. The list shows up well after the
typing and then jumps. There's also a limit of **120 requests per hour per
IP + browser**, which someone testing repeatedly can hit, and suggestions
then **stop silently**.
`app/api/public/places/route.ts:49-130`.

### 4. The whole app's CSS and JavaScript ship to a one-form page

- `app/layout.tsx` loads every global stylesheet. That is 5,918 rules,
  including 64 `:has()` selectors, and each style recalculation on a
  low-end phone pays for all of them.
- The form imports the Firebase client (Auth, Firestore with long-polling,
  App Check) just to get an App Check token at submit time.
- The root layout also mounts the service worker, the error reporter, and a
  `MutationObserver` over the whole `body` (`IconButtonTitles`).

### 5. A slow first byte, and a slow submit

- **Slow first byte:** `studioForSlug` runs **twice** per request (in
  `generateMetadata` and again in the page), not wrapped in React `cache()`.
  Each run is up to two Firestore queries in a row. `app/inquiry/page.tsx:14-62`.
- **Slow submit:** App Check / reCAPTCHA Enterprise only starts **when Send
  is pressed**. The submit then waits for the token, for up to 10 s, before
  the request even leaves. In-app browsers (Instagram, Gmail) are known to
  stall here (2026-09-25).

## Investigation steps

1. **Ask Gabe:** which link he used (the studio's `/inquiry` link or a
   personal `/i/…` link), which phone, and which browser. Was it opened from
   an app (Instagram, Gmail, Messages)?
2. **Profile on a phone-class CPU** (DevTools, 4× CPU throttle, "Fast 3G"):
   - how long until the page is interactive;
   - **INP per field** (how long each keystroke takes to show);
   - type immediately after the page appears, to confirm cause 1.
3. **Time the places route in production logs:** p50 and p95 for suggest and
   resolve, and any rate-limit refusals.
4. **Record a bundle breakdown** for `/inquiry` (what makes up the 672 KB
   chunk).

## Fix directions (to confirm against the profile)

- **Keep what was typed:** read the DOM values into the form when it
  hydrates, instead of overwriting them. Alternatively, render the inputs
  disabled until hydration, but only if hydration becomes fast.
- **Venue field:**
  - keep the typing state inside `AddressField`;
  - don't validate on every keystroke;
  - **only fill City from a *chosen* suggestion, and only if City is empty.**
- **Places route:**
  - cache slug → tenant in memory;
  - do both slug lookups in parallel;
  - replace the rate-limit transaction with a cheaper counter;
  - log latency.
- **A light public shell:** give `/inquiry` (and `/i/[token]`) their own
  layout and small stylesheet, without the app-wide CSS, the service worker
  or the observers.
- **Load Firebase and App Check only when needed:** dynamic-import them, and
  **pre-warm App Check when the first field gets focus**, so the token is
  ready by the time they press Send.
- **Wrap `studioForSlug` in `cache()`**, and run the two queries in parallel.
- **Budgets as a guard:** a test that fails if the `/inquiry` JavaScript or
  CSS goes over budget. Also a Playwright check that a field typed into
  before hydration keeps its value.

## Also applies to

The per-couple inquiry page (`app/i/[token]`, in progress in another session)
uses the same pieces. Apply the same budgets and fixes there.

## Target

- On a mid-range Android phone over 4G:
  - interactive in **< 2 s**;
  - every keystroke shows in **< 100 ms** (INP well under 200 ms);
  - address suggestions within **~400 ms** of a pause.
- **Nothing typed is ever lost.**
