/**
 * Planning checklist: the functions copy of features/planning/planning-checklist.ts,
 * which explains it. Everything below the marker is identical;
 * tests/planning-checklist.test.ts compares the two.
 */
import { planningScopeOf } from "./planning-scope.js";
import { taskIsSettled } from "../workflow/task-edits.js";
// ── mirrored below ──

/** The tiers with a checklist: month-of coordination has none. */
export const CHECKLIST_SCOPES = ["full", "partial"] as const;
export type ChecklistScope = (typeof CHECKLIST_SCOPES)[number];

export const CHECKLIST_UNITS = ["months", "weeks"] as const;
export type ChecklistUnit = (typeof CHECKLIST_UNITS)[number];

/** One line of a checklist: what to do, and how long before the day. */
export type ChecklistItem = {
  /** Stable within the list; part of the task id, so never reused for something else. */
  key: string;
  title: string;
  amount: number;
  unit: ChecklistUnit;
};

export const CHECKLIST_LIMITS = {
  items: 40,
  titleMin: 2,
  titleMax: 120,
  months: 24,
  weeks: 52,
} as const;

export const CHECKLIST_KEY_PATTERN = /^[a-z0-9_]{1,40}$/;

/** `tasks.source` on every checklist task, the one-off ones included. */
export const PLANNING_CHECKLIST_SOURCE = "planning_checklist";

const item = (key: string, title: string, amount: number, unit: ChecklistUnit = "months"): ChecklistItem => ({
  key,
  title,
  amount,
  unit,
});

/**
 * The starter lists. Full planning starts a year or more out with the venue
 * and the budget; partial planning starts about six months out with the
 * vendors the couple still needs (the venue is already theirs).
 */
export const STARTER_PLANNING_CHECKLISTS: Readonly<Record<ChecklistScope, readonly ChecklistItem[]>> = {
  full: [
    item("budget", "Set the budget and a first guest count with the couple", 12),
    item("venue", "Book the venue", 12),
    item("photographer", "Book the photographer", 10),
    item("videographer", "Book the videographer", 10),
    item("officiant", "Book the officiant", 9),
    item("caterer", "Book the caterer", 9),
    item("design", "Settle the design: colors, mood board and the look of the day", 9),
    item("save_the_dates", "Send the save-the-dates", 8),
    item("florist", "Book the florist", 8),
    item("music", "Book the DJ or band", 8),
    item("hair_makeup", "Book hair and makeup", 7),
    item("rentals", "Book rentals: tables, chairs, linens, tent", 6),
    item("cake", "Book the cake or desserts", 6),
    item("stationery", "Order the invitations and day-of stationery", 4),
    item("transportation", "Book transportation", 4),
    item("invitations_mailed", "Mail the invitations", 8, "weeks"),
    item("rsvps", "RSVP deadline: chase the missing replies", 5, "weeks"),
    item("marriage_license", "Remind the couple to get their marriage license", 4, "weeks"),
    item("seating_chart", "Seating chart and final count to the venue and caterer", 2, "weeks"),
  ],
  partial: [
    item("vendor_review", "Go through the vendors they've booked and their contracts", 6),
    item("design", "Settle the design: colors, mood board and the look of the day", 5),
    item("florist", "Book the florist", 5),
    item("music", "Book the DJ or band", 5),
    item("hair_makeup", "Book hair and makeup", 4),
    item("rentals", "Book rentals: tables, chairs, linens, tent", 4),
    item("cake", "Book the cake or desserts", 3),
    item("stationery", "Order the day-of stationery", 3),
    item("transportation", "Book transportation", 3),
    item("rsvps", "RSVP deadline: chase the missing replies", 5, "weeks"),
    item("marriage_license", "Remind the couple to get their marriage license", 4, "weeks"),
    item("seating_chart", "Seating chart and final count to the venue and caterer", 2, "weeks"),
  ],
};

export function isChecklistScope(value: unknown): value is ChecklistScope {
  return typeof value === "string" && (CHECKLIST_SCOPES as readonly string[]).includes(value);
}

/** The job's checklist tier: full or partial planning; null for every other job. */
export function checklistScopeOf(project: unknown): ChecklistScope | null {
  const scope = planningScopeOf(project);
  return isChecklistScope(scope) ? scope : null;
}

