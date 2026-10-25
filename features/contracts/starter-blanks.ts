import { tradeVocab } from "@/features/trades/trades";

/**
 * The blanks in a starting agreement (sample.ts), one at a time.
 *
 * Every starter is scaffolding: "## 3. Cancellation and rescheduling" over
 * "[Replace with your own cancellation and rescheduling terms.]". Saving one
 * is refused while any "[Replace with" is left (functions/src/contracts/
 * commands.ts), and the only way to clear them was to find each in a
 * 30-line textarea and write terms from nothing. A new studio could not
 * finish setup's "How do your clients sign?" in one sitting (onboarding
 * assessment, 2026-10-24).
 *
 * So each blank becomes a question with a plain example to start from. The
 * examples are common terms written for the studio to read and change, never
 * filled in for them: the studio picks one, edits it, and puts it in.
 */
export type StarterBlank = {
  /** Stable while the text around it doesn't change: its position among the blanks. */
  index: number;
  /** The section it sits under, without its number: "Cancellation and rescheduling". */
  heading: string | null;
  /** What the starter says to put there, without the brackets. */
  hint: string;
  /** The bracketed text exactly as it is in the agreement. */
  raw: string;
  start: number;
  end: number;
  /** The blank is the section's whole body, so the section can be left out. */
  wholeSection: boolean;
};

/**
 * A starter's blanks: "[Replace with …]", and a planner's inline "[your
 * overtime rate]" and "[If you do, say from whom and how much.]". A studio's
 * own brackets ("[sic]", "[Client name]") are left alone.
 */
const BLANK = /\[(Replace with[^\]\n]*|[Yy]our [^\]\n]*|If you [^\]\n]*)\]/g;
const HEADING = /^#{1,3}\s+(.+)$/;

export function starterBlanks(body: string): StarterBlank[] {
  const blanks: StarterBlank[] = [];
  for (const match of body.matchAll(BLANK)) {
    const start = match.index ?? 0;
    const end = start + match[0].length;
    const lineStart = body.lastIndexOf("\n", start - 1) + 1;
    const lineEnd = body.indexOf("\n", end);
    const line = body.slice(lineStart, lineEnd === -1 ? body.length : lineEnd).trim();
    blanks.push({
      index: blanks.length,
      heading: headingBefore(body, lineStart),
      hint: match[1]!.replace(/^Replace with\s+/i, "").replace(/\.$/, ""),
      raw: match[0],
      start,
      end,
      wholeSection: line === match[0] && headingBefore(body, lineStart) !== null && sectionBodyIs(body, lineStart),
    });
  }
  return blanks;
}

/** The nearest heading above a position, without its "3. " number. */
function headingBefore(body: string, position: number): string | null {
  const lines = body.slice(0, position).split("\n");
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const heading = HEADING.exec(lines[index]!.trim());
    if (heading) return heading[1]!.replace(/^\d+[.)]\s*/, "").trim();
  }
  return null;
}

/**
 * Whether the line at `lineStart` comes straight under its heading: the
 * section's body is the blank. (The last section is followed by the
 * agreement's closing line, so what comes after doesn't decide it.)
 */
function sectionBodyIs(body: string, lineStart: number): boolean {
  const before = body.slice(0, lineStart).split("\n");
  before.pop();
  while (before.length && !before[before.length - 1]!.trim()) before.pop();
  return HEADING.test(before[before.length - 1]?.trim() ?? "");
}

/**
 * The agreement with one blank replaced by the studio's words. Nothing in an
 * inline blank removes it and the space before it: "no referral fees."
 */
export function fillStarterBlank(body: string, blank: StarterBlank, text: string): string {
  if (body.slice(blank.start, blank.end) !== blank.raw) return body;
  const words = text.trim();
  const start = !words && body.charAt(blank.start - 1) === " " ? blank.start - 1 : blank.start;
  return `${body.slice(0, start)}${words}${body.slice(blank.end)}`;
}

/**
 * The agreement without a whole-section blank's section, its later sections
 * numbered on: leaving out "4. Image use" makes "5. Limitation" the new 4.
 */
export function leaveOutStarterSection(body: string, blank: StarterBlank): string {
  if (!blank.wholeSection || body.slice(blank.start, blank.end) !== blank.raw) return body;
  const lines = body.split("\n");
  let offset = 0;
  let blankLine = -1;
  for (let index = 0; index < lines.length; index += 1) {
    if (offset <= blank.start && blank.start <= offset + lines[index]!.length) {
      blankLine = index;
      break;
    }
    offset += lines[index]!.length + 1;
  }
  if (blankLine < 0) return body;
  let headingLine = blankLine - 1;
  while (headingLine >= 0 && !HEADING.test(lines[headingLine]!.trim())) headingLine -= 1;
  if (headingLine < 0) return body;
  let next = blankLine + 1;
  while (next < lines.length && !lines[next]!.trim()) next += 1;
  const kept = [...lines.slice(0, headingLine), ...lines.slice(next)];
  return renumberSections(kept.join("\n"));
}

