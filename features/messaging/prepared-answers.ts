/**
 * Prepared answers — the questions StudioCue can answer without a model.
 *
 * A client asked "How do I pay ?" while the project held a standing retainer
 * invoice with an amount, a due date and a payment link. The complete answer was
 * structured data, and the product still put a model and six interface steps
 * between the studio owner and sending it.
 *
 * So: recognise the handful of questions that recur, compose the answer from
 * verified project facts, and have it waiting. No model, no quota, no latency,
 * and nothing that can invent a figure — the numbers come from the same records
 * the invoice does.
 *
 * The model still matters. It handles what needs judgement, which is what it is
 * good at. This module exists so it stops being asked to paraphrase an invoice.
 *
 * Deliberately conservative. Every function here would rather return null than
 * answer a question it has only partly understood: a confidently wrong reply to
 * a client costs the studio more than no reply at all.
 */

export const preparedAnswerIntents = [
  "payment",
  "balance",
  "arrival_time",
  "gallery_delivery",
] as const;
export type PreparedAnswerIntent = (typeof preparedAnswerIntents)[number];

/**
 * Facts drawn from the project. Every field is nullable because the composer's
 * job is to notice when it does not have what an answer needs.
 */
export type PreparedAnswerFacts = {
  studioName: string;
  clientFirstName: string | null;
  projectName: string | null;
  /** ISO date of the event, if one is set. */
  eventDate: string | null;
  /** The standing invoice — superseded and refused ones must not reach here. */
  invoice: {
    balanceCents: number;
    currency: string;
    dueDate: string | null;
    hostedUrl: string | null;
  } | null;
  /**
   * True when more than one invoice is still outstanding.
   *
   * The gatherer used to take the first standing invoice with a balance, so a
   * job carrying a $1.00 invoice and a $571 invoice told the client "$1.00
   * outstanding" and gave them the link for it. One figure and one link cannot
   * describe two debts, so the composer declines and a person writes it.
   */
  multipleOutstandingInvoices?: boolean;
  /** Studio arrival, from an approved or published schedule only. */
  arrivalTime: string | null;
  gallery: { url: string; ready: boolean } | null;
};

export type PreparedAnswer = {
  intent: PreparedAnswerIntent;
  subject: string;
  body: string;
  /** Named so a studio can see what the answer was built from before sending. */
  basedOn: string[];
};

/**
 * Phrases that identify a question, grouped by intent. Matching is on the whole
 * message, lowercased, so "how do i pay?" and "How do I pay ?" both land.
 */
const intentPatterns: Array<{ intent: PreparedAnswerIntent; patterns: RegExp[] }> = [
  {
    intent: "payment",
    patterns: [
      /\bhow (?:do|can) (?:i|we) pay\b/,
      /\bhow (?:do|can) (?:i|we) (?:make|send) (?:the |a )?payment\b/,
      /\bwhere (?:do|can) (?:i|we) pay\b/,
      /\bpay(?:ment)? link\b/,
      /\bhow to pay\b/,
    ],
  },
  {
    intent: "balance",
    patterns: [
      /\bhow much (?:do|does) (?:i|we) (?:still )?owe\b/,
      /\bwhat(?:'s| is) (?:my|our|the) balance\b/,
      /\bhow much is (?:left|outstanding|due)\b/,
      /\bwhat (?:do|does) (?:i|we) still owe\b/,
    ],
  },
  {
    intent: "arrival_time",
    patterns: [
      /\bwhat time (?:do|will) you (?:arrive|get (?:there|here)|start)\b/,
      /\bwhen (?:do|will) you (?:arrive|get (?:there|here))\b/,
      /\bwhat time are you (?:arriving|starting)\b/,
    ],
  },
  {
    intent: "gallery_delivery",
    patterns: [
      /\bwhen (?:will|do) (?:i|we) (?:get|receive|see) (?:the |our |my )?(?:photos|pictures|images|gallery)\b/,
      /\bare (?:the |our |my )?(?:photos|pictures|images) ready\b/,
      /\bwhere (?:are|is) (?:the |our |my )?(?:photos|pictures|images|gallery)\b/,
      /\bgallery link\b/,
    ],
  },
];

/** Sentences that clearly ask for a decision rather than a fact. */
const needsJudgement = [
  /\b(?:can|could) (?:we|you|i) (?:change|move|switch|swap|add|cancel|reschedule)\b/,
  /\b(?:is it|would it be) (?:possible|ok|okay)\b/,
  /\bwhat (?:do you think|would you (?:suggest|recommend))\b/,
  /\bwe(?:'re| are) thinking\b/,
  /\binstead of\b/,
];

/**
 * Which single question this message asks, or null.
 *
 * Null on purpose in three cases, each of which would otherwise produce a reply
 * that reads as though the studio had not read the message:
 *
 * - nothing recognised;
 * - more than one intent, because answering one and ignoring the other is worse
 *   than answering neither;
 * - anything asking for a decision, even alongside a factual question — "How do
 *   I pay? Also can we move the ceremony?" needs a person, and the payment
 *   sentence must not trigger a reply that silently drops the second half.
 */
export function classifyClientQuestion(body: string): PreparedAnswerIntent | null {
  const text = body.toLowerCase().replace(/\s+/g, " ").trim();
  if (!text) return null;
  // A long message is a conversation, not a lookup, whatever phrases it contains.
  if (text.length > 600) return null;
  if (needsJudgement.some((pattern) => pattern.test(text))) return null;

  const matched = intentPatterns
    .filter(({ patterns }) => patterns.some((pattern) => pattern.test(text)))
    .map(({ intent }) => intent);

  const distinct = [...new Set(matched)];
  return distinct.length === 1 ? (distinct[0] ?? null) : null;
}

function money(cents: number, currency: string): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: currency || "USD",
  }).format(cents / 100);
}

