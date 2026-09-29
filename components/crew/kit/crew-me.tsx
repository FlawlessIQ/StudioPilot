"use client";

import { useState, type KeyboardEvent } from "react";
import { CalendarDays, CheckCircle2, Plus, ShieldCheck, X } from "lucide-react";
import { Actions, Button, Card, Choices, Field, List, Main, Note, Pill, PoweredBy, Row } from "@/components/kit/kit";
import { SignOutButton } from "@/features/auth/auth-boundary";
import { initials } from "@/features/auth/workspace-context";
import { statusLabel } from "@/features/format/status-label";
import { COVERAGE_ROLES, coverageRoleLabel, type CoverageRole } from "@/features/packages/coverage";
import { crewPublicError } from "@/lib/crew/public-error";
import {
  crewCommand,
  CrewLoadState,
  list,
  number,
  record,
  text,
  useCrewData,
  type CrewData,
  type Value,
} from "@/components/crew/kit/crew-data";
import { ProfileDocumentSend } from "@/components/crew/kit/crew-parts";

const capitalise = (value: string) => value.slice(0, 1).toLocaleUpperCase() + value.slice(1);

/**
 * Me: profile and account in one screen (M6 of
 * docs/mobile-first-client-crew-plan-2026-09-28.md). Lists that were typed
 * as comma-separated text are chips you add to; what you shoot is a pair of
 * chips; papers go in with the camera.
 */
export function CrewMe() {
  const data = useCrewData();
  if (data.loading || data.error) return <CrewLoadState data={data} title="Me" />;
  if (!data.profile)
    return (
      <Main label="Me">
        <h1 className="kit-title">Me</h1>
        <Card>
          <p className="kit-body" role="status">
            Your studio hasn&rsquo;t linked your crew profile yet. It appears here once they have.
          </p>
        </Card>
        <SignOutButton className="kit-button kit-signout" />
        <PoweredBy />
      </Main>
    );
  return <Profile data={data} key={data.profile.id} profile={data.profile} />;
}

