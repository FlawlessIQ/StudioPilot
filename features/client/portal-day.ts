/**
 * What an empty portal page says, and whether the day has been and gone.
 *
 * Four pages — payments, records, delivery, reviews — shared one block of
 * filler verbatim: "Nothing to complete yet", then "What happens next · Your
 * studio prepares this area · You'll be notified when it changes · Only
 * approved project details appear here." "Nothing to complete" was the wrong
 * verb three times out of four, and the last line was StudioCue reassuring
 * itself about its own data model.
 *
 * Two other pages in the same portal already did it right — the contract and
 * proposal pages say why they are empty, what that means, and what to do. This
 * gives the other four the same treatment, and makes it *date*-aware: nineteen
 * days after the wedding the delivery page said only "will appear after
 * delivery", on the one page whose question was "where are my photographs".
 *
 * There is no expected-delivery date anywhere the portal can read, so none is
 * invented. Past the day, the page says the work is in progress and how to ask.
 *
 * Pure. Dates are plain YYYY-MM-DD strings compared as strings, the same rule
 * the portal builder uses.
 */

export type PortalEmptyArea = "payments" | "documents" | "delivery" | "reviews";

export function eventHasPassed(
  eventDate: string | null | undefined,
  today: string | null | undefined,
): boolean {
  return Boolean(eventDate) && Boolean(today) && String(today) > String(eventDate);
}

export function portalEmptyNotice(
  area: PortalEmptyArea,
  passed: boolean,
): { title: string; detail: string } {
  switch (area) {
    case "payments":
      return passed
        ? {
            title: "Nothing to pay",
            detail:
              "There are no invoices on this project. If you were expecting a final balance, your studio will send it here — message them if you would like to check.",
          }
        : {
            title: "Nothing to pay yet",
            detail:
              "Your studio will send invoices here as your booking progresses, with the amount, the due date and a secure way to pay.",
          };
    case "documents":
      return passed
        ? {
            title: "No records yet",
            detail:
              "Your signed agreement, schedule and gallery link will be kept here once your studio adds them. Message them if you need a copy of anything now.",
          }
        : {
            title: "No records yet",
            detail:
              "As your booking progresses, your signed agreement, payments, schedule and gallery link are kept here for you to come back to.",
          };
    case "delivery":
      return passed
        ? {
            title: "Your photographs are being worked on",
            detail:
              "Your studio is editing and preparing your images. Your gallery will appear here, with a secure link, as soon as it is ready — message them if you would like to know when to expect it.",
          }
        : {
            title: "Your gallery will be here after the day",
            detail:
              "Once your studio has edited your photographs, the secure gallery link and download details appear on this page.",
          };
    case "reviews":
      return passed
        ? {
            title: "No review requested yet",
            detail:
              "Once your gallery is delivered, your studio may invite you to share your experience here.",
          }
        : {
            title: "Nothing to do here yet",
            detail:
              "After your photographs are delivered, your studio may invite you to leave a review.",
          };
  }
}
