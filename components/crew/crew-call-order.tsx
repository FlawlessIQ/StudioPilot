"use client";

import { useMemo, useState, type ReactNode } from "react";
import { ArrowDown, ArrowUp, LoaderCircle } from "lucide-react";
import { refreshTenantRecords, useTenantDocuments } from "@/components/live/tenant-records";
import { crewActionsProps } from "@/components/crew/crew-record-actions";
import { useWorkspace } from "@/features/auth/workspace-context";
import {
  FIRST_CALL_TRADES,
  moveInOrder,
  ordinal,
  readFirstCall,
  tradeGroups,
  type FirstCall,
} from "@/features/crew/first-call";
import type { CoverageRole } from "@/features/packages/coverage";
import { sendCrewCommand } from "@/lib/crew/command-client";
import { crewPublicError } from "@/lib/crew/public-error";

type Doc = Record<string, unknown> & { id: string };

/**
 * The roster by trade, each trade in the studio's first-call order.
 *
 * GR Productions (2026-10-06): "How do I order crew members for staffing
 * events? And categorize them by types." The page was one alphabetical grid,
 * photographers and videographers mixed, and the only order a studio could
 * set lived on one job's staffing screen. Now each trade is a group in call
 * order — "1st call", "2nd call" — moved with arrows that save at once, and
 * every staffing plan and automatic offer asks in it
 * (features/crew/first-call.ts). People with no trade sit below, one tap from
 * joining a group.
 */
export function CrewCallOrder({
  people,
  firstCall,
  renderCard,
}: {
  people: readonly Doc[];
  firstCall: FirstCall;
  renderCard: (profile: Doc) => ReactNode;
}) {
  const { role } = useWorkspace();
  const canOrder = role === "studio_owner" || role === "studio_admin";
  // A move shows at once and saves behind it. It holds only until the stored
  // order changes (the refresh after the save), so it can never outlive it.
  const [moved, setMoved] = useState<{ basis: FirstCall; value: FirstCall } | null>(null);
  const local = moved && moved.basis === firstCall ? moved.value : firstCall;
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const groups = tradeGroups(people, local);

  async function move(trade: CoverageRole, groupIds: string[], id: string, direction: -1 | 1) {
    const order = moveInOrder(groupIds, id, direction);
    setMoved({ basis: firstCall, value: { ...local, [trade]: order } });
    setBusy(id);
    setNotice(null);
    try {
      await sendCrewCommand("setCrewFirstCall", { trade, order });
      refreshTenantRecords("tenants");
    } catch (caught: unknown) {
      setMoved(null);
      setNotice(crewPublicError(caught, "That order could not be saved."));
    } finally {
      setBusy(null);
    }
  }

  async function giveTrade(profile: Doc, trade: CoverageRole) {
    setBusy(profile.id);
    setNotice(null);
    try {
      const crew = crewActionsProps(profile);
      // The directory edit, with everything else sent back as it is.
      await sendCrewCommand("updateCrewDirectoryEntry", {
        crewProfileId: crew.id,
        name: crew.name,
        email: crew.email,
        specialties: crew.specialties,
        trades: [trade],
        serviceAreas: crew.serviceAreas,
        travelRadiusMiles: crew.travelRadiusMiles,
        rateType: crew.rateType === "hourly" ? "hourly" : "event",
        rateCents: crew.rateCents,
        notes: crew.notes,
      });
      refreshTenantRecords("crewProfiles");
    } catch (caught: unknown) {
      setNotice(crewPublicError(caught, "That type could not be saved."));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="crew-call-order">
      {notice ? (
        <p className="form-notice" role="status">
          {notice}
        </p>
      ) : null}
      {groups.map((group) => {
        if (!group.trade && !group.people.length) return null;
        const trade = group.trade;
        const ids = group.people.map((person) => person.id);
        const one = FIRST_CALL_TRADES.find((entry) => entry.trade === trade)?.one;
        return (
          <section aria-label={group.label} className="crew-type-group" key={trade ?? "none"}>
            <header>
              <h3>
                {group.label} <span>{group.people.length}</span>
              </h3>
              <small>
                {trade
                  ? group.people.length
                    ? `Who you call first for a ${one} job. Offers go out top to bottom, one at a time.`
                    : `Nobody is marked as a ${one} yet.`
                  : "Give each a type so they join a call order."}
              </small>
            </header>
            {group.people.length ? (
              <div className="crew-card-grid">
                {group.people.map((profile, index) => (
                  <div className="crew-call-slot" key={profile.id}>
                    {trade ? (
                      <div className="crew-call-bar">
                        <strong>{ordinal(index + 1)} call</strong>
                        {canOrder && group.people.length > 1 ? (
                          <span>
                            {busy === profile.id ? <LoaderCircle aria-hidden="true" className="spin" size={15} /> : null}
                            <button
                              aria-label={`Call ${String(profile.name ?? "them")} earlier`}
                              className="button button-light crew-call-move"
                              disabled={index === 0 || busy !== null}
                              onClick={() => void move(trade, ids, profile.id, -1)}
                              title="Call earlier"
                              type="button"
                            >
                              <ArrowUp aria-hidden="true" size={15} />
                            </button>
                            <button
                              aria-label={`Call ${String(profile.name ?? "them")} later`}
                              className="button button-light crew-call-move"
                              disabled={index === group.people.length - 1 || busy !== null}
                              onClick={() => void move(trade, ids, profile.id, 1)}
                              title="Call later"
                              type="button"
                            >
                              <ArrowDown aria-hidden="true" size={15} />
                            </button>
                          </span>
                        ) : null}
                      </div>
                    ) : canOrder ? (
                      <div className="crew-call-bar">
                        <strong>Their type</strong>
                        <span>
                          {FIRST_CALL_TRADES.map((entry) => (
                            <button
                              className="button button-light"
                              disabled={busy !== null}
                              key={entry.trade}
                              onClick={() => void giveTrade(profile, entry.trade)}
                              type="button"
                            >
                              {entry.one.charAt(0).toUpperCase() + entry.one.slice(1)}
                            </button>
                          ))}
                        </span>
                      </div>
                    ) : null}
                    {renderCard(profile)}
                  </div>
                ))}
              </div>
            ) : null}
          </section>
        );
      })}
    </div>
  );
}

/**
 * The same order, loading its own records — for Cue's card
 * (components/ai/actions/studio-actions.tsx), where there is no Crew page
 * around it. Each person is a name line rather than the full card.
 */
export function CrewCallOrderPanel() {
  const workspace = useWorkspace();
  const profiles = useTenantDocuments("crewProfiles");
  const tenants = useTenantDocuments("tenants");
  const crewOffers = (tenants.records ?? []).find((entry) => entry.id === workspace.tenantId)?.crewOffers;
  const firstCall = useMemo(() => readFirstCall(crewOffers), [crewOffers]);
  const people = (profiles.records ?? []).filter((profile) => !profile.archivedAt && profile.active !== false);
  if (profiles.loading) return <p className="crew-hub-empty">Loading your crew…</p>;
  if (!people.length) return <p className="crew-hub-empty">No crew yet. Add someone on the Crew page first.</p>;
  return (
    <CrewCallOrder
      firstCall={firstCall}
      people={people}
      renderCard={(profile) => (
        <div className="crew-card">
          <strong>{String(profile.name ?? "Crew member")}</strong>
        </div>
      )}
    />
  );
}
