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
  parseISO,
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

const weekdayLabels = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

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

function safeEventDate(value: unknown): Date | null {
  if (typeof value !== "string" || !value) return null;
  try {
    const parsed = value.includes("T") ? new Date(value) : parseISO(value);
    return Number.isNaN(parsed.valueOf()) ? null : parsed;
  } catch {
    return null;
  }
}

export function StudioCalendar() {
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

  const projectsByDate = useMemo(() => {
    const map = new Map<string, TenantDocument[]>();
    for (const project of projects ?? []) {
      const date = safeEventDate(project.eventDate);
      if (!date) continue;
      const key = format(date, "yyyy-MM-dd");
      const list = map.get(key) ?? [];
      list.push(project);
      map.set(key, list);
    }
    return map;
  }, [projects]);

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

  const selectedProjects = selectedDateKey ? (projectsByDate.get(selectedDateKey) ?? []) : [];
  const selectedSlots = selectedDateKey ? (slotsByDate.get(selectedDateKey) ?? []) : [];
  const selectedBookings = selectedDateKey ? (consultationsByDate.get(selectedDateKey) ?? []) : [];
  const selectedBookedKeys = new Set(
    selectedBookings.map((booking) => String(booking.startsAt)),
  );

  return (
    <section className="ds-cal" aria-label="Studio calendar">
      <div className="ds-card ds-cal-grid-card">
        <div className="ds-cal-head">
          <div>
            <p className="ds-eyebrow">Schedule</p>
            <h2>{format(month, "MMMM yyyy")}</h2>
          </div>
          <div className="ds-cal-nav">
            <button
              className="ds-btn ds-btn-ghost ds-cal-nav-btn"
              aria-label="Previous month"
              onClick={() => setMonth((value) => subMonths(value, 1))}
              type="button"
            >
              <ChevronLeft size={16} />
            </button>
            <button
              className="ds-btn ds-btn-ghost ds-cal-nav-btn ds-cal-nav-today"
              onClick={() => setMonth(startOfMonth(new Date()))}
              type="button"
            >
              Today
            </button>
            <button
              className="ds-btn ds-btn-ghost ds-cal-nav-btn"
              aria-label="Next month"
              onClick={() => setMonth((value) => addMonths(value, 1))}
              type="button"
            >
              <ChevronRight size={16} />
            </button>
          </div>
        </div>

        <div className="ds-cal-legend">
          <span className="ds-cal-legend-item is-project">
            <span className="ds-cal-legend-dot" /> Project event
          </span>
          <span className="ds-cal-legend-item is-booked">
            <span className="ds-cal-legend-dot" /> Booked
          </span>
          <span className="ds-cal-legend-item is-open">
            <span className="ds-cal-legend-dot" /> Open slots
          </span>
          <span className="ds-cal-legend-item is-blocked">
            <span className="ds-cal-legend-dot" /> Blocked
          </span>
        </div>

        <div className="ds-cal-weekdays" aria-hidden="true">
          {weekdayLabels.map((day) => (
            <span key={day}>{day}</span>
          ))}
        </div>
        <div className="ds-cal-grid">
          {days.map((day) => {
            const dateKey = format(day, "yyyy-MM-dd");
            const dayProjects = projectsByDate.get(dateKey) ?? [];
            const bookedCount = consultationsByDate.get(dateKey)?.length ?? 0;
            const openCount = slotsByDate.get(dateKey)?.length ?? 0;
            const blocked = blockedSet.has(dateKey);
            const closed = !blocked && !weekdayHasWindow(day, settings.windows);
            const selected = selectedDateKey === dateKey;
            return (
              <button
                type="button"
                key={dateKey}
                className={[
                  "ds-cal-day",
                  blocked ? "is-state-blocked" : closed ? "is-state-closed" : "",
                  !isSameMonth(day, month) ? "is-outside" : "",
                  isToday(day) ? "is-today" : "",
                  selected ? "is-selected" : "",
                ].filter(Boolean).join(" ")}
                onClick={() => setSelectedDateKey(selected ? null : dateKey)}
              >
                <time dateTime={dateKey}>{format(day, "d")}</time>
                {blocked ? <Lock size={11} aria-hidden="true" className="ds-cal-day-lock" /> : null}
                {dayProjects.length > 0 ? (
                  <div className="ds-cal-day-projects">
                    {dayProjects.slice(0, 3).map((project) => (
                      <span
                        className="ds-cal-day-dot"
                        key={project.id}
                        title={String(project.name ?? "Project")}
                      />
                    ))}
                    {dayProjects.length > 3 ? (
                      <span className="ds-cal-day-dot-more">+{dayProjects.length - 3}</span>
                    ) : null}
                  </div>
                ) : null}
                {bookedCount > 0 || (!blocked && !closed && openCount > 0) ? (
                  <div className="ds-cal-day-pills">
                    {bookedCount > 0 ? (
                      <span className="ds-cal-pill ds-cal-pill-booked">{bookedCount} booked</span>
                    ) : null}
                    {!blocked && !closed && openCount > 0 ? (
                      <span className="ds-cal-pill ds-cal-pill-open">{openCount} open</span>
                    ) : null}
                  </div>
                ) : null}
              </button>
            );
          })}
        </div>
        {loadingSettings || consultationsLoading ? (
          <p className="ds-cal-note">Loading availability…</p>
        ) : calendarStatus === "unavailable" ? (
          <p className="ds-cal-note">
            Live calendar sync is unavailable right now — only internal bookings are shown.
            Check its status in <a href="/studio/integrations">Integrations</a>.
          </p>
        ) : null}
      </div>

      {selectedDateKey ? (
        <div className="ds-card ds-cal-panel">
          <div className="ds-cal-panel-head">
            <div>
              <p className="ds-eyebrow">{format(new Date(`${selectedDateKey}T12:00:00`), "EEEE")}</p>
              <h2>{format(new Date(`${selectedDateKey}T12:00:00`), "MMMM d, yyyy")}</h2>
            </div>
            <button
              type="button"
              className="ds-btn ds-btn-ghost ds-btn-sm"
              disabled={blocking}
              onClick={() => toggleBlocked(selectedDateKey)}
            >
              {blockedSet.has(selectedDateKey) ? (
                <>
                  <Unlock size={14} aria-hidden="true" /> Unblock day
                </>
              ) : (
                <>
                  <Lock size={14} aria-hidden="true" /> Block day
                </>
              )}
            </button>
          </div>
          {blockNotice ? <p className="form-notice" role="status">{blockNotice}</p> : null}

          {selectedProjects.length > 0 ? (
            <div className="ds-cal-section">
              <p className="ds-cal-section-label">
                <span className="ds-cal-legend-dot" style={{ color: "var(--ds-brass)" }} />
                Project events
              </p>
              <ul className="ds-cal-list">
                {selectedProjects.map((project) => (
                  <li className="ds-cal-row" key={project.id}>
                    <span className="ds-cal-row-name">{String(project.name ?? "Project")}</span>
                    <a className="ds-cal-row-link" href={`/studio/projects/${project.id}`}>
                      <ArrowUpRight size={13} aria-hidden="true" /> Open project
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {selectedBookings.length > 0 ? (
            <div className="ds-cal-section">
              <p className="ds-cal-section-label">
                <span className="ds-cal-legend-dot" style={{ color: "var(--ds-amber)" }} />
                Booked consultations
              </p>
              <ul className="ds-cal-list">
                {selectedBookings.map((booking) => {
                  const project = projects?.find((value) => value.id === booking.projectId);
                  return (
                    <li className="ds-cal-row" key={booking.id}>
                      <span className="ds-cal-row-time">
                        {format(new Date(String(booking.startsAt)), "h:mm a")} –{" "}
                        {format(new Date(String(booking.endsAt)), "h:mm a")}
                      </span>
                      <span className="ds-cal-row-name">
                        {project ? String(project.name) : "Booked"}
                      </span>
                      {project ? (
                        <a className="ds-cal-row-link" href={`/studio/projects/${project.id}`}>
                          <ArrowUpRight size={13} aria-hidden="true" /> Open project
                        </a>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            </div>
          ) : null}

          <div className="ds-cal-section">
            <p className="ds-cal-section-label">
              <span className="ds-cal-legend-dot" style={{ color: "var(--ds-forest)" }} />
              Open slots
            </p>
            {blockedSet.has(selectedDateKey) ? (
              <p className="ds-cal-empty-note">
                This day is blocked — clients can’t book a consultation here.
              </p>
            ) : selectedSlots.length === 0 ? (
              <p className="ds-cal-empty-note">
                No consultation windows are configured for this day. Set your weekly hours in{" "}
                <a href="/studio/settings">Settings</a>.
              </p>
            ) : (
              <ul className="ds-cal-list">
                {selectedSlots.map((slot) =>
                  selectedBookedKeys.has(slot.startsAt) ? null : (
                    <SlotRow key={slot.startsAt} slot={slot} tenantId={tenantId} />
                  ),
                )}
              </ul>
            )}
          </div>
        </div>
      ) : (
        <div className="ds-card ds-cal-panel ds-cal-panel-empty">
          <CalendarClock size={26} aria-hidden="true" />
          <p>Select a day to see project events, consultations, and open slots — or block the day off.</p>
        </div>
      )}
    </section>
  );
}

function SlotRow({ slot, tenantId }: { slot: ConsultationSlot; tenantId: string }) {
  const [open, setOpen] = useState(false);
  return (
    <li className="ds-cal-row">
      <span className="ds-cal-row-time">
        {format(new Date(slot.startsAt), "h:mm a")} – {format(new Date(slot.endsAt), "h:mm a")}
      </span>
      {open ? (
        <BookSlotForm slot={slot} tenantId={tenantId} onCancel={() => setOpen(false)} />
      ) : (
        <button type="button" className="ds-cal-slot-btn" onClick={() => setOpen(true)}>
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
    <form className="ds-cal-book-form" onSubmit={submit}>
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
      <div className="ds-cal-book-actions">
        <button className="ds-btn ds-btn-primary ds-btn-sm" type="submit" disabled={submitting || booked}>
          {submitting ? "Booking…" : booked ? "Booked" : "Confirm booking"}
        </button>
        <button className="ds-btn ds-btn-ghost ds-btn-sm" type="button" onClick={onCancel} disabled={submitting}>
          Cancel
        </button>
      </div>
      {notice ? <p className="form-notice" role="status">{notice}</p> : null}
    </form>
  );
}
