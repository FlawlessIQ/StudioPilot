"use client";

import { useEffect, useState, type FormEvent } from "react";
import { doc, getDoc } from "firebase/firestore";
import { CalendarClock, Plus, X } from "lucide-react";
import { activeMembership } from "@/lib/firebase/active-membership";
import { getFirebaseClient } from "@/lib/firebase/client";
import { dataIsLive } from "@/lib/runtime-mode";
import { sendBookingCommand } from "@/lib/booking/command-client";

const weekdays = [
  { key: "sun", label: "Sunday" },
  { key: "mon", label: "Monday" },
  { key: "tue", label: "Tuesday" },
  { key: "wed", label: "Wednesday" },
  { key: "thu", label: "Thursday" },
  { key: "fri", label: "Friday" },
  { key: "sat", label: "Saturday" },
] as const;
type WeekdayKey = (typeof weekdays)[number]["key"];

type TimeRange = { start: string; end: string };
type WeeklyWindows = Record<WeekdayKey, TimeRange[]>;
type AvailabilityMode = "closed_default" | "open_default";

type FormState = {
  durationMinutes: number;
  bufferMinutes: number;
  mode: AvailabilityMode;
  // Bookable hours in closed_default mode; the outer envelope (the widest
  // hours ever considered) in open_default mode.
  windows: WeeklyWindows;
  // Only meaningful in open_default mode — carve-outs subtracted from
  // `windows`. Ignored (and not sent) in closed_default mode.
  unavailable: WeeklyWindows;
  blockedDates: string[];
};

function emptyWeek(): WeeklyWindows {
  return { sun: [], mon: [], tue: [], wed: [], thu: [], fri: [], sat: [] };
}

const defaultWindows: WeeklyWindows = {
  ...emptyWeek(),
  mon: [{ start: "09:00", end: "17:00" }],
  tue: [{ start: "09:00", end: "17:00" }],
  wed: [{ start: "09:00", end: "17:00" }],
  thu: [{ start: "09:00", end: "17:00" }],
  fri: [{ start: "09:00", end: "17:00" }],
};

const defaultState: FormState = {
  durationMinutes: 45,
  bufferMinutes: 15,
  mode: "closed_default",
  windows: defaultWindows,
  unavailable: emptyWeek(),
  blockedDates: [],
};

