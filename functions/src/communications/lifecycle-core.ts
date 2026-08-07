// Mirrors features/messaging/schema.ts, features/messaging/lifecycle.ts, and
// features/messaging/render.ts. functions/ is a separate package (own
// tsconfig, no "@/features" path), so the deterministic lifecycle core is
// duplicated here. Keep this file in sync with the features/ copies — the
// unit tests in tests/lifecycle-messaging.test.ts exercise the features/
// implementation, which is the source of truth.

export type LifecycleTrigger =
  | "schedule_confirmation"
  | "final_invoice_notice"
  | "day_before_checklist";

export const lifecycleTriggerSet: ReadonlySet<string> = new Set([
  "schedule_confirmation",
  "final_invoice_notice",
  "day_before_checklist",
]);

export type LifecycleTriggerSetting = {
  enabled: boolean;
  offsetDays: number;
  /** Trust dial: owner-approved auto-send for this deterministic message. */
  autoSend: boolean;
};
export type LifecycleMessagingSettings = Record<
  LifecycleTrigger,
  LifecycleTriggerSetting
>;

export const defaultLifecycleMessagingSettings: LifecycleMessagingSettings = {
  schedule_confirmation: { enabled: true, offsetDays: -30, autoSend: false },
  final_invoice_notice: { enabled: true, offsetDays: -30, autoSend: false },
  day_before_checklist: { enabled: true, offsetDays: -1, autoSend: false },
};

const ACTIVE_STATES = new Set([
  "BOOKED",
  "PLANNING",
  "READY",
  "EVENT_IN_PROGRESS",
]);

const DAY_MS = 86_400_000;

export function resolveLifecycleSettings(
  raw: unknown,
): LifecycleMessagingSettings {
  const value =
    typeof raw === "object" && raw !== null && !Array.isArray(raw)
      ? (raw as Record<string, unknown>)
      : {};
  const resolved = { ...defaultLifecycleMessagingSettings };
  for (const trigger of Object.keys(
    defaultLifecycleMessagingSettings,
  ) as LifecycleTrigger[]) {
    const entry =
      typeof value[trigger] === "object" && value[trigger] !== null
        ? (value[trigger] as Record<string, unknown>)
        : null;
    if (!entry) continue;
    const offsetDays = Number(entry.offsetDays);
    resolved[trigger] = {
      enabled: entry.enabled !== false,
      offsetDays:
        Number.isInteger(offsetDays) && offsetDays >= -365 && offsetDays <= 0
          ? offsetDays
          : resolved[trigger].offsetDays,
      autoSend: entry.autoSend === true,
    };
  }
  return resolved;
}

function addDays(date: string, days: number): string | null {
  const parsed = Date.parse(`${date}T00:00:00Z`);
  if (!Number.isFinite(parsed)) return null;
  return new Date(parsed + days * DAY_MS).toISOString().slice(0, 10);
}

export function dueLifecycleMessages(input: {
  project: {
    id: string;
    tenantId: string;
    state: string;
    eventDate: string | null;
  };
  settings: LifecycleMessagingSettings;
  today: string;
}): Array<{
  trigger: LifecycleTrigger;
  projectId: string;
  tenantId: string;
  idempotencyKey: string;
  dueOn: string;
}> {
  const { project, settings, today } = input;
  if (!project.eventDate || !ACTIVE_STATES.has(project.state)) return [];
  if (today >= project.eventDate) return [];
  const due: Array<{
    trigger: LifecycleTrigger;
    projectId: string;
    tenantId: string;
    idempotencyKey: string;
    dueOn: string;
  }> = [];
  for (const trigger of Object.keys(settings) as LifecycleTrigger[]) {
    const setting = settings[trigger];
    if (!setting.enabled) continue;
    const dueOn = addDays(project.eventDate, setting.offsetDays);
    if (!dueOn || today < dueOn) continue;
    due.push({
      trigger,
      projectId: project.id,
      tenantId: project.tenantId,
      idempotencyKey: `lifecycle_${project.tenantId}_${project.id}_${trigger}`,
      dueOn,
    });
  }
  return due;
}

export type LifecycleFacts = {
  studioName: string;
  clientFirstName: string | null;
  projectName: string;
  eventDate: string | null;
  venueName: string | null;
  packageTotalCents: number | null;
  retainerPaidCents: number | null;
  balanceDueCents: number | null;
  scheduleUrl: string | null;
  recipientEmail: string | null;
  recipientName: string | null;
};

export type LifecycleDraft = {
  subject: string;
  body: string;
  recipientEmail: string | null;
  recipientName: string | null;
  highlights: string[];
  missingInformation: string[];
};

const money = (cents: number): string =>
  `$${(cents / 100).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;

const greeting = (facts: LifecycleFacts): string =>
  facts.clientFirstName ? `Hi ${facts.clientFirstName},` : "Hi there,";

export function renderLifecycleDraft(
  trigger: LifecycleTrigger,
  facts: LifecycleFacts,
): LifecycleDraft {
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