function longDate(value: string): string {
  const date = new Date(value.length <= 10 ? `${value}T12:00:00Z` : value);
  return Number.isNaN(date.valueOf())
    ? value
    : new Intl.DateTimeFormat("en-US", {
        dateStyle: "long",
        timeZone: "UTC",
      }).format(date);
}

function greeting(facts: PreparedAnswerFacts): string {
  return facts.clientFirstName ? `Hi ${facts.clientFirstName},` : "Hello,";
}

/**
 * Compose the answer, or null when the facts needed are not there.
 *
 * Returning null is the important half. A studio would rather write two
 * sentences itself than have StudioCue send a client a payment link that is out
 * of date, or an arrival time from a schedule nobody has approved.
 */
export function composePreparedAnswer(
  intent: PreparedAnswerIntent,
  facts: PreparedAnswerFacts,
): PreparedAnswer | null {
  const project = facts.projectName ? ` for ${facts.projectName}` : "";

  if (intent === "payment" || intent === "balance") {
    const invoice = facts.invoice;
    if (!invoice) return null;
    // Two open invoices cannot be summarised as one amount with one link, and
    // understating what a client owes is worse than not answering.
    if (facts.multipleOutstandingInvoices) return null;

    // Nothing outstanding is a real answer, and a better one than a link.
    if (invoice.balanceCents <= 0) {
      return {
        intent,
        subject: "Your payment",
        body: [
          greeting(facts),
          `You're all paid up${project} — there's nothing outstanding at the moment. I'll let you know if anything else comes due.`,
          `— ${facts.studioName}`,
        ].join("\n\n"),
        basedOn: ["Invoice balance is zero"],
      };
    }

    // A balance with no way to pay it is not an answer to "how do I pay".
    if (intent === "payment" && !invoice.hostedUrl) return null;

    const amount = money(invoice.balanceCents, invoice.currency);
    const due = invoice.dueDate ? ` It's due by ${longDate(invoice.dueDate)}.` : "";
    const basedOn = [`Outstanding balance ${amount}`];
    if (invoice.dueDate) basedOn.push(`Due ${longDate(invoice.dueDate)}`);

    if (intent === "balance") {
      const link = invoice.hostedUrl
        ? `\n\nYou can pay it here: ${invoice.hostedUrl}`
        : "";
      if (invoice.hostedUrl) basedOn.push("Secure payment link on the invoice");
      return {
        intent,
        subject: "Your balance",
        body: [
          greeting(facts),
          `You have ${amount} outstanding${project}.${due}${link}`,
          `— ${facts.studioName}`,
        ].join("\n\n"),
        basedOn,
      };
    }

    basedOn.push("Secure payment link on the invoice");
    return {
      intent,
      subject: "How to pay",
      body: [
        greeting(facts),
        `You can pay securely here: ${invoice.hostedUrl}`,
        `That covers the ${amount} outstanding${project}.${due}`,
        `— ${facts.studioName}`,
      ].join("\n\n"),
      basedOn,
    };
  }

  if (intent === "arrival_time") {
    // Only from a schedule the studio has approved. An arrival time from a draft
    // is a promise nobody made.
    if (!facts.arrivalTime) return null;
    return {
      intent,
      subject: "What time we arrive",
      body: [
        greeting(facts),
        facts.eventDate
          ? `We'll arrive at ${facts.arrivalTime} on ${longDate(facts.eventDate)}.`
          : `We'll arrive at ${facts.arrivalTime}.`,
        `— ${facts.studioName}`,
      ].join("\n\n"),
      basedOn: [
        `Arrival ${facts.arrivalTime} from the approved schedule`,
        ...(facts.eventDate ? [`Event date ${longDate(facts.eventDate)}`] : []),
      ],
    };
  }

  if (intent === "gallery_delivery") {
    const gallery = facts.gallery;
    // Before delivery there is no honest date to give, so this stays with the
    // studio rather than inventing "a few weeks".
    if (!gallery?.ready || !gallery.url) return null;
    return {
      intent,
      subject: "Your gallery",
      body: [
        greeting(facts),
        `Your gallery${project} is ready: ${gallery.url}`,
        `— ${facts.studioName}`,
      ].join("\n\n"),
      basedOn: ["Gallery delivered and link available"],
    };
  }

  return null;
}

/** Classify and compose in one step, for the arrival path. */
export function prepareAnswerFor(
  body: string,
  facts: PreparedAnswerFacts,
): PreparedAnswer | null {
  const intent = classifyClientQuestion(body);
  return intent ? composePreparedAnswer(intent, facts) : null;
}
