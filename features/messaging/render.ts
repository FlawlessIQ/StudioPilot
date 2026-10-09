import { tradeProfile, tradeVocab } from "@/features/trades/trades";
import { isJobKind, vocab } from "@/features/job-kinds/job-kinds";
import type {
  MessageDraftOutput,
  MessageTrigger,
} from "@/features/messaging/schema";
import { packageNameList } from "@/features/messaging/final-balance-facts";

/**
 * Deterministic draft rendering for lifecycle messages.
 *
 * These bodies are template-filled from verified facts — money, dates, and
 * links are computed by the caller, never by a model. AI personalization is
 * OPTIONAL on top; the deterministic version is always a valid, sendable
 * draft, which is what makes the lifecycle scheduler reliable.
 */

export type LifecycleFacts = {
  studioName: string;
  clientFirstName: string | null;
  projectName: string;
  eventDate: string | null;
  venueName: string | null;
  /** Integer cents, computed deterministically upstream. */
  packageTotalCents: number | null;
  /** Everything paid on bills still standing — the retainer and any earlier final. */
  retainerPaidCents: number | null;
  balanceDueCents: number | null;
  /**
   * Every package on the job (finalBalanceFacts). The notice named none and
   * quoted the photo package alone on a photo + video wedding.
   */
  packageNames?: string[];
  /** False when no bill stands at all, so "paid so far" needs checking. */
  paymentsOnRecord?: boolean;
  scheduleUrl: string | null;
  /** The job's kind (job-kinds.ts): wedding words only for a wedding. */
  eventKind?: string | null;
  /** The studio's trade (trades.ts): a DJ's couple gets a DJ's checklist. */
  trade?: string | null;
  recipientEmail: string | null;
  recipientName: string | null;
};

