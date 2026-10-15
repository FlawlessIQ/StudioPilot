/**
 * What the client's form page (components/client/kit/client-questionnaire.tsx)
 * calls the studio's forms.
 *
 * A vendor's one form goes by its own name (tradeVocab `detailsForm`: a hair
 * client's "Party list"), and a list of them is plain "forms", because the
 * event form from their inquiry page can sit beside it. Priya Shah's form
 * page (hair, Jess Styles Bridal; 2026-10-12) still said "Your
 * questionnaires", "All questionnaires" and "Questionnaire 2" once it held
 * two. A photographer's read exactly as they always have.
 *
 * Pure, so tests/vendor-portal-published-plan.test.ts can pin both.
 */
export type ClientFormWords = {
  /** The page's landmark name while no form is open. */
  page: string;
  /** The heading while nothing has been sent: "Your party list". */
  emptyTitle: string;
  loading: string;
  upcoming: string;
  /** The list of forms, once there are two or more. */
  listPage: string;
  listTitle: string;
  /** An unnamed form in the list, before its place: "Form 2". */
  listRow: string;
  backToList: string;
  /** An unnamed form, opened. */
  formName: string;
  couldNotOpen: string;
  /**
   * What an opened form goes by: its landmark, and what a message sent from
   * it is "About:". Null: the form's own name, since a vendor's may be their
   * inquiry page's event form rather than the party list.
   */
  formLabel: string | null;
};

export function clientFormWords(detailsForm: string | null | undefined): ClientFormWords {
  if (!detailsForm)
    return {
      page: "Questionnaire",
      emptyTitle: "Your questionnaire",
      loading: "Opening your questionnaire…",
      upcoming: "Your studio hasn’t sent a questionnaire yet. You’ll get an email when there’s one to fill out.",
      listPage: "Questionnaires",
      listTitle: "Your questionnaires",
      listRow: "Questionnaire",
      backToList: "All questionnaires",
      formName: "Planning questionnaire",
      couldNotOpen: "Your questionnaire couldn’t be opened. Refresh to try again.",
      formLabel: "Questionnaire",
    };
  // Initials stay: "your mitzvah music & MC planner".
  const word = detailsForm.replace(/\b[A-Z][a-z]+\b/g, (part) => part.toLowerCase());
  return {
    page: detailsForm,
    emptyTitle: `Your ${word}`,
    loading: `Opening your ${word}…`,
    upcoming: `Your studio hasn’t sent your ${word} yet. You’ll get an email when it’s ready to fill out.`,
    listPage: "Forms",
    listTitle: "Your forms",
    listRow: "Form",
    backToList: "All forms",
    formName: detailsForm,
    // The one open may be their inquiry page's event form, not the party list.
    couldNotOpen: "This form couldn’t be opened. Refresh to try again.",
    formLabel: null,
  };
}
