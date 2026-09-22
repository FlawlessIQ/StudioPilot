# Fixture-realism audit — 2026-09-22

Prompted by a test that passed for two days while the thing it covered was
broken in production. The question asked of every matcher: **does its fixture
reproduce what the product actually stores?**

Method: read real records out of `studiohub-prod` — the reference studio's
roster, its crew, and every tenant's project names — and run each matcher
against those instead of invented names.

## The finding that mattered

`resolveFlowProjectId` (Cue's last-resort project matcher) had two fixes
already: ampersand normalisation on 09-20, and generic-suffix trimming earlier
on 09-22. **Neither resolved the case they were both written for.**

Production says the naming assumption behind the second fix was mine, not the
product's:

```
GR Productions — 11 real jobs
  Sydney Lucas & Ryan Conklin wedding
  Sarah Holtz & Jonathan Gross
  Tori Tucci & Jake Mendlen
  Erin Hoffman & Joseph DeMattia        ← the job in Gabe's transcript
  …
  10 of 11 end in no generic word at all
```

Gabe's job is filed `Erin Hoffman & Joseph DeMattia`; he typed
`for erin and joe demattia`. A dropped surname and a shortened first name — no
substring of the record appears in that sentence, so containment could never
reach it, trimmed or not. Verified directly: his exact sentence still returned
`null` against the code shipped that morning.

Matching now falls back to the stored name's **own words**: how many the
operator used, counting a shortened first name (`joe` → `joseph`) as the word
it abbreviates. Floor of two words, and the winner must be strictly ahead of
the runner-up.

Checked against the real roster:

| Sentence | Resolves to |
|---|---|
| `…for erin and joe demattia` (the transcript) | Erin Hoffman & Joseph DeMattia |
| `the sydney and ryan wedding` | Sydney Lucas & Ryan Conklin wedding |
| `offer kelly and daniel a slot` | Kelly Hernon & Daniel Archer |
| `add someone for erin` | null — fits several |
| `for baumwoll` | null — one word is never enough |
| `staff heather baumwoll` | Heather Baumwoll |
| `staff the Ellis job` | null |

Its tests now use that roster verbatim.

## Matchers checked and found sound

**`features/ai/flow-subject.ts`** — the person named in a flow. Exact match or
full-token subset, no fuzzy scoring, ambiguity refused. Against the real
rosters: `albert gershengoren` matches, `albert` alone matches (one Albert),
`silva marco` matches, two identical `Conor Lawless` profiles come back
*ambiguous*, a misspelled surname comes back *unmatched* and is surfaced.

Strictness is right here and should not be loosened: a wrong match offers a
wedding to the wrong person, at a fee, by email. That is a different risk from
showing the wrong job, and the code says so.

**`features/booking/signed-agreement-match.ts`** — the highest-stakes matcher
in the product, and already the most careful. It reduces a name to
`{ first, last }` and matches on surname plus first initial, which handles
`Joe`/`Joseph` natively; it scores, refuses ties outright, and surfaces every
doubt as a flag for a human to clear.

**Worth noting:** the technique the copilot matcher needed already existed
here, one directory away, written for exactly this problem. The gap was reuse,
not knowledge.

**`features/crew/duplicate-profile.ts`** — keys on normalised email, not name.
Right key; no name-matching risk.

**`features/imports/spreadsheet.ts`** — matches column *headers* by synonym,
and the studio can correct any match. Different concern, sound.

## What to carry forward

A guard test earns its keep only if its fixture could express the failure. Two
fixes shipped against invented names and neither moved the real case. Take
fixture values from what the product stores — the create form's own output, or
production itself — and confirm the guard fails on the pre-fix code.

## Not yet confirmed live

The word-matching path is verified against the real roster offline, running the
same source that is deployed. Asking Cue on production to exercise it needs a
studio session; the UAT browser profile is currently signed in as the client.