const money = (cents: number): string =>
  `$${(cents / 100).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;

const greeting = (facts: LifecycleFacts): string =>
  facts.clientFirstName ? `Hi ${facts.clientFirstName},` : "Hi there,";

export function renderLifecycleDraft(
  trigger: Extract<
    MessageTrigger,
    "schedule_confirmation" | "final_invoice_notice" | "day_before_checklist"
  >,
  facts: LifecycleFacts,
): MessageDraftOutput {
  const missing: string[] = [];
  if (!facts.recipientEmail) missing.push("Client email address");

  if (trigger === "schedule_confirmation") {
    if (!facts.scheduleUrl) missing.push("Published schedule link");
    /**
     * A DJ's, makeup artist's or hair stylist's client has nothing to approve
     * (trades.ts `journey.scheduleApproval`): a month out they hear about
     * the plan, and are not asked to check every time. Their one ask then is
     * the final headcount or the final planning call.
     */
    if (!tradeProfile(facts.trade).journey.scheduleApproval) {
      const words = tradeVocab(facts.trade);
      const Plan = words.planOfDay ?? "Plan";
      const plan = `${Plan.charAt(0).toLowerCase()}${Plan.slice(1)}`;
      const day = words.dayName.replace(/^the /i, "").toLowerCase();
      return {
        subject: `Your ${plan} for ${facts.projectName}`,
        body: [
          greeting(facts),
          "",
          `Your ${facts.eventDate ?? "event"} is a month away! Here's the plan for your ${day}, so you have it — there's nothing you need to do.`,
          facts.scheduleUrl
            ? `You can always see the latest version here: ${facts.scheduleUrl}`
            : "",
          "",
          "If anything changes on your side, just reply and we'll update it.",
          "",
          `— ${facts.studioName}`,
        ]
          .filter((line, index, lines) => line !== "" || lines[index - 1] !== "")
          .join("\n"),
        recipientEmail: facts.recipientEmail,
        recipientName: facts.recipientName,
        highlights: [`The ${plan}`, "One month before the event"],
        missingInformation: missing,
      };
    }
    return {
      subject: `Confirming your ${facts.projectName} timeline`,
      body: [
        greeting(facts),
        "",
        `Your ${facts.eventDate ?? "event"} is a month away — exciting! Attached is the current day-of schedule so you can double-check every time.`,
        facts.scheduleUrl
          ? `You can always see the latest version here: ${facts.scheduleUrl}`
          : "",
        "",
        facts.eventKind === "wedding"
          ? "If ceremony, reception, or prep times have changed at all, just reply and we'll update the plan."
          : "If any times or places have changed at all, just reply and we'll update the plan.",
        "",
        `— ${facts.studioName}`,
      ]
        .filter((line, index, lines) => line !== "" || lines[index - 1] !== "")
        .join("\n"),
      recipientEmail: facts.recipientEmail,
      recipientName: facts.recipientName,
      highlights: ["Schedule reconfirmation", "One month before the event"],
      missingInformation: missing,
    };
  }

  if (trigger === "final_invoice_notice") {
    if (facts.balanceDueCents === null) missing.push("Computed final balance");
    if (facts.paymentsOnRecord === false)
      missing.push("No payment is recorded on this job yet — confirm what they have paid before sending");
    const names = packageNameList(facts.packageNames ?? []);
    const amounts =
      facts.packageTotalCents !== null &&
      facts.retainerPaidCents !== null &&
      facts.balanceDueCents !== null
        ? `${names ? `Your total for ${names}` : "Your total"} is ${money(facts.packageTotalCents)}. With ${money(facts.retainerPaidCents)} paid so far, the balance is ${money(facts.balanceDueCents)} (plus any applicable sales tax).`
        : "Your final balance is being prepared.";
    return {
      subject: `Final balance for ${facts.projectName}`,
      body: [
        greeting(facts),
        "",
        `With ${facts.projectName} a month out, here's the final balance summary:`,
        "",
        amounts,
        "",
        "The invoice will arrive separately with payment instructions. Reply with any questions at all.",
        "",
        `— ${facts.studioName}`,
      ].join("\n"),
      recipientEmail: facts.recipientEmail,
      recipientName: facts.recipientName,
      highlights: ["Deterministic balance math", "Invoice follows separately"],
      missingInformation: missing,
    };
  }

  // A DJ's couple has no dress to hang up for the DJ: their own checklist
  // (trades.ts `dayBefore`). A photographer's stays as it was.
  const own = tradeVocab(facts.trade).dayBefore;
  if (own) {
    return {
      subject: `Tomorrow's the day! A quick checklist`,
      body: [
        greeting(facts),
        "",
        `We are so excited for ${facts.projectName} tomorrow${facts.venueName ? ` at ${facts.venueName}` : ""}. It's going to be a great night.`,
        "",
        own.ask,
        "",
        ...own.items.map((item) => `• ${item.charAt(0).toUpperCase()}${item.slice(1)}`),
        "",
        "See you tomorrow!",
        "",
        `— ${facts.studioName}`,
      ].join("\n"),
      recipientEmail: facts.recipientEmail,
      recipientName: facts.recipientName,
      highlights: ["Day-before checklist", "Last song changes and load-in"],
      missingInformation: missing,
    };
  }

  // A family session, a team day or a corporate event has no dress or rings
  // to get ready: the kind's own list (job-kinds.ts `dayBeforeChecklist`).
  // A wedding, or a job from before kinds, keeps the wedding's below.
  const kind = isJobKind(facts.eventKind) && facts.eventKind !== "wedding" ? facts.eventKind : null;
  if (kind) {
    return {
      subject: `See you tomorrow! A quick checklist`,
      body: [
        greeting(facts),
        "",
        `We're looking forward to ${facts.projectName} tomorrow${facts.venueName ? ` at ${facts.venueName}` : ""}.`,
        "",
        "One small ask so we can start on time — please have these ready when we arrive:",
        "",
        ...vocab(kind).dayBeforeChecklist.map((item) => `• ${item.charAt(0).toUpperCase()}${item.slice(1)}`),
        "",
        "See you tomorrow!",
        "",
        `— ${facts.studioName}`,
      ].join("\n"),
      recipientEmail: facts.recipientEmail,
      recipientName: facts.recipientName,
      highlights: ["Day-before checklist", `For ${vocab(kind).yourEvent}`],
      missingInformation: missing,
    };
  }

  return {
    subject: `Tomorrow's the day! A quick checklist`,
    body: [
      greeting(facts),
      "",
      `We are so excited for ${facts.projectName} tomorrow${facts.venueName ? ` at ${facts.venueName}` : ""}. It's going to be the best day.`,
      "",
      "One small ask that saves us all 20 minutes in the morning — please have these ready when we arrive:",
      "",
      "• Dress on its special hanger",
      "• Shoes, flowers, and rings together",
      "• Invitations and any keepsake details",
      "",
      "See you tomorrow!",
      "",
      `— ${facts.studioName}`,
    ].join("\n"),
    recipientEmail: facts.recipientEmail,
    recipientName: facts.recipientName,
    highlights: ["Day-before detail checklist", "Saves ~20 minutes on site"],
    missingInformation: missing,
  };
}