function minutesToTime(minutes: number): string {
  const hour = Math.floor(minutes / 60);
  const minute = minutes % 60;
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

function timeToMinutes(value: string): number {
  const [hour, minute] = value.split(":").map(Number);
  return (hour || 0) * 60 + (minute || 0);
}

function windowsFromDocField(value: unknown): WeeklyWindows {
  const result = emptyWeek();
  if (!Array.isArray(value)) return result;
  for (const window of value) {
    const day = String(window?.day) as WeekdayKey;
    if (!(day in result)) continue;
    result[day].push({
      start: minutesToTime(Number(window.startMinute)),
      end: minutesToTime(Number(window.endMinute)),
    });
  }
  return result;
}

function windowsToDocField(value: WeeklyWindows) {
  return weekdays.flatMap(({ key }) =>
    value[key].map((range) => ({
      day: key,
      startMinute: timeToMinutes(range.start),
      endMinute: timeToMinutes(range.end),
    })),
  );
}

function validateWeek(value: WeeklyWindows) {
  for (const { key, label } of weekdays) {
    for (const range of value[key]) {
      if (timeToMinutes(range.end) <= timeToMinutes(range.start)) {
        throw new Error(`${label}'s end time must be after its start time.`);
      }
    }
  }
}

/** One weekday's list of time ranges, with add/remove — reused for both the
    open-hours editor and the (mode-conditional) unavailable-hours editor. */
function WeekdayWindowEditor({
  value,
  onChange,
  addLabel,
}: {
  value: WeeklyWindows;
  onChange: (next: WeeklyWindows) => void;
  addLabel: string;
}) {
  function updateRange(day: WeekdayKey, index: number, patch: Partial<TimeRange>) {
    const next = { ...value, [day]: value[day].map((range, i) => (i === index ? { ...range, ...patch } : range)) };
    onChange(next);
  }
  function addRange(day: WeekdayKey) {
    onChange({ ...value, [day]: [...value[day], { start: "09:00", end: "17:00" }] });
  }
  function removeRange(day: WeekdayKey, index: number) {
    onChange({ ...value, [day]: value[day].filter((_, i) => i !== index) });
  }

  return (
    <div className="consultation-availability-days" role="group">
      {weekdays.map(({ key, label }) => (
        <div className="consultation-availability-day" key={key}>
          <strong>{label}</strong>
          {value[key].length === 0 ? <span className="consultation-availability-day-closed">Closed</span> : null}
          {value[key].map((range, index) => (
            <div className="consultation-availability-day-times" key={index}>
              <input
                type="time"
                aria-label={`${label} range ${index + 1} starts`}
                value={range.start}
                onChange={(event) => updateRange(key, index, { start: event.target.value })}
              />
              <span aria-hidden="true">–</span>
              <input
                type="time"
                aria-label={`${label} range ${index + 1} ends`}
                value={range.end}
                onChange={(event) => updateRange(key, index, { end: event.target.value })}
              />
              <button
                type="button"
                aria-label={`Remove this ${label} time range`}
                onClick={() => removeRange(key, index)}
              >
                <X aria-hidden="true" size={14} />
              </button>
            </div>
          ))}
          <button type="button" className="consultation-availability-add-range" onClick={() => addRange(key)}>
            <Plus aria-hidden="true" size={14} /> {addLabel}
          </button>
        </div>
      ))}
    </div>
  );
}

export function ConsultationAvailability() {
  const [form, setForm] = useState<FormState>(defaultState);
  const [timezone, setTimezone] = useState("");
  const [loading, setLoading] = useState(dataIsLive);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [newBlockedDate, setNewBlockedDate] = useState("");

  useEffect(() => {
    let active = true;
    async function load() {
      if (!dataIsLive) return;
      try {
        const { auth, firestore } = getFirebaseClient();
        const user = auth.currentUser;
        if (!user) throw new Error("Sign in to manage consultation availability.");
        const membership = await activeMembership(firestore, user.uid);
        const tenantId = String(membership.get("tenantId") ?? "");
        const [tenant, settings] = await Promise.all([
          getDoc(doc(firestore, "tenants", tenantId)),
          getDoc(doc(firestore, "consultationSettings", tenantId)),
        ]);
        if (!active) return;
        setTimezone(String(tenant.get("timezone") ?? "America/New_York"));
        if (!settings.exists()) return;
        const data = settings.data();
        setForm({
          durationMinutes: Number(data.durationMinutes ?? defaultState.durationMinutes),
          bufferMinutes: Number(data.bufferMinutes ?? defaultState.bufferMinutes),
          mode: data.mode === "open_default" ? "open_default" : "closed_default",
          windows: windowsFromDocField(data.windows),
          unavailable: windowsFromDocField(data.unavailableWindows),
          blockedDates: Array.isArray(data.blockedDates) ? data.blockedDates.map(String) : [],
        });
      } catch (caught: unknown) {
        if (active) {
          setNotice(
            caught instanceof Error
              ? caught.message
              : "Consultation availability is unavailable.",
          );
        }
      } finally {
        if (active) setLoading(false);
      }
    }
    void load();
    return () => {
      active = false;
    };
  }, []);

  function addBlockedDate() {
    if (!newBlockedDate || form.blockedDates.includes(newBlockedDate)) return;
    setForm((current) => ({
      ...current,
      blockedDates: [...current.blockedDates, newBlockedDate].sort(),
    }));
    setNewBlockedDate("");
  }

  function removeBlockedDate(date: string) {
    setForm((current) => ({
      ...current,
      blockedDates: current.blockedDates.filter((value) => value !== date),
    }));
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setNotice(null);
    try {
      validateWeek(form.windows);
      if (form.mode === "open_default") {
        validateWeek(form.unavailable);
        if (windowsToDocField(form.windows).length === 0) {
          throw new Error(
            "Open-by-default mode needs at least one day with an hours envelope — set the widest hours you'd ever take a consultation, then mark specific times unavailable below.",
          );
        }
      }
      const outcome = await sendBookingCommand({
        type: "setConsultationSettings",
        idempotencyKey: crypto.randomUUID(),
        input: {
          durationMinutes: form.durationMinutes,
          bufferMinutes: form.bufferMinutes,
          mode: form.mode,
          windows: windowsToDocField(form.windows),
          unavailableWindows: form.mode === "open_default" ? windowsToDocField(form.unavailable) : [],
          blockedDates: form.blockedDates,
        },
      });
      setNotice(
        outcome.mode === "preview"
          ? "Preview saved for this session. Connect the booking service to publish real availability."
          : "Consultation availability saved. Clients booking a consultation will see these windows.",
      );
    } catch (caught: unknown) {
      setNotice(
        caught instanceof Error
          ? caught.message
          : "Consultation availability could not be saved.",
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <section
      className="panel consultation-availability"
      aria-labelledby="consultation-availability-title"
    >
      <form onSubmit={save}>
        <div className="email-branding-heading">
          <span className="data-control-icon">
            <CalendarClock aria-hidden="true" />
          </span>
          <div>
            <p className="eyebrow">Client scheduling</p>
            <h2 id="consultation-availability-title">Consultation availability</h2>
            <p>
              Set the hours clients can book a consultation on your public scheduling
              link{timezone ? ` (studio timezone: ${timezone})` : ""}.
            </p>
          </div>
        </div>

        <div className="consultation-availability-mode" role="radiogroup" aria-label="Availability mode">
          <label>
            <input
              type="radio"
              name="availability-mode"
              checked={form.mode === "closed_default"}
              onChange={() => setForm((current) => ({ ...current, mode: "closed_default" }))}
            />
            <span>
              <strong>Closed by default</strong>
              <small>Set the specific hours you&apos;re available — everything else is closed.</small>
            </span>
          </label>
          <label>
            <input
              type="radio"
              name="availability-mode"
              checked={form.mode === "open_default"}
              onChange={() => setForm((current) => ({ ...current, mode: "open_default" }))}
            />
            <span>
              <strong>Open by default</strong>
              <small>Set your widest possible hours, then mark specific times unavailable.</small>
            </span>
          </label>
        </div>

        <div className="consultation-availability-durations">
          <label>
            Consultation length (minutes)
            <input
              type="number"
              min={15}
              max={120}
              step={5}
              required
              value={form.durationMinutes}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  durationMinutes: Number(event.target.value),
                }))
              }
            />
          </label>
          <label>
            Buffer between bookings (minutes)
            <input
              type="number"
              min={0}
              max={60}
              step={5}
              required
              value={form.bufferMinutes}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  bufferMinutes: Number(event.target.value),
                }))
              }
            />
          </label>
        </div>

        <div className="consultation-availability-section">
          <p className="consultation-availability-section-label">
            {form.mode === "open_default" ? "Widest possible hours" : "Hours you're available"}
          </p>
          <WeekdayWindowEditor
            value={form.windows}
            onChange={(windows) => setForm((current) => ({ ...current, windows }))}
            addLabel="Add time range"
          />
        </div>

        {form.mode === "open_default" ? (
          <div className="consultation-availability-section">
            <p className="consultation-availability-section-label">Mark unavailable</p>
            <WeekdayWindowEditor
              value={form.unavailable}
              onChange={(unavailable) => setForm((current) => ({ ...current, unavailable }))}
              addLabel="Add unavailable range"
            />
          </div>
        ) : null}

        <div className="consultation-availability-blocked">
          <label>
            Block a specific date
            <span className="consultation-availability-blocked-add">
              <input
                type="date"
                value={newBlockedDate}
                onChange={(event) => setNewBlockedDate(event.target.value)}
              />
              <button type="button" className="button" onClick={addBlockedDate}>
                Add
              </button>
            </span>
          </label>
          {form.blockedDates.length > 0 ? (
            <ul className="consultation-availability-blocked-list">
              {form.blockedDates.map((date) => (
                <li key={date}>
                  {date}
                  <button
                    type="button"
                    aria-label={`Remove ${date} from blocked dates`}
                    onClick={() => removeBlockedDate(date)}
                  >
                    <X aria-hidden="true" />
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
        </div>

        <div className="email-branding-actions">
          <button className="button button-dark" type="submit" disabled={loading || saving}>
            {saving ? "Saving…" : "Save availability"}
          </button>
          {notice ? (
            <p className="form-notice" role="status">
              {notice}
            </p>
          ) : null}
        </div>
      </form>
    </section>
  );
}