/** Why a list can't be saved, in the studio's words; null when it can. */
export function checklistProblem(items: unknown): string | null {
  if (!Array.isArray(items)) return "The checklist didn't come through. Try again.";
  if (items.length > CHECKLIST_LIMITS.items) return `A checklist holds up to ${CHECKLIST_LIMITS.items} items.`;
  const keys = new Set<string>();
  for (const [index, raw] of items.entries()) {
    const entry = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
    const line = `Item ${index + 1}`;
    const key = typeof entry.key === "string" ? entry.key : "";
    if (!CHECKLIST_KEY_PATTERN.test(key)) return `${line} is missing its key. Remove it and add it again.`;
    if (keys.has(key)) return `${line} is in the list twice.`;
    keys.add(key);
    const title = typeof entry.title === "string" ? entry.title.trim() : "";
    if (title.length < CHECKLIST_LIMITS.titleMin) return `${line} needs a name.`;
    if (title.length > CHECKLIST_LIMITS.titleMax) return `${line} has too long a name: ${CHECKLIST_LIMITS.titleMax} characters at most.`;
    const unit = entry.unit;
    if (unit !== "months" && unit !== "weeks") return `${line} needs months or weeks.`;
    const amount = entry.amount;
    const most = unit === "months" ? CHECKLIST_LIMITS.months : CHECKLIST_LIMITS.weeks;
    if (typeof amount !== "number" || !Number.isInteger(amount) || amount < 1 || amount > most)
      return `${line}: between 1 and ${most} ${unit} before the day.`;
  }
  return null;
}

/** A stored list, tidied: trimmed titles. Null when it isn't a valid list. */
function storedItems(value: unknown): ChecklistItem[] | null {
  if (checklistProblem(value) !== null) return null;
  return (value as ChecklistItem[]).map((entry) => item(entry.key, entry.title.trim(), entry.amount, entry.unit));
}

function savedList(stored: unknown, scope: ChecklistScope): ChecklistItem[] | null {
  const lists = (stored && typeof stored === "object" ? stored : {}) as Record<string, unknown>;
  const saved = lists[scope] && typeof lists[scope] === "object" ? (lists[scope] as Record<string, unknown>) : null;
  return saved ? storedItems(saved.items) : null;
}

/**
 * The studio's list for a tier: its own when it has saved one (an empty list
 * is a choice — no checklist), the starter list otherwise.
 */
export function checklistFor(stored: unknown, scope: ChecklistScope): ChecklistItem[] {
  return savedList(stored, scope) ?? STARTER_PLANNING_CHECKLISTS[scope].map((entry) => ({ ...entry }));
}

/** Whether the studio has made this tier's list its own. */
export function checklistIsCustom(stored: unknown, scope: ChecklistScope): boolean {
  return savedList(stored, scope) !== null;
}

/** "10 months before", "1 week before". */
export function offsetLabel(entry: { amount: number; unit: ChecklistUnit }): string {
  const one = entry.unit === "months" ? "month" : "week";
  return `${entry.amount} ${entry.amount === 1 ? one : `${one}s`} before`;
}

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const dayOf = (value: unknown) => (typeof value === "string" ? value.slice(0, 10) : "");

/** The day N months or weeks before a YYYY-MM-DD date; the 31st a month back from March is the last of February. */
export function dayBefore(eventDate: unknown, entry: { amount: number; unit: ChecklistUnit }): string | null {
  const day = dayOf(eventDate);
  if (!DAY.test(day)) return null;
  const [year, month, date] = day.split("-").map(Number) as [number, number, number];
  if (entry.unit === "weeks") {
    return new Date(Date.UTC(year, month - 1, date - entry.amount * 7, 12)).toISOString().slice(0, 10);
  }
  const target = new Date(Date.UTC(year, month - 1 - entry.amount, 1, 12));
  const lastOfMonth = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0, 12)).getUTCDate();
  target.setUTCDate(Math.min(date, lastOfMonth));
  return target.toISOString().slice(0, 10);
}

/** When an item falls due: its day before the wedding, or today when that day has passed. */
export function checklistDueDate(
  eventDate: unknown,
  entry: { amount: number; unit: ChecklistUnit },
  today: string,
): string | null {
  const due = dayBefore(eventDate, entry);
  if (!due) return null;
  return due < today ? today : due;
}

export const planningChecklistTaskId = (projectId: string, key: string) => `planning_${projectId}_${key}`;

/** The fields a checklist task carries beyond an ordinary task's, so a moved date can move it. */
export type ChecklistTaskFields = {
  id: string;
  title: string;
  dueDate: string | null;
  checklistKey: string;
  checklistAmount: number;
  checklistUnit: ChecklistUnit;
  /** The date StudioCue set; a task whose dueDate differs was moved by hand and keeps it. */
  checklistDueDate: string | null;
};

