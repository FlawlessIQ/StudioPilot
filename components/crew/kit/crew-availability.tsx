"use client";

import { useMemo, useState } from "react";
import { CalendarPlus, ChevronLeft, ChevronRight, RotateCcw, Trash2 } from "lucide-react";
import {
  Button,
  Card,
  Choices,
  Field,
  KitRoot,
  List,
  Main,
  Note,
  Pill,
  PoweredBy,
  Row,
} from "@/components/kit/kit";
import { SheetDialog } from "@/components/ui/sheet-dialog";
import { useWorkspace } from "@/features/auth/workspace-context";
import { availabilityNeedsFutureWindows } from "@/features/crew/availability-moment";
import { daysFromWindow, describeAvailability, localDay, windowFromDays } from "@/features/crew/availability-days";
import { crewPublicError } from "@/lib/crew/public-error";
import { crewCommand, CrewLoadState, text, useCrewData, type Value } from "@/components/crew/kit/crew-data";

type Status = "available" | "tentative" | "unavailable";
const STATUS_OPTIONS: ReadonlyArray<{ value: Status; label: string }> = [
  { value: "available", label: "I'm free" },
  { value: "tentative", label: "Maybe" },
  { value: "unavailable", label: "I'm away" },
];
const STATUS_WORD: Record<Status, string> = { available: "Free", tentative: "Maybe", unavailable: "Away" };

const dayStart = (iso: string) => new Date(`${iso}T00:00:00`);

/** The windows touching a given day. */
function windowsOn(windows: readonly Value[], day: string): Value[] {
  const start = dayStart(day).valueOf();
  const end = start + 86_400_000;
  return windows.filter((item) => Date.parse(text(item.startsAt)) < end && Date.parse(text(item.endsAt)) > start);
}

/**
 * Availability as a month (M6 of docs/mobile-first-client-crew-plan-2026-09-28.md).
 *
 * Tap a day to say you're free, maybe or away, for that day or through a
 * later one; tap a marked day to change or remove it, with an undo. It was a
 * five-column form, and delete had no confirmation. Accepting a job is still
 * what books you; this only tells studios when to ask.
 */
