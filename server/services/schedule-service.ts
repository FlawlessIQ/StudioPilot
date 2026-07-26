import { scheduleSchema, type Schedule, type ScheduleItem } from "@/features/schedules/schema";

export function detectScheduleIssues(items: readonly ScheduleItem[], coverageMinutes: number) {
  const sorted = [...items].sort((a, b) => a.startAt.localeCompare(b.startAt));
  const issues: string[] = [];
  sorted.forEach((item, index) => {
    if (new Date(item.endAt) <= new Date(item.startAt)) issues.push(`${item.title}: end must follow start`);
    if (!item.location) issues.push(`${item.title}: location missing`);
    if (item.photographerIds.length === 0) issues.push(`${item.title}: photographer unassigned`);
    const next = sorted[index + 1];
    if (next && new Date(next.startAt) < new Date(item.endAt)) issues.push(`${item.title}: overlaps ${next.title}`);
    const gapMinutes = next ? (new Date(next.startAt).valueOf() - new Date(item.endAt).valueOf()) / 60000 : null;
    if (next && gapMinutes !== null && gapMinutes >= 0 && item.travelMinutes > gapMinutes) {
      issues.push(`${item.title}: travel gap is too short`);
    }
  });
  if (sorted.length > 0) {
    const used = (new Date(sorted.at(-1)?.endAt ?? "").valueOf() - new Date(sorted[0]?.startAt ?? "").valueOf()) / 60000;
    if (used > coverageMinutes) issues.push("Schedule exceeds package coverage");
  }
  return issues;
}

export interface ScheduleVersionStore {
  latest(tenantId: string, projectId: string): Promise<Schedule | null>;
  publish(newVersion: Schedule, supersededId: string | null): Promise<void>;
}

export class ScheduleService {
  constructor(private readonly store: ScheduleVersionStore, private readonly createId: () => string, private readonly now = () => new Date().toISOString()) {}
  async publish(input: { tenantId: string; projectId: string; actorId: string; timezone: string; items: ScheduleItem[]; coverageMinutes: number }) {
    const issues = detectScheduleIssues(input.items, input.coverageMinutes);
    if (issues.length) throw new Error(`Schedule has blocking issues: ${issues.join("; ")}`);
    const prior = await this.store.latest(input.tenantId, input.projectId);
    const timestamp = this.now();
    const schedule = scheduleSchema.parse({
      id: this.createId(), tenantId: input.tenantId, projectId: input.projectId,
      version: (prior?.version ?? 0) + 1, status: "published", timezone: input.timezone,
      items: input.items, approvalState: "client_pending", publishedAt: timestamp,
      approvedBy: null, pdfDocumentId: null, dropboxDocumentId: null,
      supersedesId: prior?.id ?? null, immutable: true,
      createdAt: timestamp, updatedAt: timestamp, createdBy: input.actorId, updatedBy: input.actorId, archivedAt: null,
    });
    await this.store.publish(schedule, prior?.id ?? null);
    return schedule;
  }
}
