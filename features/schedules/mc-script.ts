/**
 * A DJ's MC script, on the run of show (docs/vendor-journeys-plan.md, 2.3).
 *
 * Each moment of the night can carry what the DJ plays and says: the song,
 * the announcement, and how to say the names in it. A mispronounced name on
 * the microphone is a DJ's signature failure, so the pronunciation travels
 * with the line it's said on, onto the PDF and the DJ's day sheet.
 *
 * The couple's Music & moments planner (recommended-templates.ts,
 * "dj-music-planner") fills it: `fillMcScript` matches each answer to the
 * line it belongs on by the line's title, and never overwrites anything the
 * studio typed. Pure.
 */

export type McScript = {
  song: string | null;
  announcement: string | null;
  pronunciation: string | null;
};

const clean = (value: unknown, max: number): string | null => {
  const text = typeof value === "string" ? value.trim() : "";
  return text ? text.slice(0, max) : null;
};

/** A change to a line's script; an empty script is no script. */
export function patchMcScript(current: Partial<McScript> | null | undefined, patch: Partial<McScript>): McScript | undefined {
  const next: McScript = {
    song: clean(patch.song !== undefined ? patch.song : current?.song, 200),
    announcement: clean(patch.announcement !== undefined ? patch.announcement : current?.announcement, 600),
    pronunciation: clean(patch.pronunciation !== undefined ? patch.pronunciation : current?.pronunciation, 300),
  };
  return next.song || next.announcement || next.pronunciation ? next : undefined;
}

/** The script as one line, for the PDF, the day sheet and the couple: "♪ … · Say: … · Names: …". */
export function mcScriptLine(mc: Partial<McScript> | null | undefined): string | null {
  if (!mc) return null;
  const parts = [
    clean(mc.song, 200) ? `♪ ${clean(mc.song, 200)}` : null,
    clean(mc.announcement, 600) ? `Say: ${clean(mc.announcement, 600)}` : null,
    clean(mc.pronunciation, 300) ? `Names: ${clean(mc.pronunciation, 300)}` : null,
  ].filter(Boolean);
  return parts.length ? parts.join(" · ") : null;
}

/**
 * Which planner answers go on which line, by the line's title. The first
 * match wins, so "Parent dances" is tried before "first dance".
 */
const RULES: ReadonlyArray<{ title: RegExp; song?: string; announcement?: string }> = [
  { title: /prelude|guests arriv/i, song: "prelude-music" },
  { title: /processional/i, song: "processional-song" },
  { title: /recessional/i, song: "recessional-song" },
  { title: /\bceremony\b/i, song: "entrance-song" },
  { title: /grand entrance|entrances?\b|introduc/i, song: "grand-entrance-song", announcement: "entrance-names" },
  { title: /parent|father|mother/i, song: "parent-dance-songs" },
  { title: /first dance/i, song: "first-dance-song" },
  { title: /toast|speech/i, announcement: "toast-order" },
  { title: /cake/i, song: "cake-cutting-song" },
  { title: /bouquet|garter/i, announcement: "bouquet-garter" },
  { title: /last dance/i, song: "last-dance-song" },
  { title: /exit|send.?off|sparkler/i, song: "exit-plan" },
];

type Line = { title: string; mc?: Partial<McScript> | null };

/**
 * The script filled from the couple's planner answers, for each line that
 * has nothing of its own yet. Returns the lines in the same order; a line
 * the studio already scripted is left as it is.
 */
export function fillMcScript<T extends Line>(items: readonly T[], answers: Readonly<Record<string, unknown>>): { items: T[]; filled: number } {
  let filled = 0;
  const next = items.map((item) => {
    if (mcScriptLine(item.mc)) return item;
    const rule = RULES.find((candidate) => candidate.title.test(item.title));
    if (!rule) return item;
    const mc = patchMcScript(null, {
      song: rule.song ? clean(answers[rule.song], 200) : null,
      announcement: rule.announcement ? clean(answers[rule.announcement], 600) : null,
    });
    if (!mc) return item;
    filled += 1;
    return { ...item, mc };
  });
  return { items: next, filled };
}