export function CrewAvailability() {
  const workspace = useWorkspace();
  const data = useCrewData();
  const [now] = useState(() => Date.now());
  const today = localDay(new Date(now));
  const [month, setMonth] = useState(() => today.slice(0, 7));
  const [local, setLocal] = useState<Value[] | null>(null);
  const [picked, setPicked] = useState<string | null>(null);
  const [editing, setEditing] = useState<Value | null>(null);
  const [status, setStatus] = useState<Status>("unavailable");
  const [until, setUntil] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [removed, setRemoved] = useState<Value | null>(null);

  const windows = useMemo(
    () => (local ?? data.availability).filter((item) => !item.archivedAt),
    [data.availability, local],
  );
  const booked = useMemo(
    () =>
      new Set(
        data.assignments
          .filter((item) => item.status === "accepted")
          .map((item) => localDay(new Date(String(item.arrivalAt)))),
      ),
    [data.assignments],
  );

  if (data.loading || data.error) return <CrewLoadState data={data} title="Calendar" />;
  if (!data.profile)
    return (
      <Main label="Calendar">
        <h1 className="kit-title">Calendar</h1>
        <Card>
          <p className="kit-body" role="status">
            Your studio links your profile first; then you can mark your dates here.
          </p>
        </Card>
        <PoweredBy />
      </Main>
    );

  const [year, monthIndex] = month.split("-").map(Number) as [number, number];
  const first = new Date(year, monthIndex - 1, 1);
  const daysInMonth = new Date(year, monthIndex, 0).getDate();
  const lead = (first.getDay() + 6) % 7; // weeks start on Monday
  const cells = [
    ...Array.from({ length: lead }, () => null),
    ...Array.from({ length: daysInMonth }, (_, index) => `${month}-${String(index + 1).padStart(2, "0")}`),
  ];
  const shift = (by: number) => {
    const next = new Date(year, monthIndex - 1 + by, 1);
    setMonth(`${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, "0")}`);
  };
  const upcoming = windows
    .filter((item) => Date.parse(text(item.endsAt)) > now)
    .sort((a, b) => text(a.startsAt).localeCompare(text(b.startsAt)));

  function openDay(day: string) {
    const existing = windowsOn(windows, day)[0] ?? null;
    openWindow(existing, day);
  }
  function openWindow(item: Value | null, day?: string) {
    const days = item ? daysFromWindow(text(item.startsAt), text(item.endsAt)) : null;
    setEditing(item);
    setPicked(days?.firstDay ?? day ?? today);
    setStatus(((item ? text(item.status) : "") as Status) || "unavailable");
    setUntil(days && days.lastDay !== days.firstDay ? days.lastDay : "");
    setNote(text(item?.notes));
    setError(null);
  }

  async function save() {
    if (!picked) return;
    // Days, not minutes: see features/crew/availability-days.ts.
    const range = windowFromDays({ firstDay: picked, lastDay: until || picked, startTime: null, endTime: null });
    if ("problem" in range) return setError(range.problem);
    setBusy(true);
    setError(null);
    try {
      const input = {
        startsAt: range.startsAt.toISOString(),
        endsAt: range.endsAt.toISOString(),
        status,
        notes: note.trim() || null,
      };
      await crewCommand(
        editing ? "updateAvailability" : "setAvailability",
        editing ? { availabilityId: editing.id, ...input } : { crewProfileId: data.profile!.id, ...input },
      );
      const saved = { id: editing?.id ?? `local-${Date.now()}`, ...input } as Value;
      setLocal((current) => [...(current ?? data.availability).filter((item) => item.id !== saved.id), saved]);
      setPicked(null);
      data.refresh();
    } catch (caught: unknown) {
      setError(crewPublicError(caught, "Your dates couldn't be saved.", "CREW_AVAILABILITY_SAVE_FAILED"));
    } finally {
      setBusy(false);
    }
  }

  async function remove(item: Value) {
    setBusy(true);
    setError(null);
    try {
      await crewCommand("deleteAvailability", { availabilityId: item.id });
      setLocal((current) => (current ?? data.availability).filter((entry) => entry.id !== item.id));
      setRemoved(item);
      setPicked(null);
      data.refresh();
    } catch (caught: unknown) {
      setError(crewPublicError(caught, "That couldn't be removed.", "CREW_AVAILABILITY_REMOVE_FAILED"));
    } finally {
      setBusy(false);
    }
  }

  async function undo() {
    if (!removed) return;
    const item = removed;
    setRemoved(null);
    try {
      const input = {
        startsAt: text(item.startsAt),
        endsAt: text(item.endsAt),
        status: text(item.status, "available"),
        notes: text(item.notes) || null,
      };
      await crewCommand("setAvailability", { crewProfileId: data.profile!.id, ...input });
      setLocal((current) => [...(current ?? data.availability), { ...item, id: `local-${Date.now()}` }]);
      data.refresh();
    } catch (caught: unknown) {
      setError(crewPublicError(caught, "That couldn't be put back.", "CREW_AVAILABILITY_SAVE_FAILED"));
    }
  }

  return (
    <>
      <Main label="Calendar">
        <div className="kit-stack-tight">
          <p className="kit-eyebrow">Your calendar</p>
          <h1 className="kit-title">When you can work</h1>
          <p className="kit-body">Tap a day to mark it. Accepting a job is what actually books you.</p>
        </div>

        {availabilityNeedsFutureWindows(windows.map((item) => text(item.endsAt)), new Date(now)) ? (
          <Note icon={CalendarPlus}>
            {`${windows.length ? "Every date you've marked has passed." : "No dates marked yet."} Studios can only offer you work on dates they know about.`}
          </Note>
        ) : null}

        {removed ? (
          <Note>
            {`Removed ${describeAvailability(text(removed.startsAt), text(removed.endsAt))}.`}{" "}
            <button className="kit-link-button" onClick={() => void undo()} type="button">
              <RotateCcw aria-hidden size={14} /> Undo
            </button>
          </Note>
        ) : null}

        <Card>
          <div className="kit-month-head">
            <button aria-label="Previous month" className="kit-icon-button" onClick={() => shift(-1)} type="button">
              <ChevronLeft aria-hidden size={20} />
            </button>
            <h2 className="kit-section">
              {first.toLocaleDateString("en-US", { month: "long", year: "numeric" })}
            </h2>
            <button aria-label="Next month" className="kit-icon-button" onClick={() => shift(1)} type="button">
              <ChevronRight aria-hidden size={20} />
            </button>
          </div>
          <div aria-hidden className="kit-month-grid kit-month-weekdays">
            {["M", "T", "W", "T", "F", "S", "S"].map((letter, index) => (
              <span key={index}>{letter}</span>
            ))}
          </div>
          <div className="kit-month-grid">
            {cells.map((day, index) => {
              if (!day) return <span key={`blank-${index}`} />;
              const on = windowsOn(windows, day)[0];
              const state = on ? (text(on.status) as Status) : undefined;
              const past = day < today;
              return (
                <button
                  aria-label={`${new Date(`${day}T12:00:00`).toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" })}${state ? `, ${STATUS_WORD[state]}` : ""}${booked.has(day) ? ", booked" : ""}`}
                  className="kit-month-day"
                  data-booked={booked.has(day) || undefined}
                  data-state={state}
                  data-today={day === today || undefined}
                  disabled={past}
                  key={day}
                  onClick={() => openDay(day)}
                  type="button"
                >
                  {Number(day.slice(8))}
                </button>
              );
            })}
          </div>
          <div className="kit-month-legend" aria-hidden>
            <span data-state="available">Free</span>
            <span data-state="tentative">Maybe</span>
            <span data-state="unavailable">Away</span>
            <span data-booked>Booked</span>
          </div>
        </Card>

        {upcoming.length ? (
          <section aria-label="Your dates" className="kit-stack-tight">
            <h2 className="kit-subsection">Your dates</h2>
            <List>
              {upcoming.map((item) => (
                <Row
                  key={item.id}
                  onClick={() => openWindow(item)}
                  subtitle={text(item.notes) || undefined}
                  title={describeAvailability(text(item.startsAt), text(item.endsAt))}
                  trailing={
                    <Pill tone={item.status === "unavailable" ? "danger" : item.status === "available" ? "accent" : undefined}>
                      {STATUS_WORD[(text(item.status) as Status) || "available"] ?? text(item.status)}
                    </Pill>
                  }
                />
              ))}
            </List>
          </section>
        ) : null}
        {error && !picked ? (
          <p className="kit-error" role="alert">
            {error}
          </p>
        ) : null}
        <PoweredBy />
      </Main>

      <SheetDialog
        label={picked ? new Date(`${picked}T12:00:00`).toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" }) : "Your dates"}
        onClose={() => (busy ? undefined : setPicked(null))}
        open={picked !== null}
      >
        <KitRoot className="kit-embed kit-sheet" studio={{ color: workspace.tenantBrand?.primaryColor ?? null }}>
          <div className="kit-stack">
            <Choices legend="This day" onChange={(next) => setStatus(next as Status)} options={STATUS_OPTIONS} value={status} />
            <Field
              hint="Leave empty for just this day."
              label="Through (optional)"
              min={picked ?? undefined}
              onChange={(event) => setUntil(event.target.value)}
              type="date"
              value={until}
            />
            <Field label="Note (optional)" maxLength={1000} onChange={(event) => setNote(event.target.value)} value={note} />
            {error ? (
              <p className="kit-error" role="alert">
                {error}
              </p>
            ) : null}
            <Button disabled={busy} onClick={() => void save()}>
              {busy ? "Saving…" : editing ? "Save changes" : "Save"}
            </Button>
            {editing ? (
              <Button disabled={busy} icon={Trash2} onClick={() => void remove(editing)} variant="secondary">
                Remove these dates
              </Button>
            ) : null}
          </div>
        </KitRoot>
      </SheetDialog>
    </>
  );
}
