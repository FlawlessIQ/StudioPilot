"use client";

import { useEffect, useMemo, useState } from "react";
import { CheckCircle2, LoaderCircle, Plus, Trash2, Users } from "lucide-react";
import { Button, ButtonRow, Card, Choices, Field, List, Main, Note, PoweredBy, Row } from "@/components/kit/kit";
import { useWorkspace } from "@/features/auth/workspace-context";
import { dataIsLive } from "@/lib/runtime-mode";
import { friendlyError } from "@/lib/ai/friendly-error";
import { getClientVendorTeam, submitClientVendorTeam } from "@/lib/client/portal-client";
import {
  COUPLE_VENDOR_MAX,
  COUPLE_VENDOR_WHY,
  coupleVendorKindLabel,
  type CoupleVendorRow,
  type CoupleVendorTeamView,
  type CoupleVendorView,
} from "@/features/vendors/couple-team";
import type { VendorType } from "@/features/vendors/schema";
import { displayPhone } from "@/features/vendors/team";

/**
 * "Your vendor team": the other vendors working the day, listed by the
 * client (docs/vendor-network-plan-2026-10-12.md, Phase 1).
 *
 * Compact rows, never expanded cards (mobile queues must be compact); one
 * editor opens for the row being added or changed. Every save sends the
 * client's whole list, so taking a row out takes it off the team. Rows the
 * studio added are shown, not editable — "tell your studio" is the way to
 * change those.
 */

type Draft = { entryId: string | null; category: VendorType | null; company: string; contactName: string; email: string; phone: string };
const EMPTY: Draft = { entryId: null, category: null, company: "", contactName: "", email: "", phone: "" };

const day = (iso: string | null | undefined) =>
  iso ? new Date(`${iso.slice(0, 10)}T12:00:00`).toLocaleDateString("en-US", { month: "long", day: "numeric" }) : "";

function toRow(vendor: CoupleVendorView): CoupleVendorRow {
  return {
    entryId: vendor.entryId,
    category: vendor.category,
    company: vendor.company,
    contactName: vendor.contactName,
    email: vendor.email,
    phone: vendor.phone,
  };
}

