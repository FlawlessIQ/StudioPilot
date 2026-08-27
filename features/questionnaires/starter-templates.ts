/**
 * The questionnaires a studio starts with.
 *
 * The same argument as `features/workflows/starter-templates.ts`, and it lands
 * harder here. A workflow template is a list of checkpoint names; a
 * questionnaire is twenty pieces of *wording* aimed at a couple, and asking a
 * photographer to compose that before their first client is asking them to do
 * copywriting to use the product. Until this existed a new tenant had no
 * questionnaire at all, so "Questionnaire complete" — a blocking readiness
 * checkpoint — could only ever be waived.
 *
 * Three templates, one per event type, matching the shape
 * `autoInstantiateWorkflow` and `assignQuestionnaire` already resolve by.
 * Active on day one, and editable: `updateQuestionnaireTemplate` supersedes
 * with a new version rather than rewriting one a couple has already answered.
 *
 * The wedding set is the one the demo studio has used since the seed was
 * rewritten — six sections in the order a couple thinks about their day. It was
 * always the good answer; it was only ever shown to people looking at a demo.
 *
 * Duplicated at functions/src/planning/starter-questionnaires.ts, which cannot
 * import from features/. `tests/starter-questionnaires.test.ts` fails on drift.
 */

export type StarterField = {
  id: string;
  label: string;
  type: string;
  required: boolean;
  locked: boolean;
  internalOnly: boolean;
  options: string[];
  conditionalOn: null;
};

export type StarterSection = {
  id: string;
  title: string;
  fields: StarterField[];
};

export type StarterQuestionnaire = {
  name: string;
  eventTypeId: string;
  dueDaysBeforeEvent: number;
  reminderDaysBeforeDue: number[];
  sections: StarterSection[];
};

/** id, label, type, required, options. */
type Def = readonly [string, string, string, boolean, ...string[]];

const field = (definition: Def): StarterField => {
  const [id, label, type, required, ...options] = definition;
  return {
    id,
    label,
    type,
    required,
    locked: false,
    internalOnly: false,
    options: [...options],
    conditionalOn: null,
  };
};

const section = (
  id: string,
  title: string,
  definitions: readonly Def[],
): StarterSection => ({ id, title, fields: definitions.map(field) });

const WEDDING: readonly StarterSection[] = [
  section("couple", "Couple details", [
    ["partner-one", "First partner's full name", "text", true],
    ["partner-two", "Second partner's full name", "text", true],
    ["day-of-contact", "Who should we call on the day?", "contact", true],
    ["preferred-email", "Best email for the gallery", "email", true],
  ]),
  section("venue", "Venue and getting ready", [
    ["ceremony-address", "Ceremony address", "address", true],
    ["reception-address", "Reception address", "address", true],
    ["getting-ready", "Where are you getting ready?", "long_text", false],
    ["first-look", "Are you planning a first look?", "radio", true, "Yes", "No", "Undecided"],
  ]),
  section("vendors", "Other vendors", [
    ["planner", "Planner or coordinator", "text", false],
    ["videographer", "Videographer", "text", false],
    ["florist", "Florist", "text", false],
  ]),
  section("family", "Family photographs", [
    ["must-have-groups", "Groups we must photograph", "repeating_group", true],
    ["sensitivities", "Anything we should handle carefully", "long_text", false],
  ]),
  section("timeline", "Timeline", [
    ["ceremony-time", "Ceremony start time", "time", true],
    ["sunset-priority", "How important are sunset portraits?", "dropdown", true, "Essential", "Nice to have", "Not a priority"],
    ["end-time", "When does coverage end?", "time", true],
  ]),
  section("access", "Access and consent", [
    ["accessibility", "Accessibility needs for our team to know about", "long_text", false],
    ["restrictions", "Any photography restrictions at the venue?", "long_text", false],
    ["social-consent", "May we share images on social media?", "acknowledgement", true],
    ["guest-count", "Expected guest count", "text", true],
  ]),
];

/**
 * A corporate shoot answers to a company, not a couple: the questions are about
 * approvals, brand rules and who can be photographed.
 */
const CORPORATE: readonly StarterSection[] = [
  section("client", "Who we are working with", [
    ["company", "Company name", "text", true],
    ["billing-contact", "Billing contact", "contact", true],
    ["on-site-contact", "Who meets us on the day?", "contact", true],
    ["approver", "Who signs off on the final selection?", "text", true],
  ]),
  section("logistics", "Location and access", [
    ["address", "Shoot address", "address", true],
    ["access-notes", "Building access, security or passes we need", "long_text", false],
    ["load-in", "Load-in time", "time", false],
    ["power", "Is there power where we are shooting?", "radio", false, "Yes", "No", "Not sure"],
  ]),
  section("scope", "What the images are for", [
    ["usage", "Where will these be used?", "multi_select", true, "Website", "Social", "Print", "Press", "Internal"],
    ["shot-priorities", "The shots that matter most", "long_text", true],
    ["brand-guidelines", "Brand guidelines or references", "long_text", false],
  ]),
  section("people", "People and consent", [
    ["headcount", "How many people are being photographed?", "text", true],
    ["consent-obtained", "Has everyone agreed to be photographed?", "acknowledgement", true],
    ["no-photo-list", "Anyone who must not appear", "long_text", false],
  ]),
];

/**
 * Sports is organiser-led, and the answers that matter are about minors,
 * rosters and where the team will actually be.
 */
const SPORTS: readonly StarterSection[] = [
  section("organisation", "Organisation", [
    ["organisation", "Club, league or school", "text", true],
    ["primary-contact", "Primary contact", "contact", true],
    ["day-contact", "Who meets us at the venue?", "contact", true],
  ]),
  section("event", "The day", [
    ["venue-address", "Venue address", "address", true],
    ["arrival-time", "When should we arrive?", "time", true],
    ["schedule", "Running order, if you have one", "long_text", false],
    ["weather-plan", "Wet-weather plan", "long_text", false],
  ]),
  section("participants", "Participants", [
    ["headcount", "How many participants?", "text", true],
    ["teams", "Teams or groups to photograph separately", "repeating_group", false],
    ["minors-present", "Will anyone under 18 be photographed?", "radio", true, "Yes", "No"],
    ["consent-on-file", "Do you hold photography consent for all participants?", "acknowledgement", true],
    ["no-photo-list", "Anyone who must not appear", "long_text", false],
  ]),
];

export function starterQuestionnaires(): StarterQuestionnaire[] {
  return [
    {
      name: "Wedding Planning Questionnaire",
      eventTypeId: "wedding",
      // Six weeks out: late enough that the couple has decided, early enough
      // that the run of show can still be built from the answers.
      dueDaysBeforeEvent: 45,
      reminderDaysBeforeDue: [14, 3],
      sections: [...WEDDING],
    },
    {
      name: "Corporate Shoot Brief",
      eventTypeId: "corporate",
      dueDaysBeforeEvent: 21,
      reminderDaysBeforeDue: [7, 2],
      sections: [...CORPORATE],
    },
    {
      name: "Sports Day Brief",
      eventTypeId: "sports",
      dueDaysBeforeEvent: 21,
      reminderDaysBeforeDue: [7, 2],
      sections: [...SPORTS],
    },
  ];
}
