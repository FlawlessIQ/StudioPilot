# Schedule B — quinceañera terms: for counsel's review (2026-10-15)

**What this is.** StudioCue writes each client's agreement from the studio's
own agreement. Since 2026-10-15, an agreement for a quinceañera job also gets
a **Schedule B**, added at the end automatically in the words of the studio's
trade — the same mechanism as the bar and bat mitzvah's
(`docs/mitzvah-schedule-b-counsel-review.md`).

**Status:** shipping before counsel's review (Conor, 2026-10-15). StudioCue
wrote this text; no lawyer has read it. A change to the wording applies to
agreements written after it, never to one already signed.

**Where it lives:** `quinceTermsBlocks(trade)` in
`features/contracts/event-details.ts` (mirrored in
`functions/src/contracts/event-details.ts`), registered in `KIND_TERMS` and
added by `kindTermsBlocks()` in `functions/src/contracts/sources.ts`.

## Why it exists

A quinceañera differs from a wedding in the same two ways a mitzvah does:

1. **The Mass is the parish's.** Many parishes allow photos only before or
   after Mass, or only from the back without flash, and some none at all. The
   studio can't promise coverage the parish forbids.
2. **The honoree and most of her court are minors.** The quinceañera is 15;
   the damas and chambelanes are usually her age. The client is her parents.
   A studio's own agreement often grants it broad rights to use images for
   marketing; the minors clause reverses that for minors unless the client
   agrees in writing. The opening sentence makes Schedule B govern where it
   conflicts with the studio's own terms.

## The text, by trade

### Photography and video

> **Schedule B — Quinceañera terms**
>
> These terms are part of this agreement for this event. Where they differ from the terms above, these apply.
>
> - **The church:** The Studio follows the parish's rules for photography and video, which may keep cameras out of the Mass, allow them only before or after it, or only from the back without flash. Anything those rules exclude is not part of the services and is not a shortfall.
> - **Minors:** The quinceañera and most of her court are minors. The Studio will not use images of the quinceañera, or of any other minor from this event, in its portfolio, website, social media, competitions or advertising unless the Client agrees in writing. The images delivered are for the family's personal use.

### DJ

> **Schedule B — Quinceañera terms**
>
> These terms are part of this agreement for this event. Where they differ from the terms above, these apply.
>
> - **The church:** The Studio follows the parish's rules for music, sound and announcements, which may keep equipment out of the Mass or limit when and where the Studio can play. Anything those rules exclude is not part of the services and is not a shortfall.
> - **Minors:** The quinceañera and most of her court are minors. The Studio plays music suited to their ages, and keeps explicit lyrics out while they are on the floor unless the Client asks otherwise in writing.

### Makeup and hair

> **Schedule B — Quinceañera terms**
>
> These terms are part of this agreement for this event. Where they differ from the terms above, these apply.
>
> - **The church:** The Studio follows the parish's rules for where and when it may work, and the Mass's timing. Anything those rules exclude is not part of the services and is not a shortfall.
> - **Minors:** Services for anyone under 18 are given with a parent or guardian present, and with products suited to their age.

### Planner

> **Schedule B — Quinceañera terms**
>
> These terms are part of this agreement for this event. Where they differ from the terms above, these apply.
>
> - **The church:** The Studio works within the parish's rules for the Mass, any rehearsal and the portraits, and coordinates with its staff. Anything those rules exclude is not part of the services and is not a shortfall.
> - **Minors:** The quinceañera and most of her court are minors. The Client remains responsible for supervising them, including at rehearsals: the Studio coordinates the event and does not provide childcare.

## Questions for counsel

1. **Precedence.** Does "Where they differ from the terms above, these apply"
   reliably override a studio's broader image-use grant for this event?
2. **Minors in the court.** The clause covers "any other minor from this
   event". The client (the quinceañera's parents) signs; the damas' and
   chambelanes' parents do not. Is the client's written agreement enough to
   allow use of the court's images, or does each minor's parent need to agree?
3. **"Personal use."** Does "the images delivered are for the family's
   personal use" limit the family in a way that needs saying differently?
4. **The church.** Is "not a shortfall" clear enough to stop a claim for
   coverage the parish's rules prevented?
5. **Beauty services for minors.** Is "a parent or guardian present" the
   right standard for a 15-year-old and her court?
6. **Planner, rehearsals and supervision.** The court rehearses with a
   choreographer for weeks before. Is the supervision sentence ("including at
   rehearsals … does not provide childcare") enough?
7. **Same as the mitzvah's Schedule B.** Anything counsel changes in the
   mitzvah's terms likely applies here too; they were written together.

## Sweet 16 (added 2026-10-15)

A Sweet 16 job gets its own Schedule B, **"Schedule B — Sweet 16 terms"**, with the minors clause only: a Sweet 16 has no service. Where it lives: `sweet16TermsBlocks(trade)`, beside `quinceTermsBlocks`. Shipped before counsel's review, as the quinceañera's.

### Photography and video

> - **Minors:** The honoree and most guests are minors. The Studio will not use images of the honoree, or of any other minor from this event, in its portfolio, website, social media, competitions or advertising unless the Client agrees in writing. The images delivered are for the family's personal use.

### DJ

> - **Minors:** The honoree and most guests are minors. The Studio plays music suited to their ages, and keeps explicit lyrics out while they are on the floor unless the Client asks otherwise in writing.

### Makeup and hair

> - **Minors:** Services for anyone under 18 are given with a parent or guardian present, and with products suited to their age.

### Planner

> - **Minors:** The honoree and most guests are minors. The Client remains responsible for supervising them: the Studio coordinates the event and does not provide childcare.

**For counsel:** questions 1–3 and 5–6 above apply to these words as written; the Sweet 16 minors clause is the quinceañera's with "the honoree and most guests" in place of "the quinceañera and most of her court".
