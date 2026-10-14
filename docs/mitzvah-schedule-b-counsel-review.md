# Schedule B — bar and bat mitzvah terms: for counsel's review (2026-10-14)

**What this is.** StudioCue writes each client's agreement from the studio's
own agreement. A wedding's agreement gets a Schedule A of event details. Since
2026-10-14, an agreement for a bar or bat mitzvah job also gets a **Schedule
B**. It's added at the end automatically, in the words of the studio's trade.

**Status:** live in production (commit ce762b48; wording revised in e6bc1dcd).

StudioCue wrote this text. No lawyer has read it. Any change to the wording
applies to agreements written after it, and never to one already signed.

**Where it lives:** `mitzvahTermsBlocks(trade)` in
`features/contracts/event-details.ts`, mirrored in
`functions/src/contracts/event-details.ts`. It's added in
`functions/src/contracts/sources.ts` (`kindTerms`) and printed after
Schedule A in `features/contracts/document.ts`.

## Why it exists

A bar or bat mitzvah differs from a wedding in two ways that matter to the
contract:

1. **The service is the congregation's.** Many synagogues allow no
   photography, video or amplified sound during the service, especially on
   Shabbat. Some allow a portrait window or a rehearsal. The studio can't
   promise coverage the congregation forbids.
2. **Most of the people photographed are children.** The honoree is 12 or 13,
   and the client is the honoree's parents. A studio's own agreement often
   grants it broad rights to use images for marketing. The production walk
   found FlawlessIQ's: "Permission is granted for all images to be displayed
   and used … for competition, advertising and Internet purposes".

The second clause **reverses that grant for children**, unless the client
agrees in writing. The opening sentence makes Schedule B govern where it
conflicts with the studio's own terms.

## The text, by trade

### Photography and video

> **Schedule B — Bar and bat mitzvah terms**
>
> These terms are part of this agreement for this event. Where they differ from the terms above, these apply.
>
> - **The house of worship:** The Studio follows the rules of the synagogue or congregation for photography and video, which often keep cameras out of the service and may limit when and where the Studio can photograph. Anything those rules exclude is not part of the services and is not a shortfall.
> - **Children:** Many guests at a mitzvah are children. The Studio will not use images of the honoree, or of any other child from this event, in its portfolio, website, social media, competitions or advertising unless the Client agrees in writing. The images delivered are for the family's personal use.

### DJ

> - **The house of worship:** The Studio follows the rules of the synagogue or congregation for music, sound and announcements, which may keep equipment out of the service or limit when and where the Studio can play. Anything those rules exclude is not part of the services and is not a shortfall.
> - **Children:** Many guests at a mitzvah are children. The Studio plays music and runs games suited to their ages, and keeps explicit lyrics out while children are present unless the Client asks otherwise in writing.

### Makeup and hair

> - **The house of worship:** The Studio follows the rules of the synagogue or congregation for where and when it may work, and its dress and timing. Anything those rules exclude is not part of the services and is not a shortfall.
> - **Children:** Services for anyone under 18 are given with a parent or guardian present, and with products suited to their age.

### Planner

> - **The house of worship:** The Studio works within the rules of the synagogue or congregation for the service, the rehearsal and the portraits, and coordinates with its staff. Anything those rules exclude is not part of the services and is not a shortfall.
> - **Children:** Many guests at a mitzvah are children. The Client remains responsible for supervising them: the Studio coordinates the event and does not provide childcare.

For every trade, the heading and the opening sentence are the same as for
photography.

## Questions for counsel

1. **Precedence.** Does "Where they differ from the terms above, these
   apply" reliably make Schedule B win over a conflicting clause in the
   studio's own agreement? Studios write their own, and StudioCue can't see
   every one. Should it name the clauses it overrides instead?
2. **Images of children.** Is "unless the Client agrees in writing" enough
   for the honoree, whose parent is the Client? Is it enough for *other*
   children at the event, whose parents are not parties to this agreement?
   Should the studio need each child's parent's consent, or simply never use
   other children's images?
3. **"Personal use."** Does "the images delivered are for the family's
   personal use" conflict with a studio's copyright clause or its license to
   the client? Should it say "license" in so many words?
4. **The house of worship.** Is "not a shortfall" clear enough to stop a
   claim for services not given because of the congregation's rules? Should
   it also mention refunds or price, for example "the fee is unchanged"?
5. **Beauty services for minors.** Is "a parent or guardian present" the
   right standard? Should the agreement ask about allergies, or require a
   patch test, for a minor?
6. **Planner and childcare.** Is the supervision sentence enough to keep a
   planner from being treated as responsible for child guests?
7. **Placement.** Schedule B is added at the end, after Schedule A, as part
   of the signed document. Is a schedule the right form, or should these be
   numbered clauses in the body?

Answers go back into `mitzvahTermsBlocks`. A change becomes a new version
for agreements written after it.