/** "## 5. Limitation" → "## 4. Limitation" once a section above has gone. */
function renumberSections(body: string): string {
  let number = 0;
  return body
    .split("\n")
    .map((line) => {
      const match = /^(#{1,3}\s+)(\d+)([.)]\s*)(.*)$/.exec(line);
      if (!match) return line;
      number += 1;
      return `${match[1]}${number}${match[3]}${match[4]}`;
    })
    .join("\n");
}

export type StarterQuestion = {
  /** What the blank asks, in the studio's words. */
  ask: string;
  /** Common terms to start from, or none where only the studio knows (a rate). */
  example: string | null;
  /** A short answer (a rate, an area) rather than a paragraph. */
  short: boolean;
  /** An inline blank that can simply go ("If you do, say from whom"). */
  optional?: boolean;
};

/**
 * The question and example for a blank. `trade` sets the word for the payment
 * that books the date — a photographer's retainer, a DJ's deposit — so an
 * example never names it two ways (document.ts depositWordingClash).
 */
export function starterQuestion(blank: StarterBlank, trade: unknown): StarterQuestion {
  const deposit = tradeVocab(trade).deposit;
  const section = (blank.heading ?? "").toLowerCase();
  const hint = blank.hint.toLowerCase();
  if (!blank.wholeSection) {
    if (hint.startsWith("if you do")) {
      return {
        ask: "Do you take referral fees from vendors? If so, say from whom and how much.",
        example: null,
        short: false,
        optional: true,
      };
    }
    return { ask: `${capitalise(blank.hint)}?`, example: null, short: true };
  }
  if (section.includes("cancellation") && section.includes("rescheduling")) {
    return {
      ask: "What happens if the client cancels or moves the date?",
      example: `The ${deposit} is non-refundable once the date is reserved. If the Client cancels, payments already made are kept and nothing more is owed. If the Client needs to move the date, the booking moves once at no charge to a new date the Studio has free, and the ${deposit} moves with it.`,
      short: false,
    };
  }
  if (section.includes("image use") || section.includes("copyright")) {
    return {
      ask: "Who owns the photos, and how can each of you use them?",
      example:
        "The Studio owns the copyright in every image. The Client may print, share and post the images for personal use, but may not sell them or license them to anyone else. The Studio may show the images in its portfolio, on its website and on social media, unless the Client asks it not to in writing before the event.",
      short: false,
    };
  }
  if (section.includes("equipment")) {
    return {
      ask: "What do you need from the venue, and who looks after your equipment?",
      example:
        "The Client makes sure the venue lets the Studio load in at least two hours before guests arrive, with two grounded outlets near the setup. The Studio follows the venue's sound limits. The Client is responsible for damage to the Studio's equipment caused by guests.",
      short: false,
    };
  }
  if (section.includes("minimum")) {
    return {
      ask: "What's your booking minimum, and how does the party size work?",
      example:
        "The booking minimum is the total fee above. People can be added after the final headcount if time allows, but not taken off.",
      short: false,
    };
  }
  if (section.includes("morning")) {
    return {
      ask: "What do you need on the day, and do you charge for early starts or running late?",
      example:
        "The Client provides a table and chair near a window, an outlet, and a quiet room to work in. A start before 7:00 AM carries an early-start fee, and time beyond the schedule is charged by the half hour.",
      short: false,
    };
  }
  if (section === "trial" || section.includes("trial")) {
    return {
      ask: "How does your trial work, and what does it cost?",
      example: "The trial is paid when it is booked, and its fee is taken off the balance.",
      short: false,
    };
  }
  if (section.includes("allerg") || section.includes("skin")) {
    return {
      ask: "What should clients tell you about allergies or sensitive skin?",
      example:
        "The Client tells the Studio about any allergies or skin sensitivities, for everyone booked, before the event day. A patch test is available on request. The Studio is not responsible for a reaction to a product it was not told to avoid.",
      short: false,
    };
  }
  if (section.includes("no-show") || section.includes("cancellation")) {
    return {
      ask: "What happens if the client cancels, or someone booked doesn't sit?",
      example: `The ${deposit} is non-refundable. Anyone booked who doesn't sit for their appointment is charged in full. If the Client cancels, payments already made are kept and nothing more is owed.`,
      short: false,
    };
  }
  if (section.includes("liability")) {
    return {
      ask: "What are you responsible for if something goes wrong?",
      example:
        "If the Studio cannot provide the services because of illness, an emergency or events outside its control, it will try to send a qualified replacement. If it cannot, it refunds every payment made, and that refund is the most it owes. The Studio's liability for any claim is limited to the amount the Client has paid under this agreement.",
      short: false,
    };
  }
  return { ask: `${capitalise(blank.hint)}.`, example: null, short: false };
}

function capitalise(text: string): string {
  return text ? `${text.charAt(0).toUpperCase()}${text.slice(1)}` : text;
}
