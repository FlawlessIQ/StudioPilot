export type RosterMember = {
  id: string;
  name: string;
  active: boolean;
  /** Absent on every profile made before trades existed — see schema.ts. */
  trades?: readonly string[] | undefined;
  specialties: readonly string[];
};

export type RosterTradeVerdict = {
  id: string;
  name: string;
  /** What the verdict rests on, so an answer can say how sure it is. */
  basis: "trade" | "specialty";
};

export type RosterTradeAnswer = {
  trade: string;
  /** The studio said so: this person's trades include the role. */
  confirmed: RosterTradeVerdict[];
  /** No trade recorded, but their specialties read like the role. */
  inferred: RosterTradeVerdict[];
  /** Active people with no trade recorded at all. */
  untagged: number;
  /** Active people on the roster. */
  rosterSize: number;
};

/**
 * Who on the roster works a trade — asked of the roster, not of a job.
 *
 * "Who can shoot video for me?" is a question about the studio's people. Cue
 * answered it from a project assignment, and was right only because the studio
 * had one videographer holding one job; on a fuller roster it would have named
 * whoever happened to be booked and silently omitted everyone who was not.
 *
 * The matching rule is not invented here. It is the one `features/crew/cascade.ts`
 * already applies when it ranks candidates for a role: where the studio has
 * stated a person's trade, that statement decides; where it has not, fall back
 * to reading their specialties. Two rules for "is this person a videographer"
 * would be worse than the missing tool.
 *
 * The fallback is why `confirmed` and `inferred` are separate, and why
 * `untagged` is counted at all. A roster where nobody has a trade recorded must
 * not produce "you have no videographers" — that is a fact about the data, not
 * about the studio, and the difference is the whole answer.
 */
export function crewForTrade(
  roster: readonly RosterMember[],
  trade: string,
): RosterTradeAnswer {
  const wanted = trade.toLocaleLowerCase();
  const active = roster.filter((member) => member.active);
  const confirmed: RosterTradeVerdict[] = [];
  const inferred: RosterTradeVerdict[] = [];
  let untagged = 0;

  for (const member of active) {
    const trades = (member.trades ?? []).map((value) =>
      value.toLocaleLowerCase(),
    );
    if (trades.length) {
      if (trades.includes(wanted))
        confirmed.push({ id: member.id, name: member.name, basis: "trade" });
      continue;
    }
    untagged += 1;
    // Substring in both directions, so the specialty `video` reaches the role
    // `videographer` and the reverse — same as the cascade.
    const matches = member.specialties.some((value) => {
      const specialty = value.toLocaleLowerCase();
      return specialty.includes(wanted) || wanted.includes(specialty);
    });
    if (matches)
      inferred.push({ id: member.id, name: member.name, basis: "specialty" });
  }

  return {
    trade: wanted,
    confirmed,
    inferred,
    untagged,
    rosterSize: active.length,
  };
}

/** Every trade at once, for a question that names no particular one. */
export function rosterByTrade(
  roster: readonly RosterMember[],
  trades: readonly string[],
): RosterTradeAnswer[] {
  return trades.map((trade) => crewForTrade(roster, trade));
}
