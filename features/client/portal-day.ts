import { tradeProfile } from "@/features/trades/trades";

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
 *
 * A DJ, a makeup artist or a hair stylist delivers nothing after the day
 * (tradeProfile `delivery`), so their client is never told about a gallery
 * link or photos on the way. Omitted, the trade reads as a photographer's.
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
  /** The studio's trade (features/trades). */
  trade?: unknown,
): { title: string; detail: string } {
  const delivers = tradeProfile(trade).delivery;
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
      if (!delivers)
        return passed
          ? {
              title: "No records yet",
              detail:
                "Your signed agreement and schedule will be kept here once your studio adds them. Message them if you need a copy of anything now.",
            }
          : {
              title: "No records yet",
              detail:
                "As your booking progresses, your signed agreement, payments and schedule are kept here for you to come back to.",
            };
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
      // Nothing comes after the day for these trades; the page says so plainly
      // rather than promising something that will never arrive.
      if (!delivers)
        return passed
          ? {
              title: "Nothing to deliver",
              detail:
                "Your studio's work was on the day itself, so nothing is sent afterwards. Message them if you were expecting something.",
            }
          : {
              title: "Nothing to collect after the day",
              detail:
                "Everything your studio does happens on the day itself. Message them if you were expecting something to be sent afterwards.",
            };
      return passed
        ? {
            // Not "photographs": a video-led studio's couple is waiting on a film.
            title: "Your delivery is being worked on",
            detail:
              "Your studio is editing. Your photos (and film, if it's part of your package) will appear here with their links as soon as they're ready — message them if you would like to know when to expect them.",
          }
        : {
            title: "Your photos will be here after the day",
            detail:
              "Once your studio has edited them, the links and access details for your photos (and film, if it's part of your package) appear on this page.",
          };
    case "reviews":
      if (!delivers)
        return passed
          ? {
              title: "No review requested yet",
              detail: "Now the day is done, your studio may invite you to share your experience here.",
            }
          : {
              title: "Nothing to do here yet",
              detail: "After the day, your studio may invite you to leave a review.",
            };
      return passed
        ? {
            title: "No review requested yet",
            detail:
              "Once your photos are delivered, your studio may invite you to share your experience here.",
          }
        : {
            title: "Nothing to do here yet",
            detail:
              "After your photos are delivered, your studio may invite you to leave a review.",
          };
  }
}