function Profile({ data, profile }: { data: CrewData; profile: Value }) {
  const emergency = record(profile.emergencyContact);
  const [phone, setPhone] = useState(text(profile.phone));
  // What this person shoots, so the studio asks the right people. See
  // features/packages/coverage.ts: `trades`, not a substring of specialties.
  const [trades, setTrades] = useState<CoverageRole[]>(
    list(profile.trades).map(String).filter((item): item is CoverageRole => COVERAGE_ROLES.includes(item as CoverageRole)),
  );
  const [specialties, setSpecialties] = useState(list(profile.specialties).map(String));
  const [areas, setAreas] = useState(list(profile.serviceAreas).map(String));
  const [radius, setRadius] = useState(String(number(profile.travelRadiusMiles)));
  const [equipment, setEquipment] = useState(list(profile.equipment).map(String));
  const [contactName, setContactName] = useState(text(emergency.name));
  const [contactPhone, setContactPhone] = useState(text(emergency.phone));
  const [relationship, setRelationship] = useState(text(emergency.relationship));
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const touch = <T,>(set: (value: T) => void) => (value: T) => {
    set(value);
    setDirty(true);
    setSaved(false);
  };

  async function save() {
    const partialContact = [contactName, contactPhone, relationship].filter((item) => item.trim()).length;
    if (partialContact && partialContact < 3) return setError("An emergency contact needs a name, a phone and who they are to you.");
    setBusy(true);
    setError(null);
    try {
      await crewCommand("updateCrewProfile", {
        crewProfileId: profile.id,
        phone: phone.trim() || null,
        specialties,
        trades,
        serviceAreas: areas,
        travelRadiusMiles: Math.max(0, Math.min(500, Math.round(Number(radius) || 0))),
        equipment,
        emergencyContact:
          partialContact === 3
            ? { name: contactName.trim(), phone: contactPhone.trim(), relationship: relationship.trim() }
            : null,
      });
      setDirty(false);
      setSaved(true);
      data.refresh();
    } catch (caught: unknown) {
      setError(crewPublicError(caught, "Your profile couldn't be saved.", "CREW_PROFILE_UPDATE_FAILED"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Main label="Me">
        <div className="kit-profile-head">
          <span aria-hidden className="kit-avatar">
            {initials(text(profile.name, "Crew"))}
          </span>
          <span className="kit-stack-tight">
            <h1 className="kit-title">{text(profile.name, "Your profile")}</h1>
            <Pill tone={profile.active ? "accent" : undefined}>{profile.active ? "Active" : "With your studio for review"}</Pill>
          </span>
        </div>
        {saved ? (
          <Note icon={CheckCircle2} tone="accent">
            Saved.
          </Note>
        ) : null}

        <List>
          <Row href="/crew/availability" icon={CalendarDays} subtitle="Mark when you can work" title="Your calendar" />
        </List>

        <section aria-label="Your work" className="kit-stack">
          <h2 className="kit-subsection">Your work</h2>
          <Choices
            legend="You shoot"
            multiple
            onChange={(next) => touch(setTrades)(next as CoverageRole[])}
            options={COVERAGE_ROLES.map((role) => ({ value: role, label: capitalise(coverageRoleLabel(role, 1)) }))}
            value={trades}
          />
          <ChipInput
            hint="The kind of event you shoot, like weddings or portraits."
            label="Specialties"
            max={20}
            onChange={touch(setSpecialties)}
            values={specialties}
          />
          <ChipInput label="Where you work" max={20} onChange={touch(setAreas)} values={areas} />
          <Field
            inputMode="numeric"
            label="How far you'll travel (miles)"
            onChange={(event) => touch(setRadius)(event.target.value.replace(/\D/g, ""))}
            value={radius}
          />
          <ChipInput label="Your gear" max={50} onChange={touch(setEquipment)} values={equipment} />
        </section>

        <section aria-label="Contact" className="kit-stack">
          <h2 className="kit-subsection">Contact</h2>
          <Field autoComplete="tel" inputMode="tel" label="Your phone" onChange={(event) => touch(setPhone)(event.target.value)} type="tel" value={phone} />
          <p className="kit-caption">In an emergency on a job, who should the studio call?</p>
          <Field label="Emergency contact" onChange={(event) => touch(setContactName)(event.target.value)} value={contactName} />
          <Field inputMode="tel" label="Their phone" onChange={(event) => touch(setContactPhone)(event.target.value)} type="tel" value={contactPhone} />
          <Field label="Who they are to you" onChange={(event) => touch(setRelationship)(event.target.value)} placeholder="Partner, parent…" value={relationship} />
        </section>

        <section aria-label="Your papers" className="kit-stack">
          <h2 className="kit-subsection">Your papers</h2>
          <div className="kit-stack-tight">
            <strong>W-9</strong>
            <ProfileDocumentSend crewProfileId={profile.id} kind="w9" onSent={data.refresh} status={text(profile.w9Status)} />
          </div>
          <div className="kit-stack-tight">
            <strong>Certificate of insurance</strong>
            <ProfileDocumentSend crewProfileId={profile.id} kind="insurance" onSent={data.refresh} status={text(profile.insuranceStatus)} />
          </div>
          {/* The crew agreement is the studio's to issue, so it stays a status. */}
          <p className="kit-caption">{`Crew agreement: ${statusLabel(profile.contractStatus) || "not sent yet"}. Your studio sends it for signing.`}</p>
        </section>

        <Note icon={ShieldCheck}>
          You only see the jobs, contacts, files and schedules your studio shares with you. Only the studio sees these details.
        </Note>
        <SignOutButton className="kit-button kit-signout" />
        <PoweredBy />
      </Main>

      {dirty ? (
        <Actions>
          {error ? (
            <p className="kit-error" role="alert">
              {error}
            </p>
          ) : null}
          <Button disabled={busy} onClick={() => void save()}>
            {busy ? "Saving…" : "Save changes"}
          </Button>
        </Actions>
      ) : null}
    </>
  );
}

/** A list typed one item at a time: Enter or Add makes a chip, × removes one. */
function ChipInput({
  label,
  hint,
  values,
  onChange,
  max,
}: {
  label: string;
  hint?: string;
  values: string[];
  onChange: (next: string[]) => void;
  max: number;
}) {
  const [draft, setDraft] = useState("");
  const add = () => {
    const value = draft.trim().replace(/,$/, "");
    if (!value || values.includes(value) || values.length >= max) return setDraft("");
    onChange([...values, value]);
    setDraft("");
  };
  return (
    <div className="kit-stack-tight">
      <Field
        hint={hint}
        label={label}
        onBlur={add}
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={(event: KeyboardEvent<HTMLInputElement>) => {
          if (event.key === "Enter" || event.key === ",") {
            event.preventDefault();
            add();
          }
        }}
        placeholder="Type, then Add"
        value={draft}
      />
      <span className="kit-chip-list">
        {values.map((value) => (
          <button
            aria-label={`Remove ${value}`}
            className="kit-chip"
            aria-pressed
            key={value}
            onClick={() => onChange(values.filter((item) => item !== value))}
            type="button"
          >
            {value} <X aria-hidden size={14} />
          </button>
        ))}
        {draft.trim() ? (
          // mousedown would blur the field first, which adds it once already.
          <button className="kit-chip" onClick={add} onMouseDown={(event) => event.preventDefault()} type="button">
            <Plus aria-hidden size={14} /> Add
          </button>
        ) : null}
      </span>
    </div>
  );
}
