/**
 * Hair extensions on a booking (docs/vendor-journeys-plan.md, Phase 5).
 *
 * The stylist settles the plan and the color match at the trial and notes
 * them on the job's trial card (setTrialNotes). Extensions to buy or rent
 * take weeks to arrive, so an order task falls due eight weeks before the
 * day and reaches Today in the six-to-eight-week window stylists order in;
 * a rental also gets a task to collect them a few days after. The journey's
 * "Extensions ordered" step reads the order task.
 *
 * Pure, no imports: functions/src/trades/extensions.ts is the same file below
 * the marker (tests/hair-journey.test.ts compares them).
 */
// ── mirrored below ──

export const EXTENSION_PLANS = ["none", "own", "buy", "rent"] as const;
export type ExtensionPlan = (typeof EXTENSION_PLANS)[number];

export const EXTENSION_PLAN_LABELS: Record<ExtensionPlan, string> = {
  none: "No extensions",
  own: "Their own",
  buy: "Buying them",
  rent: "Renting them",
};

/** Eight weeks before: the order is due as the six-to-eight-week window opens. */
export const EXTENSIONS_ORDER_DAYS_BEFORE = 56;
/** Rentals go back three to five days after the day. */
export const EXTENSIONS_RETURN_DAYS_AFTER = 4;

export const extensionsOrderTaskId = (projectId: string) => `extensions_order_${projectId}`;
export const extensionsReturnTaskId = (projectId: string) => `extensions_return_${projectId}`;

export function extensionPlanOf(value: unknown): ExtensionPlan | null {
  return (EXTENSION_PLANS as readonly unknown[]).includes(value) ? (value as ExtensionPlan) : null;
}

/** Extensions the studio has to get: bought or rented. Their own need nothing ordered. */
export function extensionsToOrder(plan: unknown): boolean {
  return plan === "buy" || plan === "rent";
}

/** A YYYY-MM-DD date moved by whole days, or null for no date. */
export function shiftDay(day: unknown, days: number): string | null {
  const value = typeof day === "string" ? day.slice(0, 10) : "";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const date = new Date(`${value}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export type ExtensionTask = { id: string; title: string; description: string; dueDate: string | null };

/** The tasks a plan needs: the order, and for a rental the return. Empty when nothing is ordered. */
export function extensionTasksFor(input: {
  projectId: string;
  eventDate: unknown;
  plan: unknown;
  colorMatch: string | null;
  /** Whose extensions, for the task title: "Maya Brooks". */
  clientName: string | null;
  /** YYYY-MM-DD: an order already late is due today, not in the past. */
  today: string;
}): ExtensionTask[] {
  if (!extensionsToOrder(input.plan)) return [];
  const who = input.clientName ? ` — ${input.clientName}` : "";
  const color = input.colorMatch?.trim() ? `Color match: ${input.colorMatch.trim()}.` : "No color match noted yet — check the trial notes.";
  const orderBy = shiftDay(input.eventDate, -EXTENSIONS_ORDER_DAYS_BEFORE);
  const tasks: ExtensionTask[] = [
    {
      id: extensionsOrderTaskId(input.projectId),
      title: `${input.plan === "rent" ? "Book the rental extensions" : "Order extensions"}${who}`,
      description: `${color} ${input.plan === "rent" ? "Rented" : "Bought"} for the day; order six to eight weeks out so they arrive in time.`,
      dueDate: orderBy && orderBy < input.today ? input.today : orderBy,
    },
  ];
  if (input.plan === "rent")
    tasks.push({
      id: extensionsReturnTaskId(input.projectId),
      title: `Collect the rental extensions${who}`,
      description: "The rental extensions go back a few days after the day.",
      dueDate: shiftDay(input.eventDate, EXTENSIONS_RETURN_DAYS_AFTER),
    });
  return tasks;
}

export type ExtensionsState = {
  plan: "buy" | "rent";
  colorMatch: string | null;
  /** The order task is done. */
  ordered: boolean;
  /** YYYY-MM-DD the order is due. */
  orderBy: string | null;
};

/** Where a job's extensions stand, for its journey; null when nothing is to be ordered. */
export function extensionsState(input: {
  projectId: string;
  trialNotes: unknown;
  eventDate: unknown;
  tasks: ReadonlyArray<Record<string, unknown>>;
}): ExtensionsState | null {
  const notes = (input.trialNotes && typeof input.trialNotes === "object" ? input.trialNotes : {}) as Record<string, unknown>;
  const plan = extensionPlanOf(notes.extensions);
  if (plan !== "buy" && plan !== "rent") return null;
  const order = input.tasks.find((task) => task.id === extensionsOrderTaskId(input.projectId));
  return {
    plan,
    colorMatch: typeof notes.colorMatch === "string" && notes.colorMatch.trim() ? notes.colorMatch.trim() : null,
    ordered: ["complete", "completed"].includes(String(order?.status ?? "")),
    orderBy: shiftDay(input.eventDate, -EXTENSIONS_ORDER_DAYS_BEFORE),
  };
}
