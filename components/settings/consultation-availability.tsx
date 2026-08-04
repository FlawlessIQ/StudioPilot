"use client";

import { useEffect, useState, type FormEvent } from "react";
import { doc, getDoc } from "firebase/firestore";
import { CalendarClock, X } from "lucide-react";
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

type DayWindow = { open: boolean; start: string; end: string };
type FormState = {
  durationMinutes: number;
  bufferMinutes: number;
  days: Record<WeekdayKey, DayWindow>;
  blockedDates: string[];
};

const defaultDays: Record<WeekdayKey, DayWindow> = {
  sun: { open: false, start: "09:00", end: "17:00" },
  mon: { open: true, start: "09:00", end: "17:00" },
  tue: { open: true, start: "09:00", end: "17:00" },
  wed: { open: true, start: "09:00", end: "17:00" },
  thu: { open: true, start: "09:00", end: "17:00" },
  fri: { open: true, start: "09:00", end: "17:00" },
  sat: { open: false, start: "09:00", end: "17:00" },
};

const defaultState: FormState = {
  durationMinutes: 45,
  bufferMinutes: 15,
  days: defaultDays,
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
        const days: Record<WeekdayKey, DayWindow> = {
          sun: { ...defaultDays.sun, open: false },
          mon: { ...defaultDays.mon, open: false },
          tue: { ...defaultDays.tue, open: false },
          wed: { ...defaultDays.wed, open: false },
          thu: { ...defaultDays.thu, open: false },
          fri: { ...defaultDays.fri, open: false },
          sat: { ...defaultDays.sat, open: false },
        };
        const windows = Array.isArray(data.windows) ? data.windows : [];
        for (const window of windows) {
          const day = String(window.day) as WeekdayKey;
          if (!(day in days)) continue;
          days[day] = {
            open: true,
            start: minutesToTime(Number(window.startMinute)),
            end: minutesToTime(Number(window.endMinute)),
          };
        }
        setForm({
          durationMinutes: Number(data.durationMinutes ?? defaultState.durationMinutes),
          bufferMinutes: Number(data.bufferMinutes ?? defaultState.bufferMinutes),
          days,
          blockedDates: Array.isArray(data.blockedDates)
            ? data.blockedDates.map(String)
            : [],
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

  function updateDay(day: WeekdayKey, patch: Partial<DayWindow>) {
    setForm((current) => ({
      ...current,
      days: { ...current.days, [day]: { ...current.days[day], ...patch } },
    }));
  }

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
      const windows = weekdays
        .filter(({ key }) => form.days[key].open)
        .map(({ key }) => ({
          day: key,
          startMinute: timeToMinutes(form.days[key].start),
          endMinute: timeToMinutes(form.days[key].end),
        }));
      for (const window of windows) {
        if (window.endMinute <= window.startMinute) {
          throw new Error(
            `${weekdays.find((day) => day.key === window.day)?.label}'s close time must be after its open time.`,
          );
        }
      }
      const outcome = await sendBookingCommand({
        type: "setConsultationSettings",
        idempotencyKey: crypto.randomUUID(),
        input: {
          durationMinutes: form.durationMinutes,
          bufferMinutes: form.bufferMinutes,
          windows,
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

        <div className="consultation-availability-days" role="group" aria-label="Weekly hours">
          {weekdays.map(({ key, label }) => {
            const day = form.days[key];
            return (
              <div className="consultation-availability-day" key={key}>
                <label className="consultation-availability-day-toggle">
                  <input
                    type="checkbox"
                    checked={day.open}
                    onChange={(event) => updateDay(key, { open: event.target.checked })}
                  />
                  {label}
                </label>
                <div className="consultation-availability-day-times">
                  <input
                    type="time"
                    aria-label={`${label} opens`}
                    disabled={!day.open}
                    value={day.start}
                    onChange={(event) => updateDay(key, { start: event.target.value })}
                  />
                  <span aria-hidden="true">–</span>
                  <input
                    type="time"
                    aria-label={`${label} closes`}
                    disabled={!day.open}
                    value={day.end}
                    onChange={(event) => updateDay(key, { end: event.target.value })}
                  />
                </div>
              </div>
            );
          })}
        </div>

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