export function ClientVendorTeam() {
  const workspace = useWorkspace();
  const studio = workspace.tenantName && !workspace.tenantName.startsWith("Loading") ? workspace.tenantName : "your studio";
  const [view, setView] = useState<CoupleVendorTeamView | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);

  useEffect(() => {
    if (!dataIsLive || !workspace.tenantId || !workspace.projectId) return;
    let live = true;
    void getClientVendorTeam(workspace.tenantId, workspace.projectId)
      .then((result) => live && setView(result.team))
      .catch((caught: unknown) => live && setLoadError(friendlyError(caught, "Your vendor team couldn't be loaded. Try again in a moment.")));
    return () => {
      live = false;
    };
  }, [workspace.tenantId, workspace.projectId]);

  const mine = useMemo(() => (view?.vendors ?? []).filter((vendor) => vendor.addedByCouple), [view]);
  const studios = useMemo(() => (view?.vendors ?? []).filter((vendor) => !vendor.addedByCouple), [view]);
  const kinds = (view?.kinds ?? []).map((kind) => ({ value: kind, label: coupleVendorKindLabel(kind) }));

  async function save(rows: CoupleVendorRow[], message: string) {
    if (!workspace.tenantId || !workspace.projectId) return;
    setBusy(true);
    setError(null);
    try {
      const result = await submitClientVendorTeam(
        workspace.tenantId,
        workspace.projectId,
        rows.length ? { answer: "listed", vendors: rows } : { answer: "none", vendors: [] },
      );
      setView(result.team);
      setDraft(null);
      setSaved(result.alreadyListed.length ? `${message} ${result.alreadyListed.join(", ")} ${result.alreadyListed.length === 1 ? "was" : "were"} already on it.` : message);
    } catch (caught: unknown) {
      setError(friendlyError(caught, "That didn't save. Check your connection and try again."));
    } finally {
      setBusy(false);
    }
  }

  function saveDraft() {
    if (!draft) return;
    if (!draft.category) return setError("Choose what they do.");
    if (!draft.company.trim()) return setError("Add the business name.");
    if (!draft.email.trim() && !draft.phone.trim()) return setError("Add an email or a phone number, so the others can reach them.");
    if (draft.email.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(draft.email.trim())) return setError("That email address doesn't look right.");
    const row: CoupleVendorRow = {
      entryId: draft.entryId,
      category: draft.category,
      company: draft.company.trim(),
      contactName: draft.contactName.trim(),
      email: draft.email.trim() || null,
      phone: draft.phone.trim() || null,
    };
    const others = mine.filter((vendor) => vendor.entryId !== draft.entryId).map(toRow);
    void save([...others, row], draft.entryId ? "Saved." : `${row.company} is on your team.`);
  }

  function remove(entryId: string) {
    const rest = mine.filter((vendor) => vendor.entryId !== entryId).map(toRow);
    void save(rest, "Taken off your team.");
  }

  const answered = view?.answer === "listed" || view?.answer === "none";
  const notAsked = view && !view.ask.available;

  return (
    <Main label="Your vendor team">
      <div className="kit-stack-tight">
        <p className="kit-eyebrow">{workspace.projectName}</p>
        <h1 className="kit-title">Your vendor team</h1>
        <p className="kit-body">{COUPLE_VENDOR_WHY}</p>
      </div>

      {loadError ? <Note tone="danger">{loadError}</Note> : null}
      {!view && !loadError ? (
        <Note icon={LoaderCircle}>Loading…</Note>
      ) : null}

      {notAsked && !(view?.vendors.length) ? (
        <Note>{studio} isn&rsquo;t asking for this one. If something changes, they&rsquo;ll let you know.</Note>
      ) : null}

      {saved ? (
        <Note icon={CheckCircle2} tone="accent">
          {saved}
        </Note>
      ) : answered && view?.answer === "none" && !mine.length ? (
        <Note icon={CheckCircle2} tone="accent">
          {`You told ${studio} there are no other vendors. Booked someone since? Add them below.`}
        </Note>
      ) : view?.ask.dueDate && !answered ? (
        <Note icon={Users} tone="accent">
          {`${studio} would like this by ${day(view.ask.dueDate)}, before the final schedule goes out.`}
        </Note>
      ) : null}

      {error ? <Note tone="danger">{error}</Note> : null}

      {view && !notAsked ? (
        <>
          {mine.length ? (
            <section className="kit-stack-tight" aria-label="Vendors you added">
              <h2 className="kit-subsection">Your vendors</h2>
              <List>
                {mine.map((vendor) => (
                  <Row
                    key={vendor.entryId}
                    onClick={() =>
                      setDraft({
                        entryId: vendor.entryId,
                        category: vendor.category,
                        company: vendor.company,
                        contactName: vendor.contactName,
                        email: vendor.email ?? "",
                        phone: vendor.phone ?? "",
                      })
                    }
                    subtitle={[coupleVendorKindLabel(vendor.category), vendor.contactName, (vendor.phone ? displayPhone(vendor.phone) : vendor.email)].filter(Boolean).join(" · ")}
                    title={vendor.company}
                  />
                ))}
              </List>
            </section>
          ) : null}

          {studios.length ? (
            <section className="kit-stack-tight" aria-label={`Vendors ${studio} added`}>
              <h2 className="kit-subsection">Already with {studio}</h2>
              <List>
                {studios.map((vendor) => (
                  <Row
                    key={vendor.entryId}
                    subtitle={[coupleVendorKindLabel(vendor.category), vendor.contactName].filter(Boolean).join(" · ")}
                    title={vendor.company}
                  />
                ))}
              </List>
              <p className="kit-hint">Something wrong here? Message {studio} and they&rsquo;ll fix it.</p>
            </section>
          ) : null}

          {draft ? (
            <Card>
              <div className="kit-stack-tight">
                <h2 className="kit-subsection">{draft.entryId ? "Change this vendor" : "Add a vendor"}</h2>
                <Choices
                  legend="What do they do?"
                  onChange={(value) => setDraft({ ...draft, category: value as VendorType })}
                  options={kinds}
                  value={draft.category}
                />
                <Field
                  autoComplete="organization"
                  label="Business name"
                  onChange={(event) => setDraft({ ...draft, company: event.target.value })}
                  value={draft.company}
                />
                <Field
                  autoComplete="off"
                  label="Contact name"
                  onChange={(event) => setDraft({ ...draft, contactName: event.target.value })}
                  value={draft.contactName}
                />
                <Field
                  autoComplete="off"
                  inputMode="email"
                  label="Email"
                  onChange={(event) => setDraft({ ...draft, email: event.target.value })}
                  type="email"
                  value={draft.email}
                />
                <Field
                  autoComplete="off"
                  hint="An email or a phone number, so everyone can reach them."
                  inputMode="tel"
                  label="Phone"
                  onChange={(event) => setDraft({ ...draft, phone: event.target.value })}
                  type="tel"
                  value={draft.phone}
                />
                <ButtonRow>
                  <Button disabled={busy} icon={busy ? LoaderCircle : CheckCircle2} onClick={saveDraft}>
                    {busy ? "Saving…" : "Save"}
                  </Button>
                  <Button disabled={busy} onClick={() => setDraft(null)} variant="secondary">
                    Cancel
                  </Button>
                </ButtonRow>
                {draft.entryId ? (
                  <Button disabled={busy} icon={Trash2} onClick={() => remove(draft.entryId!)} variant="danger">
                    Take them off the list
                  </Button>
                ) : null}
              </div>
            </Card>
          ) : (
            <div className="kit-stack-tight">
              {view.suggestions.length && mine.length + studios.length < COUPLE_VENDOR_MAX ? (
                <div className="kit-stack-tight">
                  <p className="kit-hint">From your planning form:</p>
                  <List>
                    {view.suggestions.map((suggestion) => (
                      <Row
                        icon={Plus}
                        key={`${suggestion.category}:${suggestion.company}`}
                        onClick={() => setDraft({ ...EMPTY, category: suggestion.category, company: suggestion.company })}
                        subtitle={`${coupleVendorKindLabel(suggestion.category)} · add their email or phone`}
                        title={suggestion.company}
                      />
                    ))}
                  </List>
                </div>
              ) : null}
              {mine.length < COUPLE_VENDOR_MAX ? (
                <Button icon={Plus} onClick={() => { setSaved(null); setError(null); setDraft({ ...EMPTY }); }} variant={mine.length ? "secondary" : "primary"}>
                  Add a vendor
                </Button>
              ) : null}
              {!mine.length && view.answer !== "none" ? (
                <Button disabled={busy} onClick={() => void save([], "Thanks — noted that there are no other vendors.")} variant="soft">
                  No other vendors
                </Button>
              ) : null}
            </div>
          )}

          <p className="kit-hint">
            {`${studio} shares the final schedule with the vendors you list here and puts everyone’s contact details on it.`}
          </p>
        </>
      ) : null}
      <PoweredBy />
    </Main>
  );
}
