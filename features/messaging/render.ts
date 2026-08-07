import type {
  MessageDraftOutput,
  MessageTrigger,
} from "@/features/messaging/schema";

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
  retainerPaidCents: number | null;
  balanceDueCents: number | null;
  scheduleUrl: string | null;
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
        "If ceremony, reception, or prep times have changed at all, just reply and we'll update the plan.",
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
    const amounts =
      facts.packageTotalCents !== null &&
      facts.retainerPaidCents !== null &&
      facts.balanceDueCents !== null
        ? `Package total ${money(facts.packageTotalCents)} − retainer ${money(facts.retainerPaidCents)} = balance ${money(facts.balanceDueCents)} (plus any applicable sales tax).`
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