type ExistingTask = { id: string; status?: unknown; dueDate?: unknown; checklistDueDate?: unknown };
type DateChange = { id: string; dueDate: string; checklistDueDate: string };

const settled = taskIsSettled;

/**
 * What booking writes: a task per item, with a fixed id. A task that already
 * exists (a second delivery of the same booking) is brought up to date if it
 * is still open and still on StudioCue's date, and left alone otherwise — a
 * task the studio finished or removed is never brought back.
 */
export function checklistTaskPlan(input: {
  projectId: string;
  eventDate: unknown;
  items: readonly ChecklistItem[];
  today: string;
  existing: ReadonlyArray<ExistingTask>;
}): { create: ChecklistTaskFields[]; update: DateChange[] } {
  const byId = new Map(input.existing.map((task) => [task.id, task]));
  const create: ChecklistTaskFields[] = [];
  const update: DateChange[] = [];
  for (const entry of input.items) {
    const id = planningChecklistTaskId(input.projectId, entry.key);
    const dueDate = checklistDueDate(input.eventDate, entry, input.today);
    const found = byId.get(id);
    if (!found) {
      create.push({
        id,
        title: entry.title,
        dueDate,
        checklistKey: entry.key,
        checklistAmount: entry.amount,
        checklistUnit: entry.unit,
        checklistDueDate: dueDate,
      });
      continue;
    }
    if (!dueDate || settled(found.status)) continue;
    if (dayOf(found.dueDate) !== dayOf(found.checklistDueDate)) continue;
    if (dayOf(found.dueDate) === dueDate) continue;
    update.push({ id, dueDate, checklistDueDate: dueDate });
  }
  return { create, update };
}

/**
 * The wedding moved: each open checklist task on StudioCue's date follows it,
 * by its own months or weeks. Finished, removed and hand-moved tasks stay as
 * they are; one-off items (no offset) have no rule to follow.
 */
export function followEventDate(input: {
  eventDate: unknown;
  today: string;
  tasks: ReadonlyArray<ExistingTask & { checklistAmount?: unknown; checklistUnit?: unknown }>;
}): DateChange[] {
  const moves: DateChange[] = [];
  for (const task of input.tasks) {
    if (settled(task.status)) continue;
    const amount = task.checklistAmount;
    const unit = task.checklistUnit;
    if (typeof amount !== "number" || (unit !== "months" && unit !== "weeks")) continue;
    if (dayOf(task.dueDate) !== dayOf(task.checklistDueDate)) continue;
    const dueDate = checklistDueDate(input.eventDate, { amount, unit }, input.today);
    if (!dueDate || dueDate === dayOf(task.dueDate)) continue;
    moves.push({ id: task.id, dueDate, checklistDueDate: dueDate });
  }
  return moves;
}

/** A job state the checklist is written in: booked, and the day still ahead. */
export const CHECKLIST_STATES: ReadonlySet<string> = new Set(["BOOKED", "PLANNING", "READY"]);

export function isPlanningChecklistTask(task: unknown): boolean {
  return Boolean(task && typeof task === "object" && (task as { source?: unknown }).source === PLANNING_CHECKLIST_SOURCE);
}

export type ChecklistRow = { id: string; title: string; dueDate: string | null; status: string };

/** "6 of 18 done", and what's next: the job's panel. Removed items don't count. */
export function checklistProgress(
  tasks: ReadonlyArray<Record<string, unknown>>,
  today: string,
): { total: number; done: number; overdue: number; open: ChecklistRow[]; finished: ChecklistRow[]; summary: string } {
  const rows: ChecklistRow[] = tasks
    .filter((task) => isPlanningChecklistTask(task) && !task.archivedAt && String(task.status ?? "") !== "cancelled")
    .map((task) => ({
      id: String(task.id ?? ""),
      title: typeof task.title === "string" ? task.title : "",
      dueDate: DAY.test(dayOf(task.dueDate)) ? dayOf(task.dueDate) : null,
      status: String(task.status ?? "not_started"),
    }));
  const byDue = (left: ChecklistRow, right: ChecklistRow) =>
    (left.dueDate ?? "9999-99-99").localeCompare(right.dueDate ?? "9999-99-99") || left.title.localeCompare(right.title);
  const open = rows.filter((row) => !settled(row.status)).sort(byDue);
  const finished = rows.filter((row) => settled(row.status)).sort(byDue);
  return {
    total: rows.length,
    done: finished.length,
    overdue: open.filter((row) => row.dueDate !== null && row.dueDate < today).length,
    open,
    finished,
    summary: rows.length ? `${finished.length} of ${rows.length} done` : "Nothing on it yet",
  };
}
