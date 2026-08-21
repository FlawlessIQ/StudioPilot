/**
 * What sort of thing is this, and what colour is that?
 *
 * The import studio worked out a good answer to the first question and kept
 * it to itself: a private constant mapping each import kind to a tinted
 * icon tile, so a contract, a questionnaire and a package could be told
 * apart at a glance. Those are not import concepts — they are the
 * product's nouns, and they appear in the Library, in the journey rail on
 * every project, in Documents, in Messages, in search. This module is that
 * map, promoted to somewhere the whole app can reach.
 *
 * Two rules hold it together:
 *
 * 1. **Colour answers "what kind of thing", never "how is it going".**
 *    State — done, waiting, late — is a separate axis with its own tokens
 *    (`--ds-forest` / `--ds-amber` / `--ds-danger`), and the two are never
 *    mixed on one element. A row may carry one kind tone and one state
 *    tone; it may not carry two of either.
 *
 * 2. **Five hues, not one per noun.** The product has far more nouns than
 *    a palette can hold, and six colours applied enthusiastically across
 *    forty screens is worse than the monochrome it replaces. Nouns group
 *    into five families that match how a photographer thinks about their
 *    week, and anything that does not belong to one stays neutral rather
 *    than being given a colour to look busy.
 *
 * Mint is deliberately absent. `--cue-mint` sits at hue 161°, one degree
 * from the live theme's primary accent (`--ds-claret` under `emerald`,
 * hue 160°), so a mint "package" tile is indistinguishable from a primary
 * action. Mint keeps the job it already does well — approved, verified,
 * nothing pending — which is a *state*, and a success state is supposed to
 * read as the same green as the primary. The codebase met this problem
 * once before: `--ds-forest` was shifted to teal-blue under the emerald
 * theme for exactly this reason.
 */

/** The five families, named for what they mean rather than their hue. */
export type KindFamily =
  /** Agreements and money: what is promised and what is owed. */
  | "agreement"
  /** What the studio needs back from the client. */
  | "client_input"
  /** Time and the people who fill it. */
  | "logistics"
  /** Anything that leaves the studio and reaches the couple. */
  | "outbound"
  /** Things that run without anyone pressing a button. */
  | "automation";

/** A tone utility class suffix — `.tone-violet` and friends. */
export type KindTone = "violet" | "gold" | "blue" | "coral" | "rose";

/**
 * Contrast measured against each tone's own soft tint: violet clears 4.5:1,
 * the other four clear 3:1 but not 4.5:1. So a tone may tint a tile and
 * colour a glyph, and may never set label text, a chip, or a border the
 * reader is meant to follow.
 */
export const familyTone: Record<KindFamily, KindTone> = {
  agreement: "violet",
  client_input: "gold",
  logistics: "blue",
  outbound: "coral",
  automation: "rose",
};

/**
 * Every noun the interface shows a glyph for.
 *
 * Adding one is a deliberate act: the test in `tests/library-kinds.test.ts`
 * fails if a kind has no family, so a new noun cannot quietly arrive
 * without someone deciding what it is.
 */
export type LibraryKind =
  // agreement
  | "contract"
  | "proposal"
  | "package"
  | "invoice"
  | "document"
  | "insurance"
  // client_input
  | "questionnaire"
  | "form"
  // logistics
  | "schedule"
  | "crew"
  | "calendar"
  | "event"
  | "venue"
  // outbound
  | "message"
  | "email"
  | "review"
  | "delivery"
  // automation
  | "workflow"
  | "automation"
  | "task";

const kindFamilies: Record<LibraryKind, KindFamily> = {
  contract: "agreement",
  proposal: "agreement",
  package: "agreement",
  invoice: "agreement",
  document: "agreement",
  // A certificate of insurance is a document a venue demands before it will
  // let you through the door — an agreement, not a logistics detail.
  insurance: "agreement",

  questionnaire: "client_input",
  form: "client_input",

  schedule: "logistics",
  crew: "logistics",
  calendar: "logistics",
  event: "logistics",
  venue: "logistics",

  message: "outbound",
  email: "outbound",
  review: "outbound",
  // The gallery is the whole point of the job, and it leaves the studio.
  delivery: "outbound",

  workflow: "automation",
  automation: "automation",
  task: "automation",
};

/** The family a noun belongs to. */
export function kindFamily(kind: LibraryKind): KindFamily {
  return kindFamilies[kind];
}

/** The tone utility suffix for a noun: `tone-${kindTone(kind)}`. */
export function kindTone(kind: LibraryKind): KindTone {
  return familyTone[kindFamilies[kind]];
}

/**
 * The tone for a value that may not be one of ours.
 *
 * Server records carry free-text asset types and step keys. An unrecognised
 * value gets no colour rather than a wrong one — neutral is always a
 * truthful answer, and a mis-assigned hue is not.
 */
export function toneForValue(value: string | null | undefined): KindTone | null {
  const kind = kindFromValue(value);
  return kind ? kindTone(kind) : null;
}

/**
 * The kind a foreign value names, or null.
 *
 * Callers that need an icon as well as a hue want the kind itself;
 * `toneForValue` is the thin wrapper for those that only need colour.
 */
export function kindFromValue(
  value: string | null | undefined,
): LibraryKind | null {
  if (!value) return null;
  const normalized = value.trim().toLowerCase();
  if (normalized in kindFamilies) return normalized as LibraryKind;
  return kindAliases[normalized] ?? null;
}

/**
 * The names the same nouns go by elsewhere in the system.
 *
 * Asset types from the import pipeline, journey step keys, and project
 * record types all name these things slightly differently. Rather than
 * teach every caller the vocabulary, they resolve through here.
 */
const kindAliases: Record<string, LibraryKind> = {
  // Import pipeline asset types.
  message_template: "message",
  timing_rule: "schedule",
  crew_preference: "crew",
  coi_instruction: "insurance",
  delivery_instruction: "delivery",
  review_request: "review",
  // Journey step keys.
  inquiry: "message",
  first_reply: "message",
  consultation: "calendar",
  retainer: "invoice",
  schedule_form: "questionnaire",
  run_of_show: "schedule",
  coi: "insurance",
  final_balance: "invoice",
  day_before: "schedule",
  event_day: "event",
  album_review: "review",
  // Plurals and near-misses that turn up in record types.
  contracts: "contract",
  proposals: "proposal",
  packages: "package",
  invoices: "invoice",
  documents: "document",
  questionnaires: "questionnaire",
  schedules: "schedule",
  messages: "message",
  reviews: "review",
  workflows: "workflow",
  tasks: "task",
  gallery: "delivery",
  questionnaire_response: "questionnaire",
  // AI capabilities — what the draft on the approval card is a draft *of*.
  message_draft: "message",
  inquiry_reply_draft: "message",
  delivery_message_draft: "delivery",
  review_request_draft: "review",
  consultation_summary: "calendar",
  package_recommendation: "package",
  proposal_draft: "proposal",
  contract_mapping: "contract",
  questionnaire_review: "questionnaire",
  schedule_draft: "schedule",
  coi_extraction: "insurance",
  crew_recommendation: "crew",
  inquiry_fact_extraction: "message",
  studio_workflow_inference: "workflow",
  studio_asset_classification: "document",
  studio_asset_extraction: "document",
  // project_risk_summary is about a job as a whole, not a record — no kind.
};

export { kindAliases };
