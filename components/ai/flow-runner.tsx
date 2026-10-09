"use client";

import { useState } from "react";
import { ClipboardList, LoaderCircle, PackageOpen, Send, Users } from "lucide-react";
import { refreshTenantRecords, useTenantDocuments } from "@/components/live/tenant-records";
import { runProposalCommand } from "@/lib/proposals/command-client";
import { useWorkspace } from "@/features/auth/workspace-context";
import { tradeVocab } from "@/features/trades/trades";
import { sendCrewCommand } from "@/lib/crew/command-client";
import { runCrmCommand } from "@/lib/crm/command-client";
import { sendPlanningCommand } from "@/lib/planning/command-client";
import { crewPublicError } from "@/lib/crew/public-error";
// `caught.message.replaceAll("_", " ")` turned a thrown code straight into
// user-facing copy — the studio read "INVALID COMMAND:discount". friendlyError
// already carries copy for these codes, including the field detail.
import { friendlyError } from "@/lib/ai/friendly-error";
import {
  rankCrewCandidates,
  type CrewCandidateInput,
} from "@/features/crew/cascade";
import {
  coverageRoleForLabel,
  rolesToBook,
  ownerShootsJob,
} from "@/features/crew/staffing-plan";
import { resolveCoverage } from "@/features/packages/coverage";
import { isCataloguePackage } from "@/features/packages/one-off";
import {
  crewRequirementsFor,
  requireInsuranceOf,
  type CrewRequirementSettings,
} from "@/features/crew/requirements";
import { readFirstCall } from "@/features/crew/first-call";
import {
  matchSubject,
  unmatchedSubjectNotice,
} from "@/features/ai/flow-subject";
import type { CopilotFlow } from "@/lib/ai/copilot-client";
import { needsQualifier, sharedNames } from "@/features/crew/shared-names";
import { AMENDABLE_STATES, BookingAmendmentPanel } from "@/components/booking/booking-amendment";

const str = (value: unknown) => (typeof value === "string" ? value : "");
const num = (value: unknown) => (typeof value === "number" ? value : 0);
const arr = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);

/**
 * A copilot-launched conversational flow: gather → select → form → act. The
 * model only chose the flow type + project; every option shown is a real record,
 * the operator makes the choices and types any money, and the final tap runs the
 * real command. Nothing the model can't be trusted with is authored by the model.
 */
export function FlowRunner({ flow }: { flow: CopilotFlow }) {
  if (flow.type === "crew_offer") return <CrewOfferFlow flow={flow} />;
  if (flow.type === "select_package") return <PackageSelectFlow flow={flow} />;
  if (flow.type === "select_questionnaire")
    return <QuestionnaireSelectFlow flow={flow} />;
  return null;
}

