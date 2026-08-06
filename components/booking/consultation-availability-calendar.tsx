"use client";

import { useEffect, useMemo, useState, type FormEvent } from "react";
import {
  addMonths,
  eachDayOfInterval,
  endOfMonth,
  endOfWeek,
  format,
  isSameMonth,
  isToday,
  startOfMonth,
  startOfWeek,
  subMonths,
} from "date-fns";
import {
  collection,
  doc,
  getDoc,
  onSnapshot,
  query,
  where,
} from "firebase/firestore";
import {
  ArrowUpRight,
  CalendarClock,
  ChevronLeft,
  ChevronRight,
  Lock,
  Unlock,
} from "lucide-react";
import { generateConsultationSlots, type ConsultationSlot } from "@/features/consultations/slots";
import type { ConsultationSettings, Weekday } from "@/features/consultations/availability-schema";
import { useWorkspace } from "@/features/auth/workspace-context";
import { getFirebaseClient } from "@/lib/firebase/client";
import { dataIsLive } from "@/lib/runtime-mode";
import {
  queryConsultationAvailability,
  sendBookingCommand,
} from "@/lib/booking/command-client";
import { useTenantDocuments, type TenantDocument } from "@/components/live/tenant-records";

type SettingsShape = Pick<
  ConsultationSettings,
  "durationMinutes" | "bufferMinutes" | "mode" | "windows" | "unavailableWindows" | "blockedDates"
>;

const defaultSettings: SettingsShape = {
  durationMinutes: 45,
  bufferMinutes: 15,
  mode: "closed_default",
  windows: (["mon", "tue", "wed", "thu", "fri"] as const).map((day: Weekday) => ({
    day,
    startMinute: 9 * 60,
    endMinute: 17 * 60,
  })),
  unavailableWindows: [],
  blockedDates: [],
};

function localDateKey(iso: string, timezone: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(iso));
}

function weekdayHasWindow(day: Date, windows: SettingsShape["windows"]): boolean {
  const key = format(day, "EEE").toLowerCase().slice(0, 3) as Weekday;
  return windows.some((window) => window.day === key);
}

