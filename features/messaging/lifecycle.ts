import {
  defaultLifecycleMessagingSettings,
  lifecycleMessagingSettingsSchema,
  lifecycleTriggers,
  type LifecycleMessagingSettings,
  type MessageTrigger,
} from "@/features/messaging/schema";

/**
 * Deterministic lifecycle engine: given a booked project and the tenant's
 * timeline settings, decide which lifecycle messages are due. No I/O — the
 * scheduler feeds it plain values and gets back stable, idempotent work items.
 */

export type LifecycleProject = {
  id: string;
  tenantId: string;
  state: string;
  eventDate: string | null; // YYYY-MM-DD
};

export type DueLifecycleMessage = {
  trigger: MessageTrigger;
  projectId: string;
  tenantId: string;
  /** Stable across runs — one draft per project per trigger, ever. */
  idempotencyKey: string;
  dueOn: string; // YYYY-MM-DD
};

/** States in which lifecycle messaging applies (booked through event day). */
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
  const parsed = lifecycleMessagingSettingsSchema.safeParse(raw);
  return parsed.success ? parsed.data : defaultLifecycleMessagingSettings;
}

function addDays(date: string, days: number): string | null {
  const parsed = Date.parse(`${date}T00:00:00Z`);
  if (!Number.isFinite(parsed)) return null;
  return new Date(parsed + days * DAY_MS).toISOString().slice(0, 10);
}

/**
 * A message is due when today (UTC date) is on or after its scheduled day and
 * strictly before the event date — never send a "day before" note after the
 * event, and never send anything for an undated project.
 */
export function dueLifecycleMessages(input: {
  project: LifecycleProject;
  settings: LifecycleMessagingSettings;
  today: string; // YYYY-MM-DD
}): DueLifecycleMessage[] {
  const { project, settings, today } = input;
  if (!project.eventDate || !ACTIVE_STATES.has(project.state)) return [];
  if (today >= project.eventDate) return [];
  const due: DueLifecycleMessage[] = [];
  for (const trigger of lifecycleTriggers) {
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