const dollars = (cents: unknown) =>
  `$${(num(cents) / 100).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;

/**
 * gather → select → act for choosing a project's package. Prices come from the
 * package records (never the model); selecting one creates the immutable
 * package snapshot the proposal is later built from.
 */
function PackageSelectFlow({ flow }: { flow: CopilotFlow }) {
  // A makeup or hair studio's offer is a quote (features/trades/trades.ts).
  const offer = tradeVocab(useWorkspace().tenantTrade).proposal.toLowerCase();
  const projectId = flow.projectId;
  const { records: projects } = useTenantDocuments("projects");
  const { records: packages } = useTenantDocuments("packages");
  const { records: snapshots } = useTenantDocuments("packageSnapshots");
  const { records: proposals } = useTenantDocuments("proposals");
  const { records: contracts } = useTenantDocuments("contracts");
  const { records: invoices } = useTenantDocuments("invoiceReferences");
  const project = (projects ?? []).find((item) => item.id === projectId);
  /**
   * A job that already has a package takes another alongside it — the couple
   * wants video too — rather than being told it "already has a package". The
   * proposal is then priced again, exactly as the proposal page's Packages
   * panel does (components/proposals/proposal-packages-panel.tsx).
   */
  const adding = Boolean(str(project?.packageSnapshotId));
  const eventTypeId = str(project?.eventTypeId);
  const onJobIds = [
    str(project?.packageSnapshotId),
    ...(Array.isArray(project?.additionalPackageSnapshotIds)
      ? (project.additionalPackageSnapshotIds as unknown[]).map(String)
      : []),
  ].filter(Boolean);
  const onJobPackageIds = new Set(
    (snapshots ?? [])
      .filter((snapshot) => onJobIds.includes(snapshot.id))
      .map((snapshot) => str(snapshot.packageId)),
  );
  // What has left the studio fixes the packages: an agreement out for
  // signature, or a bill raised against the current total.
  const agreementOut = (contracts ?? []).some(
    (contract) =>
      contract.projectId === projectId &&
      ["queued", "sent", "delivered", "viewed", "partially_signed", "completed"].includes(str(contract.status)),
  );
  const invoiceRaised = (invoices ?? []).some(
    (invoice) =>
      invoice.projectId === projectId && !["voided", "void", "cancelled"].includes(str(invoice.status)),
  );
  // Signed or booked: a package change is an amendment the couple signs.
  const signedBooking = adding && AMENDABLE_STATES.includes(str(project?.state));
  const locked =
    adding &&
    (agreementOut ||
      invoiceRaised ||
      !["LEAD", "CONSULTATION", "PROPOSAL", "CONTRACT_PENDING"].includes(str(project?.state)));
  // The proposal the change lands on: the newest one still in play.
  const proposal = (proposals ?? [])
    .filter(
      (item) =>
        item.projectId === projectId &&
        ["draft", "internal_review", "approved", "sent", "viewed", "accepted"].includes(str(item.status)),
    )
    .sort((a, b) => num(b.version) - num(a.version))[0];
  const proposalStatus = str(proposal?.status);

  // Active packages, preferring ones matching the project's event type, and
  // never one the job already has.
  const options = (packages ?? [])
    .filter((p) => p.active === true)
    // The library, plus a one-off written for this job; never another
    // couple's (features/packages/one-off.ts).
    .filter((p) => isCataloguePackage(p, { projectId }))
    .filter((p) => !onJobPackageIds.has(str(p.id)))
    .filter((p) => !eventTypeId || str(p.eventTypeId) === eventTypeId || !str(p.eventTypeId))
    .sort((a, b) => num(a.displayOrder) - num(b.displayOrder));

  /**
   * The package the operator named. These flows act on a single tap, so the
   * equivalent of skipping the picker is leading with the one they asked for
   * and saying so — never applying it for them.
   */
  const subjectMatch = matchSubject(
    flow.subject,
    options.map((option) => ({ id: str(option.id), name: str(option.name) })),
  );
  const namedId = subjectMatch.kind === "matched" ? subjectMatch.id : null;
  const ordered = namedId
    ? [...options].sort((a, b) =>
        a.id === namedId ? -1 : b.id === namedId ? 1 : 0,
      )
    : options;

  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  /**
   * `added` is fixed at the tap. Reading `adding` again after the write saw
   * the package just selected and told a job that had none that its proposal
   * would "include both".
   */
  const [done, setDone] = useState<{ name: string; proposalId: string | null; revised: boolean; added: boolean } | null>(null);

  async function apply(packageId: string, name: string) {
    setBusy(true);
    setNotice(null);
    try {
      const response = await runCrmCommand("selectPackage", {
        projectId,
        packageId,
        selectedAddOns: [],
        mode: adding ? "add" : "replace",
        // `discount` is required by the command schema — there is no default.
        // Cue's picker omitted it, so every package selection from the chat
        // came back 400 INVALID_COMMAND:discount and no package was ever
        // applied. "keep" is none for a new or added package, and on a swap
        // carries the replaced package's discount rather than dropping it.
        discount: { type: "keep" as const },
      });
      if (!response.persisted) {
        setNotice("Preview: the package would be selected from here.");
        return;
      }
      if (adding && proposal) {
        const revised = await runProposalCommand("revise_packages", { proposalId: proposal.id });
        setDone({
          name,
          proposalId: str(revised.result.proposalId) || proposal.id,
          revised: revised.result.superseded === true,
          added: true,
        });
      } else {
        setDone({ name, proposalId: null, revised: false, added: adding });
      }
      refreshTenantRecords("projects", "packageSnapshots", "proposals", "tasks");
    } catch (caught: unknown) {
      setNotice(
        caught instanceof Error
          ? friendlyError(caught)
          : "The package could not be selected.",
      );
    } finally {
      setBusy(false);
    }
  }

  const jobName = str(project?.name) || "the project";

  if (done) {
    return (
      <div className="panel copilot-flow">
        <p role="status">
          {!done.added
            ? `Selected ${done.name} for ${jobName}. You can now prepare a ${offer} from it.`
            : done.proposalId
              ? done.revised
                ? `Added ${done.name} to ${jobName}. A revised ${offer} with both is ready as a draft — check it, approve it and send it to them.`
                : `Added ${done.name} to ${jobName}, and the draft ${offer} is priced again with both.`
              : `Added ${done.name} to ${jobName}. The ${offer} you prepare next will include both.`}
        </p>
        {done.proposalId ? (
          <a className="button button-dark" href={`/studio/proposals/${done.proposalId}`}>
            {`Open the ${offer}`}
          </a>
        ) : null}
      </div>
    );
  }

  return (
    <div className="panel copilot-flow">
      <header className="copilot-flow-head">
        <PackageOpen size={15} />
        <span>
          <strong>{adding ? `Add a package to ${jobName}` : flow.title}</strong>
          <small>{adding ? `It joins the package they already have, on one ${offer} with one total.` : flow.reason}</small>
        </span>
      </header>
      {flow.subject && subjectMatch.kind === "unmatched" ? (
        <p className="copilot-flow-subject" role="status">
          {unmatchedSubjectNotice(flow.subject, "package")}
        </p>
      ) : null}
      {subjectMatch.kind === "ambiguous" ? (
        <p className="copilot-flow-subject" role="status">
          More than one package matches &ldquo;{flow.subject}&rdquo;. Pick the
          one you meant.
        </p>
      ) : null}
      {locked ? (
        <div role="status">
          {signedBooking
            ? `${jobName} is signed, so adding a package is a change the client signs — below. Their agreement stands until they do.`
            : agreementOut
              ? `The agreement has gone out for ${jobName}'s current packages. Void it on the job's Booking tab first, then add the package.`
              : invoiceRaised
                ? `An invoice has been raised for ${jobName}'s current total. Void it first, then add the package.`
                : `${jobName}'s packages can't change right now.`}
          {signedBooking ? (
            // The package they named, already ticked: asked for once, not twice.
            <BookingAmendmentPanel prefill={{ addPackageIds: namedId ? [namedId] : [] }} projectId={projectId} />
          ) : null}
        </div>
      ) : options.length === 0 ? (
        <p role="status">{adding ? "No other active packages to add." : "No active packages to choose from yet."}</p>
      ) : (
        <>
          {adding && proposalStatus ? (
            // Said before the tap, because the tap is the approval.
            <p className="copilot-flow-subject" role="status">
              {proposalStatus === "accepted"
                ? `They've accepted their ${offer}. Adding a package makes a revised ${offer} for them to accept — the accepted one stays in the history, and the agreement waits for the new one.`
                : ["sent", "viewed"].includes(proposalStatus)
                  ? `They've been sent a ${offer}. Adding a package makes a new version for you to send them.`
                  : `The draft ${offer} is priced again with both packages.`}
            </p>
          ) : null}
          <div className="copilot-flow-options">
            {ordered.map((option) => (
              <button
                key={str(option.id)}
                className="copilot-flow-option"
                disabled={busy}
                onClick={() => void apply(str(option.id), str(option.name))}
                type="button"
              >
                <strong>
                  {str(option.name)} · {dollars(option.basePriceCents)}
                </strong>
                {str(option.eventTypeLabel) ? (
                  <small>{str(option.eventTypeLabel)}</small>
                ) : null}
              </button>
            ))}
          </div>
        </>
      )}
      {notice ? <p role="status">{notice}</p> : null}
    </div>
  );
}