export function ConsultationAvailabilityCalendar() {
  const workspace = useWorkspace();
  const [month, setMonth] = useState(startOfMonth(new Date()));
  const [timezone, setTimezone] = useState("America/New_York");
  const [settings, setSettings] = useState<SettingsShape>(defaultSettings);
  const [loadingSettings, setLoadingSettings] = useState(dataIsLive);
  const [selectedDateKey, setSelectedDateKey] = useState<string | null>(null);
  const [blockNotice, setBlockNotice] = useState<string | null>(null);
  const [blocking, setBlocking] = useState(false);
  const [consultations, setConsultations] = useState<TenantDocument[]>([]);
  const [consultationsLoading, setConsultationsLoading] = useState(dataIsLive);
  const [calendarBusy, setCalendarBusy] = useState<{ start: string; end: string }[]>([]);
  const [calendarStatus, setCalendarStatus] = useState<"connected" | "unavailable" | "unknown">(
    "unknown",
  );

  const tenantId = workspace.tenantId ?? "";
  const { records: projects } = useTenantDocuments("projects");

  // Studio-local timezone + the weekly-availability settings doc, kept live
  // so a change made in Settings (or another tab) shows up here without a
  // manual reload.
  useEffect(() => {
    if (!dataIsLive) return;
    if (workspace.loading || !workspace.tenantId) return;
    const id = workspace.tenantId;
    let active = true;
    const { firestore } = getFirebaseClient();
    void getDoc(doc(firestore, "tenants", id)).then((tenant) => {
      if (active) setTimezone(String(tenant.get("timezone") ?? "America/New_York"));
    });
    const unsubscribe = onSnapshot(
      doc(firestore, "consultationSettings", id),
      (settingsDoc) => {
        if (!active) return;
        if (settingsDoc.exists()) {
          const data = settingsDoc.data();
          setSettings({
            durationMinutes: Number(data.durationMinutes ?? defaultSettings.durationMinutes),
            bufferMinutes: Number(data.bufferMinutes ?? defaultSettings.bufferMinutes),
            mode: data.mode === "open_default" ? "open_default" : "closed_default",
            windows: Array.isArray(data.windows) ? data.windows : defaultSettings.windows,
            unavailableWindows: Array.isArray(data.unavailableWindows)
              ? data.unavailableWindows
              : [],
            blockedDates: Array.isArray(data.blockedDates)
              ? data.blockedDates.map(String)
              : [],
          });
        }
        setLoadingSettings(false);
      },
      () => setLoadingSettings(false),
    );
    return () => {
      active = false;
      unsubscribe();
    };
  }, [workspace.loading, workspace.tenantId]);

  // Real-time booking refresh — booking a slot (from this tab, another
  // tab, or the public scheduler) updates the grid without a manual
  // reload.
  useEffect(() => {
    if (!dataIsLive) return;
    if (workspace.loading || !workspace.tenantId) return;
    const { firestore } = getFirebaseClient();
    return onSnapshot(
      query(
        collection(firestore, "consultations"),
        where("tenantId", "==", workspace.tenantId),
      ),
      (snapshot) => {
        setConsultations(
          snapshot.docs.map((item) => ({ id: item.id, ...item.data() }) as TenantDocument),
        );
        setConsultationsLoading(false);
      },
      () => setConsultationsLoading(false),
    );
  }, [workspace.loading, workspace.tenantId]);

  // Real Google Calendar conflicts, merged into slot generation below so
  // they auto-block alongside internal bookings. Google has no push
  // channel wired up here, so this polls on an interval rather than
  // updating instantly — it degrades to "internal bookings only" if the
  // studio hasn't connected a calendar or the provider call fails.
  useEffect(() => {
    if (!dataIsLive) return;
    if (workspace.loading || !workspace.tenantId) return;
    let active = true;
    async function loadCalendarBusy() {
      try {
        const outcome = await queryConsultationAvailability();
        if (!active) return;
        if (outcome.mode === "live") {
          setCalendarBusy(outcome.payload.busy);
          setCalendarStatus(outcome.payload.calendarStatus);
        }
      } catch {
        if (active) setCalendarStatus("unavailable");
      }
    }
    void loadCalendarBusy();
    const interval = setInterval(loadCalendarBusy, 3 * 60_000);
    return () => {
      active = false;
      clearInterval(interval);
    };
  }, [workspace.loading, workspace.tenantId]);

  const days = useMemo(
    () =>
      eachDayOfInterval({
        start: startOfWeek(startOfMonth(month)),
        end: endOfWeek(endOfMonth(month)),
      }),
    [month],
  );

  const consultationsByDate = useMemo(() => {
    const map = new Map<string, TenantDocument[]>();
    for (const consultation of consultations) {
      const startsAt = consultation.startsAt;
      if (typeof startsAt !== "string" || consultation.status !== "scheduled") continue;
      const key = localDateKey(startsAt, timezone);
      const list = map.get(key) ?? [];
      list.push(consultation);
      map.set(key, list);
    }
    return map;
  }, [consultations, timezone]);

  const busy = useMemo(
    () => [
      ...consultations
        .filter((consultation) => consultation.status === "scheduled")
        .flatMap((consultation) =>
          typeof consultation.startsAt === "string" && typeof consultation.endsAt === "string"
            ? [{ start: consultation.startsAt, end: consultation.endsAt }]
            : [],
        ),
      ...calendarBusy,
    ],
    [consultations, calendarBusy],
  );

  const slotsByDate = useMemo(() => {
    const generated = generateConsultationSlots({
      settings,
      timezone,
      now: new Date(),
      startInDays: 0,
      daysAhead: 45,
      busy,
      maxSlots: 2000,
    });
    const map = new Map<string, ConsultationSlot[]>();
    for (const slot of generated) {
      const key = localDateKey(slot.startsAt, timezone);
      const list = map.get(key) ?? [];
      list.push(slot);
      map.set(key, list);
    }
    return map;
  }, [settings, timezone, busy]);

  const blockedSet = useMemo(() => new Set(settings.blockedDates), [settings.blockedDates]);

  async function toggleBlocked(dateKey: string) {
    setBlocking(true);
    setBlockNotice(null);
    const nextBlocked = blockedSet.has(dateKey)
      ? settings.blockedDates.filter((value) => value !== dateKey)
      : [...settings.blockedDates, dateKey].sort();
    try {
      const outcome = await sendBookingCommand({
        type: "setConsultationSettings",
        idempotencyKey: crypto.randomUUID(),
        input: { ...settings, blockedDates: nextBlocked },
      });
      if (outcome.mode !== "preview") {
        setSettings((current) => ({ ...current, blockedDates: nextBlocked }));
      }
      setBlockNotice(
        outcome.mode === "preview"
          ? "Preview saved for this session."
          : blockedSet.has(dateKey)
            ? "Day reopened for booking."
            : "Day blocked from booking.",
      );
    } catch (caught: unknown) {
      setBlockNotice(caught instanceof Error ? caught.message : "Could not update this day.");
    } finally {
      setBlocking(false);
    }
  }

  const selectedSlots = selectedDateKey ? (slotsByDate.get(selectedDateKey) ?? []) : [];
  const selectedBookings = selectedDateKey ? (consultationsByDate.get(selectedDateKey) ?? []) : [];
  const selectedBookedKeys = new Set(
    selectedBookings.map((booking) => String(booking.startsAt)),
  );

  return (
    <section className="availability-calendar" aria-label="Consultation availability">
      <div className="availability-calendar-grid-wrap panel">
        <header>
          <div>
            <p className="eyebrow">Availability</p>
            <h2>{format(month, "MMMM yyyy")}</h2>
          </div>
          <div>
            <button aria-label="Previous month" onClick={() => setMonth((value) => subMonths(value, 1))} type="button">
              <ChevronLeft size={17} />
            </button>
            <button onClick={() => setMonth(startOfMonth(new Date()))} type="button">
              Today
            </button>
            <button aria-label="Next month" onClick={() => setMonth((value) => addMonths(value, 1))} type="button">
              <ChevronRight size={17} />
            </button>
          </div>
        </header>
        <div className="calendar-weekdays" aria-hidden="true">
          {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((day) => (
            <span key={day}>{day}</span>
          ))}
        </div>
        <div className="availability-calendar-grid">
          {days.map((day) => {
            const dateKey = format(day, "yyyy-MM-dd");
            const bookedCount = consultationsByDate.get(dateKey)?.length ?? 0;
            const openCount = slotsByDate.get(dateKey)?.length ?? 0;
            const blocked = blockedSet.has(dateKey);
            const closed = !blocked && !weekdayHasWindow(day, settings.windows);
            const selected = selectedDateKey === dateKey;
            const state = blocked ? "blocked" : closed ? "closed" : openCount > 0 ? "open" : "full";
            return (
              <button
                type="button"
                key={dateKey}
                className={[
                  `availability-day availability-day-state-${state}`,
                  !isSameMonth(day, month) ? "outside-month" : "",
                  isToday(day) ? "is-today" : "",
                  selected ? "is-selected" : "",
                ].filter(Boolean).join(" ")}
                onClick={() => setSelectedDateKey(selected ? null : dateKey)}
              >
                <time dateTime={dateKey}>{format(day, "d")}</time>
                {blocked ? <Lock size={12} aria-hidden="true" /> : null}
                {bookedCount > 0 ? <span className="availability-day-booked">{bookedCount} booked</span> : null}
                {!blocked && !closed && openCount > 0 ? (
                  <span className="availability-day-open">{openCount} open</span>
                ) : null}
              </button>
            );
          })}
        </div>
        {loadingSettings || consultationsLoading ? (
          <p className="calendar-loading">Loading availability…</p>
        ) : calendarStatus === "unavailable" ? (
          <p className="calendar-loading">
            Google Calendar isn’t connected — only internal bookings are shown. Connect it in{" "}
            <a href="/studio/integrations">Integrations</a>.
          </p>
        ) : null}
      </div>

      {selectedDateKey ? (
        <div className="availability-day-panel panel">
          <header>
            <div>
              <p className="eyebrow">{format(new Date(`${selectedDateKey}T12:00:00`), "EEEE")}</p>
              <h2>{format(new Date(`${selectedDateKey}T12:00:00`), "MMMM d, yyyy")}</h2>
            </div>
            <button
              type="button"
              className="button button-light"
              disabled={blocking}
              onClick={() => toggleBlocked(selectedDateKey)}
            >
              {blockedSet.has(selectedDateKey) ? (
                <>
                  <Unlock size={15} aria-hidden="true" /> Unblock this day
                </>
              ) : (
                <>
                  <Lock size={15} aria-hidden="true" /> Block this day
                </>
              )}
            </button>
          </header>
          {blockNotice ? <p className="form-notice" role="status">{blockNotice}</p> : null}

          {selectedBookings.length > 0 ? (
            <ul className="availability-booking-list">
              {selectedBookings.map((booking) => {
                const project = projects?.find((value) => value.id === booking.projectId);
                return (
                  <li key={booking.id}>
                    <span className="availability-slot-time">
                      {format(new Date(String(booking.startsAt)), "h:mm a")} –{" "}
                      {format(new Date(String(booking.endsAt)), "h:mm a")}
                    </span>
                    <span className="availability-slot-status status-booked">
                      {project ? String(project.name) : "Booked"}
                    </span>
                    {project ? (
                      <a href={`/studio/projects/${project.id}`}>
                        <ArrowUpRight size={14} aria-hidden="true" /> Open project
                      </a>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          ) : null}

          {blockedSet.has(selectedDateKey) ? (
            <p className="availability-empty">
              This day is blocked — clients can’t book a consultation here.
            </p>
          ) : selectedSlots.length === 0 ? (
            <p className="availability-empty">
              No consultation windows are configured for this day. Set your weekly hours in{" "}
              <a href="/studio/settings">Settings</a>.
            </p>
          ) : (
            <ul className="availability-slot-list">
              {selectedSlots.map((slot) =>
                selectedBookedKeys.has(slot.startsAt) ? null : (
                  <SlotRow key={slot.startsAt} slot={slot} tenantId={tenantId} />
                ),
              )}
            </ul>
          )}
        </div>
      ) : (
        <div className="availability-day-panel availability-day-panel-empty panel">
          <CalendarClock size={28} aria-hidden="true" />
          <p>Select a day to see its consultation slots, book one, or block the day off.</p>
        </div>
      )}
    </section>
  );
}

function SlotRow({ slot, tenantId }: { slot: ConsultationSlot; tenantId: string }) {
  const [open, setOpen] = useState(false);
  return (
    <li>
      <span className="availability-slot-time">
        {format(new Date(slot.startsAt), "h:mm a")} – {format(new Date(slot.endsAt), "h:mm a")}
      </span>
      {open ? (
        <BookSlotForm slot={slot} tenantId={tenantId} onCancel={() => setOpen(false)} />
      ) : (
        <button type="button" className="availability-slot-status status-open" onClick={() => setOpen(true)}>
          Open — book this slot
        </button>
      )}
    </li>
  );
}

function BookSlotForm({
  slot,
  onCancel,
}: {
  slot: ConsultationSlot;
  tenantId: string;
  onCancel: () => void;
}) {
  const { records: projects, loading } = useTenantDocuments("projects");
  const [projectId, setProjectId] = useState("");
  const [contactId, setContactId] = useState("");
  const [mode, setMode] = useState<"zoom" | "in_person" | "phone" | "custom">("zoom");
  const [submitting, setSubmitting] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [booked, setBooked] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!projectId || !contactId) {
      setNotice("Choose a project with a client contact first.");
      return;
    }
    setSubmitting(true);
    setNotice(null);
    try {
      const outcome = await sendBookingCommand({
        type: "scheduleConsultation",
        idempotencyKey: crypto.randomUUID(),
        input: {
          projectId,
          contactId,
          mode,
          startsAt: slot.startsAt,
          endsAt: slot.endsAt,
          timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
          location: null,
        },
      });
      setBooked(true);
      setNotice(
        outcome.mode === "preview"
          ? "Development preview: this booking was validated but not persisted."
          : "Consultation booked.",
      );
    } catch (caught: unknown) {
      setNotice(caught instanceof Error ? caught.message : "Consultation could not be scheduled.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form className="availability-book-form" onSubmit={submit}>
      <label>
        <span>Project</span>
        <select
          disabled={loading || booked}
          value={projectId}
          onChange={(event) => {
            setProjectId(event.target.value);
            const selected = projects?.find((project) => project.id === event.target.value);
            const contacts = selected?.clientContactIds;
            setContactId(Array.isArray(contacts) ? String(contacts[0] ?? "") : "");
          }}
        >
          <option value="">{loading ? "Loading projects…" : "Select a project"}</option>
          {projects?.map((project) => (
            <option value={project.id} key={project.id}>
              {String(project.name)}
            </option>
          ))}
        </select>
      </label>
      <label>
        <span>Meeting type</span>
        <select
          disabled={booked}
          value={mode}
          onChange={(event) => setMode(event.target.value as typeof mode)}
        >
          <option value="zoom">Zoom</option>
          <option value="in_person">In person</option>
          <option value="phone">Phone</option>
          <option value="custom">Custom</option>
        </select>
      </label>
      <div className="availability-book-actions">
        <button className="button button-dark" type="submit" disabled={submitting || booked}>
          {submitting ? "Booking…" : booked ? "Booked" : "Confirm booking"}
        </button>
        <button className="button button-light" type="button" onClick={onCancel} disabled={submitting}>
          Cancel
        </button>
      </div>
      {notice ? <p className="form-notice" role="status">{notice}</p> : null}
    </form>
  );
}
