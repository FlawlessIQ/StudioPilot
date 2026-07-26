import type { AuthorizationContext } from "@/features/auth/authorize";
import { authorize } from "@/features/auth/authorize";
import { consultationSchema, type Consultation } from "@/features/consultations/schema";
import type { CalendarProvider, MeetingProvider, ProviderContext } from "@/server/integrations/contracts";

export interface ConsultationStore {
  findByIdempotencyKey(tenantId: string, idempotencyKey: string): Promise<Consultation | null>;
  hasConflict(tenantId: string, startsAt: string, endsAt: string): Promise<boolean>;
  create(consultation: Consultation, idempotencyKey: string): Promise<void>;
}

export class ConsultationService {
  constructor(
    private readonly store: ConsultationStore,
    private readonly calendar: CalendarProvider,
    private readonly meetings: MeetingProvider,
    private readonly createId: () => string,
    private readonly now: () => string = () => new Date().toISOString(),
  ) {}

  async schedule(
    context: AuthorizationContext,
    input: {
      projectId: string;
      contactId: string;
      contactEmail: string;
      projectName: string;
      mode: "zoom" | "in_person" | "phone" | "custom";
      startsAt: string;
      endsAt: string;
      timezone: string;
      location: string | null;
      internalNotes: string | null;
      idempotencyKey: string;
    },
  ): Promise<{ consultation: Consultation; existing: boolean }> {
    authorize(context, "projects.manage", input.projectId);
    const existing = await this.store.findByIdempotencyKey(context.tenantId, input.idempotencyKey);
    if (existing) return { consultation: existing, existing: true };

    const start = new Date(input.startsAt);
    const end = new Date(input.endsAt);
    if (!Number.isFinite(start.valueOf()) || !Number.isFinite(end.valueOf()) || end <= start) {
      throw new Error("Consultation end time must follow its start time.");
    }
    if (end.valueOf() - start.valueOf() > 4 * 60 * 60 * 1000) {
      throw new Error("Consultation duration cannot exceed four hours.");
    }
    if (await this.store.hasConflict(context.tenantId, input.startsAt, input.endsAt)) {
      throw new Error("The consultation conflicts with an existing booking.");
    }

    const providerContext: ProviderContext = {
      tenantId: context.tenantId,
      correlationId: input.idempotencyKey,
    };
    const availability = await this.calendar.getAvailability(providerContext, {
      startsAt: input.startsAt,
      endsAt: input.endsAt,
      timezone: input.timezone,
    });
    if (!availability.some((window) => window.available)) {
      throw new Error("The connected calendar reports this time as unavailable.");
    }

    const durationMinutes = Math.round((end.valueOf() - start.valueOf()) / 60_000);
    const meeting = input.mode === "zoom"
      ? await this.meetings.createMeeting(providerContext, {
          topic: `${input.projectName} consultation`,
          startsAt: input.startsAt,
          durationMinutes,
          timezone: input.timezone,
          waitingRoom: true,
          passwordRequired: true,
        }, `consultation-meeting:${input.idempotencyKey}`)
      : null;
    const location = meeting?.joinUrl ?? input.location;
    const event = await this.calendar.createEvent(providerContext, {
      title: `${input.projectName} consultation`,
      description: meeting ? `Join Zoom: ${meeting.joinUrl}` : "Photography consultation",
      startsAt: input.startsAt,
      endsAt: input.endsAt,
      timezone: input.timezone,
      location,
      attendeeEmails: [input.contactEmail],
      remindersMinutes: [1440, 60],
    }, `consultation-calendar:${input.idempotencyKey}`);

    const timestamp = this.now();
    const consultation = consultationSchema.parse({
      id: this.createId(),
      tenantId: context.tenantId,
      projectId: input.projectId,
      contactId: input.contactId,
      mode: input.mode,
      status: "scheduled",
      startsAt: input.startsAt,
      endsAt: input.endsAt,
      timezone: input.timezone,
      location,
      calendarEventId: event.id,
      calendarHtmlLink: event.htmlLink,
      meetingId: meeting?.id ?? null,
      joinUrl: meeting?.joinUrl ?? null,
      internalNotes: input.internalNotes,
      reminderJobIds: [],
      supersedesId: null,
      createdAt: timestamp,
      updatedAt: timestamp,
      createdBy: context.userId,
      updatedBy: context.userId,
      archivedAt: null,
    });
    await this.store.create(consultation, input.idempotencyKey);
    return { consultation, existing: false };
  }
}