/**
 * gather → select → act for sending a project's planning questionnaire. The
 * studio has several active templates (wedding, corporate, sports), so — unlike
 * the old actionProposal, which could only fire when exactly one existed and so
 * never fired at all — the operator picks which one. Templates matching the
 * project's event type are offered first; selecting one emails the client.
 */
function QuestionnaireSelectFlow({ flow }: { flow: CopilotFlow }) {
  const projectId = flow.projectId;
  const { records: projects } = useTenantDocuments("projects");
  const { records: templates } = useTenantDocuments("questionnaireTemplates");
  const { records: responses } = useTenantDocuments("questionnaireResponses");
  const project = (projects ?? []).find((item) => item.id === projectId);
  const eventTypeId = str(project?.eventTypeId);
  const alreadyAssigned = (responses ?? []).some(
    (response) =>
      response.projectId === projectId && response.archivedAt === null,
  );

  // Every active template, with the ones for this project's event type first.
  const options = (templates ?? [])
    .filter((template) => template.status === "active")
    .map((template) => ({
      id: str(template.id),
      name: str(template.name),
      eventTypeId: str(template.eventTypeId),
      dueDays: num(template.dueDaysBeforeEvent),
    }))
    .sort((a, b) => {
      const aMatch = eventTypeId && a.eventTypeId === eventTypeId ? 0 : 1;
      const bMatch = eventTypeId && b.eventTypeId === eventTypeId ? 0 : 1;
      return aMatch - bMatch || a.name.localeCompare(b.name);
    });

  // The form they named, led with rather than applied. See the package flow.
  const subjectMatch = matchSubject(flow.subject, options);
  const namedId = subjectMatch.kind === "matched" ? subjectMatch.id : null;
  const ordered = namedId
    ? [...options].sort((a, b) =>
        a.id === namedId ? -1 : b.id === namedId ? 1 : 0,
      )
    : options;

  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [resent, setResent] = useState(false);
  // An inquiry isn't in the portal yet; the email then carries an invitation.
  const [invited, setInvited] = useState(false);

  async function send(templateId: string, name: string) {
    setBusy(true);
    setNotice(null);
    try {
      const response = await sendPlanningCommand("assignQuestionnaire", {
        projectId,
        templateId,
      });
      // The same form already on the job is re-sent, not duplicated.
      setResent((response.result as { resent?: unknown }).resent === true);
      setInvited((response.result as { invited?: unknown }).invited === true);
      if (response.persisted) setDone(name);
      else setNotice("Preview: the questionnaire would be sent from here.");
    } catch (caught: unknown) {
      setNotice(
        caught instanceof Error
          ? friendlyError(caught)
          : "The questionnaire could not be sent.",
      );
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return (
      <div className="panel copilot-flow">
        <p role="status">
          {resent
            ? `${str(project?.name) || "The client"} already had ${done}, so they were emailed a reminder about it — no second copy.`
            : `Sent ${done} to ${str(project?.name) || "the client"}. ${
                invited
                  ? "The email invites them to their portal, where they fill it in."
                  : "They can fill it in from their portal."
              }`}
        </p>
      </div>
    );
  }

  return (
    <div className="panel copilot-flow">
      <header className="copilot-flow-head">
        <ClipboardList size={15} />
        <span>
          <strong>{flow.title}</strong>
          <small>{flow.reason}</small>
        </span>
      </header>
      {flow.subject && subjectMatch.kind === "unmatched" ? (
        <p className="copilot-flow-subject" role="status">
          {unmatchedSubjectNotice(flow.subject, "questionnaire")}
        </p>
      ) : null}
      {subjectMatch.kind === "ambiguous" ? (
        <p className="copilot-flow-subject" role="status">
          More than one form matches &ldquo;{flow.subject}&rdquo;. Pick the one
          you meant.
        </p>
      ) : null}
      {alreadyAssigned ? (
        <p role="status">
          {str(project?.name) || "This project"}{" "} already has a questionnaire on
          file. Sending the same form again emails them a reminder about it; a
          different form is added alongside it.
        </p>
      ) : null}
      {options.length === 0 ? (
        <p role="status">No active questionnaire templates to send yet.</p>
      ) : (
        <div className="copilot-flow-options">
          {ordered.map((option) => (
            <button
              key={option.id}
              className="copilot-flow-option"
              disabled={busy}
              onClick={() => void send(option.id, option.name)}
              type="button"
            >
              <strong>{option.name}</strong>
              <small>
                {eventTypeId && option.eventTypeId === eventTypeId
                  ? "Matches this event · "
                  : ""}
                Due {option.dueDays}{" "} days before the date
              </small>
            </button>
          ))}
        </div>
      )}
      {notice ? <p role="status">{notice}</p> : null}
    </div>
  );
}

// Map a project's event type to the crew specialty the ranker matches on.
const SPECIALTY: Record<string, string> = {
  Wedding: "weddings",
  Corporate: "corporate",
  Sports: "sports",
};

function CrewOfferFlow({ flow }: { flow: CopilotFlow }) {
  const workspace = useWorkspace();
  const projectId = flow.projectId;
  const { records: projects } = useTenantDocuments("projects");
  const { records: profiles } = useTenantDocuments("crewProfiles");
  const { records: availability } = useTenantDocuments("crewAvailability");
  const { records: assignments } = useTenantDocuments("crewAssignments");
  const { records: schedules } = useTenantDocuments("schedules");
  const { records: crewFlowPackages } = useTenantDocuments("packages");
  // How this studio staffs: whether a subcontractor must carry their own
  // liability cover. Most operate under the studio's policy, so it is off
  // unless they say otherwise (features/crew/requirements.ts).
  const { records: tenants } = useTenantDocuments("tenants");
  const crewSettings = (tenants ?? []).find(
    (entry) => entry.id === workspace.tenantId,
  )?.crewOffers as CrewRequirementSettings | undefined;

  const project = (projects ?? []).find((item) => item.id === projectId);
  const eventDate = str(project?.eventDate) || new Date().toISOString().slice(0, 10);
  const startsAt = new Date(`${eventDate}T12:00:00`).toISOString();
  const endsAt = new Date(`${eventDate}T20:00:00`).toISOString();
  const roleSpecialty = SPECIALTY[str(project?.eventType)] ?? "events";
  const serviceArea = str(project?.city);

  const latestSchedule = (schedules ?? [])
    .filter((item) => item.projectId === projectId)
    .filter((item) => !["superseded", "archived"].includes(str(item.status)))
    .sort((a, b) => num(b.version) - num(a.version))[0];

  // Someone is "spoken for" only while an offer on this job is still live or
  // accepted — a duplicate offer then would be wrong. Lapsed offers do NOT lock
  // a crew member out: declined/cancelled were always re-offerable, and an
  // EXPIRED (or reassigned) offer is re-offerable too — see
  // features/crew/offer-moment.ts and the crew workspace, which has no such
  // filter. Treating expired the same as active work was the bug that made the
  // copilot report "no crew" when everyone had simply lapsed. (The React
  // Compiler memoizes these derivations; no manual useMemo.)
  const LIVE_OFFER_STATUSES = new Set([
    "draft",
    "invited",
    "viewed",
    "accepted",
    "completed",
  ]);
  const spokenFor = new Set<string>();
  for (const item of assignments ?? []) {
    if (item.projectId === projectId && LIVE_OFFER_STATUSES.has(str(item.status)))
      spokenFor.add(str(item.crewProfileId));
  }

  // Candidate assembly + ranking mirrors the crew cascade workspace, so the
  // copilot flow and that screen agree on who is available.
  const candidates: CrewCandidateInput[] = (profiles ?? [])
    .filter((p) => p.active === true)
    .map((p) => ({
      id: str(p.id),
      name: str(p.name),
      active: p.active === true,
      specialties: arr(p.specialties).map(String),
      trades: arr(p.trades).map(String),
      serviceAreas: arr(p.serviceAreas).map(String),
      travelRadiusMiles: num(p.travelRadiusMiles),
      preferenceRank: typeof p.preferenceRank === "number" ? p.preferenceRank : null,
      w9Status: str(p.w9Status) || "unknown",
      insuranceStatus: str(p.insuranceStatus) || "unknown",
      contractStatus: str(p.contractStatus) || "unknown",
      availability: (availability ?? [])
        .filter((av) => av.crewProfileId === p.id)
        .map((av) => ({
          startsAt: str(av.startsAt),
          endsAt: str(av.endsAt),
          status: (str(av.status) || "available") as
            | "available"
            | "unavailable"
            | "tentative",
        })),
      acceptedAssignments: (assignments ?? [])
        .filter((a) => a.crewProfileId === p.id && str(a.status) === "accepted")
        .map((a) => ({ startsAt: str(a.arrivalAt), endsAt: str(a.departureAt) })),
    }));
  /**
   * Declared above the ranking because the ranking depends on it: "Second
   * videographer" must rank videographers, not whoever happens to have the
   * word in their specialties. `coverageRoleForLabel` reads the trade out of
   * whatever the operator typed.
   */
  /**
   * Open on the role the operator asked for.
   *
   * This was hardcoded to "Second photographer", so "add marco silva as
   * videographer" ranked the roster for photography and put the studio's only
   * videographer last under "Role or specialty does not match" — with the
   * comment above explaining that the trade is read out of this very label.
   * The model now states the role (flow.role); the reason line is the
   * fallback for a turn that predates it, and the field stays editable.
   */
  /**
   * What this job's package says it sends.
   *
   * Read through `resolveCoverage`, which answers for the pre-roles shape too
   * — see `coverage-is-roles-not-photographers`. Empty when the job has no
   * package yet, and the role then falls through to the label below.
   */
  const coverageForProject = resolveCoverage(
    (crewFlowPackages ?? []).find(
      (entry) => entry.id === str(project?.packageId),
    ) ?? project,
  );
  const [role, setRole] = useState(() => {
    const said = str(flow.role).trim();
    if (said) return said;
    // Nothing said. Ask the job, not a constant: the package already states
    // which roles this wedding sends, so the first one still to book is a
    // fact rather than a guess.
    const fromReason = `${str(flow.reason)} ${str(flow.title)}`;
    if (/video/i.test(fromReason)) return "Videographer";
    const stillToBook = rolesToBook(coverageForProject, ownerShootsJob(project)).roles;
    // Nothing to read a trade from: a word naming none. This was "Second
    // photographer", which titled a videographer's offer as photography.
    return stillToBook[0]?.role ?? "Crew";
  });
  // The studio's first call for this trade leads (features/crew/first-call.ts),
  // the same order booking's automatic offers and the staffing screen use.
  const roleTrade = coverageRoleForLabel(role);
  const standing = new Map(
    (readFirstCall(crewSettings)[roleTrade] ?? []).map((id, index) => [id, index]),
  );
  const ranked = rankCrewCandidates({
    roleSpecialty,
    roleTrade,
    serviceArea,
    startsAt,
    endsAt,
    candidates,
    requireInsurance: requireInsuranceOf(crewSettings),
  })
    .filter((candidate) => !spokenFor.has(candidate.crewProfileId))
    .map((candidate, index) => ({ candidate, index }))
    .sort(
      (left, right) =>
        (standing.get(left.candidate.crewProfileId) ?? Number.MAX_SAFE_INTEGER) -
          (standing.get(right.candidate.crewProfileId) ?? Number.MAX_SAFE_INTEGER) ||
        left.index - right.index,
    )
    .map((entry) => entry.candidate);

  /**
   * The person the operator named, joined to the roster.
   *
   * Matched against every active profile rather than the ranked list, so
   * somebody who is on the roster but ineligible — or already spoken for on
   * this job — is still recognised and said out loud, instead of appearing to
   * be absent.
   */
  const subjectMatch = matchSubject(
    flow.subject,
    (profiles ?? [])
      .filter((p) => p.active === true)
      .map((p) => ({ id: p.id, name: str(p.name) })),
  );
  const namedId = subjectMatch.kind === "matched" ? subjectMatch.id : null;
  const namedRanked = namedId
    ? ranked.find((c) => c.crewProfileId === namedId)
    : undefined;
  /**
   * Skipping the picker is only right when there is nothing to read about
   * them. Somebody ranked but *ineligible* — a specialty that does not fit,
   * marked unavailable, already working that day — keeps the list on screen
   * with their reasons showing, pre-ticked. Jumping to the pay form would hide
   * exactly the thing the operator needs to weigh.
   */
  const namedIsOfferable = Boolean(namedRanked?.eligible);
  const namedNeedsReview = Boolean(namedRanked && !namedRanked.eligible);

  // Named somebody offerable: open on the form with them chosen and their own
  // rate filled. Nothing is sent — the operator still presses the button — but
  // "add Albert" should not arrive as a blank picker.
  const [step, setStep] = useState<"select" | "form">(
    namedIsOfferable ? "form" : "select",
  );
  const [selected, setSelected] = useState<string[]>(
    namedId && (namedIsOfferable || namedNeedsReview) ? [namedId] : [],
  );
  const [rate, setRate] = useState(() => {
    if (!namedIsOfferable || !namedId) return "";
    const profile = (profiles ?? []).find((p) => p.id === namedId);
    return profile ? String(Math.round(num(profile.rateCents) / 100)) : "";
  });
  const [windowHours, setWindowHours] = useState("48");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [sent, setSent] = useState<string | null>(null);
  // Set only when the operator deliberately asks to staff more people on a job
  // that already has someone, so the done state above steps aside.
  const [reopened, setReopened] = useState(false);

  const profileById = (id: string) => (profiles ?? []).find((p) => p.id === id);
  // Names shared by more than one candidate in THIS list — the only place a
  // qualifier is worth the room.
  const duplicateNames = sharedNames(ranked);
  // Selected candidates, kept in the ranker's order — that order is the cascade
  // order (offer to the top pick first, then down the list).
  const orderedIds = ranked
    .map((c) => c.crewProfileId)
    .filter((id) => selected.includes(id));
  const firstProfile = orderedIds[0] ? profileById(orderedIds[0]) : undefined;
  const isCascade = orderedIds.length > 1;

  function toggle(id: string) {
    setSelected((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );
  }

  function proceed() {
    const first = orderedIds[0] ? profileById(orderedIds[0]) : undefined;
    setRate(first ? String(Math.round(num(first.rateCents) / 100)) : "");
    setStep("form");
    setNotice(null);
  }

  async function send() {
    const ids = orderedIds;
    const first = ids[0] ? profileById(ids[0]) : undefined;
    if (!ids.length || !first) return;
    setBusy(true);
    setNotice(null);
    // Terms shared by a single offer and a cascade; the operator authors the pay.
    const terms = {
      projectId,
      role,
      compensationCents: Math.round(Number(rate || 0) * 100),
      compensationType: str(first.rateType) === "hourly" ? "hourly" : "event",
      currency: "USD",
      compensationVisibleToCrew: true,
      arrivalAt: startsAt,
      departureAt: endsAt,
      locations: [
        {
          name: str(project?.venueName) || "Event location",
          address:
            str((project?.venue as Record<string, unknown> | undefined)?.formatted) || null,
        },
      ],
      responsibilities: arr(latestSchedule?.items)
        .map((it) => str((it as Record<string, unknown>).title))
        .filter(Boolean),
      scheduleItemIds: [],
      currentScheduleId: latestSchedule ? str(latestSchedule.id) : null,
      currentScheduleVersion: num(latestSchedule?.version),
      requirements: crewRequirementsFor(crewSettings),
    };
    try {
      if (ids.length === 1) {
        const response = await sendCrewCommand("inviteAssignment", {
          ...terms,
          crewProfileId: ids[0],
          userId: str(first.userId) || null,
        });
        if (response.persisted) setSent(`Offer sent to ${str(first.name)}.`);
        else setNotice("Preview: the offer would be sent from here.");
      } else {
        const hours = Math.min(168, Math.max(1, Math.round(Number(windowHours) || 48)));
        const response = await sendCrewCommand("createCrewCascade", {
          ...terms,
          candidateIds: ids,
          responseWindowHours: hours,
        });
        if (response.persisted)
          setSent(
            `Cascade started — offered to ${str(first.name)} first; if they pass, the next in line is offered automatically (each has ${hours}h).`,
          );
        else setNotice("Preview: the cascade would start from here.");
      }
    } catch (caught: unknown) {
      setNotice(crewPublicError(caught, "The offer could not be sent."));
    } finally {
      setBusy(false);
    }
  }

  if (sent) {
    return (
      <div className="panel copilot-flow">
        <p role="status">
          {sent}{" "} They&rsquo;ll get an email to accept or decline — nothing changes
          on the job until they respond.
        </p>
      </div>
    );
  }

  /**
   * A flow that already acted must not offer to act again.
   *
   * `sent` is local state, so re-opening the thread rendered the picker afresh
   * as though nothing had happened — which is what made the reference studio
   * ask four times whether his second photographer was booked. The assignment
   * created by the send is the durable record of what happened and is already
   * loaded here, so the done state is derived from it rather than remembered.
   *
   * Lapsed offers deliberately do not count: declined, expired and reassigned
   * are all re-offerable, which is the rule the crew workspace and
   * features/crew/offer-moment.ts already keep.
   */
  const liveOnThisJob = (assignments ?? []).filter(
    (item) =>
      item.projectId === projectId && LIVE_OFFER_STATUSES.has(str(item.status)),
  );
  if (liveOnThisJob.length && !reopened) {
    const accepted = liveOnThisJob.filter((item) => str(item.status) === "accepted");
    const named = (item: Record<string, unknown>) =>
      str(profileById(str(item.crewProfileId))?.name) || "someone";
    return (
      <div className="panel copilot-flow">
        <p role="status">
          {accepted.length
            ? `${named(accepted[0]!)} has accepted ${str(accepted[0]!.role) || "this role"} on this job.`
            : `${named(liveOnThisJob[0]!)} has been offered ${str(liveOnThisJob[0]!.role) || "this role"} and hasn't answered yet.`}
          {liveOnThisJob.length > 1
            ? ` ${liveOnThisJob.length} people are on this job in total.`
            : ""}
        </p>
        <button
          className="button button-light button-sm"
          onClick={() => setReopened(true)}
          type="button"
        >
          Offer someone else as well
        </button>
      </div>
    );
  }

  return (
    <div className="panel copilot-flow">
      <header className="copilot-flow-head">
        <Users size={15} />
        <span>
          <strong>
            {namedIsOfferable && subjectMatch.kind === "matched"
              ? subjectMatch.name
              : flow.title}
          </strong>
          <small>
            {namedIsOfferable
              ? "Ready to offer at their standard rate — check the details and send."
              : flow.reason}
          </small>
        </span>
      </header>

      {/* What became of the person they named. Saying nothing was the original
          complaint: the request named Albert and the picker did not mention
          him, so it read as if the studio had no such person. */}
      {subjectMatch.kind === "unmatched" && flow.subject ? (
        <p className="copilot-flow-subject" role="status">
          {unmatchedSubjectNotice(flow.subject, "crew")}
        </p>
      ) : null}
      {subjectMatch.kind === "ambiguous" ? (
        <p className="copilot-flow-subject" role="status">
          More than one person on your roster matches
          {" "}&ldquo;{flow.subject}&rdquo;. Pick the one you meant.
        </p>
      ) : null}
      {namedNeedsReview && subjectMatch.kind === "matched" ? (
        <p className="copilot-flow-subject" role="status">
          {subjectMatch.name}{" "}
          is on your roster but cannot take this as it stands —{" "}
          {namedRanked?.exclusions.join(", ").toLocaleLowerCase()}. They are
          checked below; send anyway, or choose someone else.
        </p>
      ) : null}
      {namedId && !namedIsOfferable && !namedNeedsReview && subjectMatch.kind === "matched" ? (
        <p className="copilot-flow-subject" role="status">
          {subjectMatch.name}{" "}
          already has a live or accepted offer on this job, so there is nothing
          more to send them. Choose someone else below, or reopen the existing
          offer from the crew page.
        </p>
      ) : null}

      {step === "select" ? (
        <>
          <div className="copilot-flow-options">
            {ranked.length === 0 ? (
              <p role="status">
                {candidates.length === 0
                  ? "You don't have any active crew to offer yet — add crew under People, then ask again."
                  : `Everyone who could take this already has a live or accepted offer for ${
                      str(project?.name) || "this project"
                    }. Reopen or reassign an existing offer from the crew page.`}
              </p>
            ) : (
              ranked.map((candidate) => {
                const picked = selected.includes(candidate.crewProfileId);
                return (
                  <button
                    key={candidate.crewProfileId}
                    className={`copilot-flow-option${picked ? " is-picked" : ""}`}
                    disabled={!candidate.eligible}
                    aria-pressed={picked}
                    onClick={() => toggle(candidate.crewProfileId)}
                    type="button"
                  >
                    <strong>
                      {picked ? "✓ " : ""}
                      {candidate.name}
                    </strong>
                    {/* Two people called "Conor Lawless" rendered as two
                        identical buttons, and the offer carries a fee. Only
                        shown where the name does not settle it — an address
                        under every row is noise on a phone. */}
                    {needsQualifier(candidate.name, duplicateNames) ? (
                      <small className="crew-candidate-email">
                        {str(profileById(candidate.crewProfileId)?.email) ||
                          candidate.crewProfileId}
                      </small>
                    ) : null}
                    {candidate.explanations[0] ? (
                      <small>{candidate.explanations[0]}</small>
                    ) : null}
                    {!candidate.eligible && candidate.exclusions[0] ? (
                      <small className="cp-attn-tag warning">
                        {candidate.exclusions[0]}
                      </small>
                    ) : null}
                  </button>
                );
              })
            )}
          </div>
          {orderedIds.length > 0 ? (
            <div className="copilot-flow-actions">
              <button className="button button-dark" onClick={proceed} type="button">
                Continue with {orderedIds.length}{" "}
                {orderedIds.length === 1 ? "candidate" : "candidates in order"}
              </button>
              {orderedIds.length > 1 ? (
                <small>Offered one at a time, top pick first.</small>
              ) : null}
            </div>
          ) : ranked.length ? (
            <small>Pick one to offer directly, or several to cascade in order.</small>
          ) : null}
        </>
      ) : (
        <div className="copilot-flow-form">
          <p>
            {isCascade ? (
              <>
                Cascade to{" "}
                <strong>
                  {orderedIds
                    .map((id) => str(profileById(id)?.name))
                    .filter(Boolean)
                    .join(" → ")}
                </strong>
                . Set the terms — approving offers the first in line, then the next
                automatically if they pass.
              </>
            ) : (
              <>
                Offer to <strong>{str(firstProfile?.name)}</strong>. Set the terms —
                approving sends them the offer to accept or decline.
              </>
            )}
          </p>
          <label>
            <span>Role</span>
            <input value={role} onChange={(e) => setRole(e.target.value)} />
          </label>
          <label>
            <span>
              Pay ({str(firstProfile?.rateType) === "hourly" ? "per hour" : "for the event"}, USD)
            </span>
            <input
              inputMode="decimal"
              value={rate}
              onChange={(e) => setRate(e.target.value)}
              placeholder="e.g. 500"
            />
          </label>
          {isCascade ? (
            <label>
              <span>Hours each candidate has to respond</span>
              <input
                inputMode="numeric"
                value={windowHours}
                onChange={(e) => setWindowHours(e.target.value)}
                placeholder="48"
              />
            </label>
          ) : null}
          <small>
            {eventDate} · {str(project?.venueName) || "event location"}
          </small>
          <div className="copilot-flow-actions">
            <button
              className="button button-dark"
              disabled={busy || !rate.trim()}
              onClick={() => void send()}
              type="button"
            >
              {busy ? <LoaderCircle className="spin" size={14} /> : <Send size={14} />}
              {isCascade
                ? `Start cascade (${orderedIds.length})`
                : `Send offer to ${str(firstProfile?.name).split(" ")[0] || "them"}`}
            </button>
            <button disabled={busy} onClick={() => setStep("select")} type="button">
              Back
            </button>
          </div>
        </div>
      )}
      {notice ? <p role="status">{notice}</p> : null}
    </div>
  );
}
