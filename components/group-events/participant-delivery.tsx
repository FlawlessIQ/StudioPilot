"use client";

import { useMemo, useState } from "react";
import { Link2, LoaderCircle, Send } from "lucide-react";
import { SheetDialog } from "@/components/ui/sheet-dialog";
import {
  DELIVERY_LIMITS,
  deliveryUrlProblem,
  groupDeliveryProgress,
  matchDeliveryLines,
  parseDeliveryLines,
  participantDeliveryState,
  type DeliveryState,
} from "@/features/group-events/delivery";
import type { Participant } from "@/features/group-events/participants";
import { GROUP_DELIVERY_WORDS, capitalized, type GroupEventWords } from "@/features/group-events/words";
import { friendlyError } from "@/lib/ai/friendly-error";
import { attachParticipantDeliveries, releaseParticipantDeliveries } from "@/lib/group-events/commands";

/**
 * Each parent's own link after a group event (group events Phase 5,
 * features/group-events/delivery.ts): attach links one by one from a
 * person's entry, by pasting "name — link" lines matched by name, or one link
 * for everyone; then send. Unpaid places are held until they pay, unless the
 * studio sends one anyway from that person's entry.
 *
 * Offered only to a studio whose trade delivers (the roster checks).
 */

const NOUN = GROUP_DELIVERY_WORDS.noun;
type Run = (action: () => Promise<unknown>) => Promise<boolean>;

const shortDate = (iso: string | null | undefined) =>
  iso ? new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" }).format(new Date(iso)) : "";

/** The roster row's line for one place's delivery, or null when there's nothing to say. */
export function participantDeliveryLine(participant: Participant): { text: string; state: DeliveryState } | null {
  const state = participantDeliveryState(participant);
  switch (state) {
    case "ready":
      return { state, text: `${capitalized(NOUN)} link attached, not sent yet` };
    case "held_unpaid":
      return { state, text: `${capitalized(NOUN)} held: not paid yet` };
    case "sent":
      return { state, text: `${capitalized(NOUN)} sent ${shortDate(participant.delivery?.releasedAt)}`.trim() };
    case "changed":
      return { state, text: `New ${NOUN} link, not sent yet` };
    default:
      return null;
  }
}

/** The roster's delivery section: progress, Send to everyone, and the links sheet. */
export function ParticipantDeliveryPanel({
  projectId,
  participants,
  words,
  busy,
  run,
}: {
  projectId: string;
  participants: Participant[];
  words: GroupEventWords;
  busy: boolean;
  run: Run;
}) {
  const progress = useMemo(() => groupDeliveryProgress(participants), [participants]);
  const [sheet, setSheet] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  if (!progress.total) return null;
  const sendable = Math.min(progress.ready, DELIVERY_LIMITS.releaseBatch);
  return (
    <div className="group-delivery">
      <div className="group-delivery-head">
        <span>
          <strong>{GROUP_DELIVERY_WORDS.heading}</strong>
          <small>
            {[
              `${progress.delivered} of ${progress.total} delivered`,
              progress.ready ? `${progress.ready} ready to send` : null,
              progress.heldUnpaid ? `${progress.heldUnpaid} held until they pay` : null,
              progress.missing ? `${progress.missing} with no link yet` : null,
            ]
              .filter(Boolean)
              .join(" · ")}
          </small>
        </span>
        <button className="button button-sm button-light" onClick={() => setSheet(true)} type="button">
          <Link2 aria-hidden size={14} /> Add links
        </button>
      </div>
      {sendable ? (
        <div className="group-delivery-actions">
          {confirm ? (
            <>
              <span>{`Email ${sendable} ${sendable === 1 ? words.payer : words.payers} their own ${NOUN} link? Anyone who still owes is held until they pay.`}</span>
              <button
                className="button button-sm button-dark"
                disabled={busy}
                onClick={() =>
                  void run(async () => {
                    const { persisted, result } = await releaseParticipantDeliveries(projectId, null);
                    const { emailed = 0, released = 0, remaining = 0, projectState } = (result ?? {}) as {
                      emailed?: number;
                      released?: number;
                      remaining?: number;
                      projectState?: string;
                    };
                    setNotice(
                      persisted
                        ? `${released} sent${emailed < released ? ` (${released - emailed} with no email: on their order page only)` : ""}.${remaining ? ` ${remaining} more to send: press again.` : ""}${projectState === "DELIVERED" ? " Everyone has theirs, so the job is marked delivered." : ""}`
                        : "Preview mode: nothing was sent.",
                    );
                  }).then(() => setConfirm(false))
                }
                type="button"
              >
                {busy ? <LoaderCircle aria-hidden className="spin" size={14} /> : <Send aria-hidden size={14} />}
                Send {sendable}
              </button>
              <button className="button button-sm button-light" disabled={busy} onClick={() => setConfirm(false)} type="button">
                Not now
              </button>
            </>
          ) : (
            <button className="button button-sm button-dark" onClick={() => setConfirm(true)} type="button">
              <Send aria-hidden size={14} /> {`Send to everyone with ${NOUN} attached (${sendable})`}
            </button>
          )}
        </div>
      ) : null}
      {notice ? <p className="group-delivery-notice">{notice}</p> : null}
      <DeliveryLinksSheet
        onClose={() => setSheet(false)}
        onSaved={(message) => {
          setNotice(message);
          setSheet(false);
        }}
        open={sheet}
        participants={participants}
        projectId={projectId}
        words={words}
      />
    </div>
  );
}

type Mode = "match" | "everyone";

function DeliveryLinksSheet({
  open,
  projectId,
  participants,
  words,
  onClose,
  onSaved,
}: {
  open: boolean;
  projectId: string;
  participants: Participant[];
  words: GroupEventWords;
  onClose: () => void;
  onSaved: (message: string) => void;
}) {
  return (
    <SheetDialog label={`Add ${NOUN} links`} onClose={onClose} open={open} width="wide">
      {/* Mounted per opening, so each one starts clean. */}
      {open ? (
        <DeliveryLinksForm onClose={onClose} onSaved={onSaved} participants={participants} projectId={projectId} words={words} />
      ) : null}
    </SheetDialog>
  );
}

function DeliveryLinksForm({
  projectId,
  participants,
  words,
  onClose,
  onSaved,
}: {
  projectId: string;
  participants: Participant[];
  words: GroupEventWords;
  onClose: () => void;
  onSaved: (message: string) => void;
}) {
  const [mode, setMode] = useState<Mode>("match");
  const [paste, setPaste] = useState("");
  const [everyone, setEveryone] = useState("");
  /** The studio's pick for a line nobody matched, or two people share. */
  const [picks, setPicks] = useState<Record<number, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const live = useMemo(
    () =>
      participants
        .filter((participant) => participant.status !== "cancelled")
        .sort((left, right) => left.athleteName.localeCompare(right.athleteName, undefined, { sensitivity: "base" })),
    [participants],
  );
  const match = useMemo(() => matchDeliveryLines(parseDeliveryLines(paste), live), [paste, live]);
  const byId = useMemo(() => new Map(live.map((participant) => [participant.id, participant])), [live]);

  /** What would be saved: the matches, then the studio's picks (a pick wins). */
  const links = useMemo(() => {
    const chosen = new Map<string, string>();
    for (const item of match.matched) chosen.set(item.participantId, item.url);
    for (const item of [...match.unmatched, ...match.ambiguous, ...match.repeated]) {
      const pick = picks[item.line];
      if (pick) chosen.set(pick, item.url);
    }
    return [...chosen].map(([participantId, url]) => ({ participantId, url }));
  }, [match, picks]);
  const waiting = [...match.unmatched, ...match.ambiguous, ...match.repeated].filter((item) => !picks[item.line]).length;
  const everyoneProblem = everyone.trim() ? deliveryUrlProblem(everyone) : null;

  async function save(list: { participantId: string; url: string | null }[]) {
    if (!list.length) return;
    if (list.length > DELIVERY_LIMITS.attachBatch) {
      setError(`Up to ${DELIVERY_LIMITS.attachBatch} links at a time. Save the rest in a second batch.`);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const { persisted, result } = await attachParticipantDeliveries(projectId, list);
      if (!persisted) return onSaved("Preview mode: nothing was saved.");
      const { attached = list.length, unchanged = 0 } = (result ?? {}) as { attached?: number; unchanged?: number };
      onSaved(
        `${attached} ${attached === 1 ? "link" : "links"} saved${unchanged ? ` (${unchanged} already had that link)` : ""}. Nothing is sent until you press Send.`,
      );
    } catch (caught) {
      setError(friendlyError(caught, "The links didn't save. Try again."));
    } finally {
      setBusy(false);
    }
  }

  const pickFor = (line: number, options: { id: string; athleteName: string; parentName?: string | null }[]) => (
    <select
      aria-label={`Who line ${line} is for`}
      onChange={(event) => setPicks((current) => ({ ...current, [line]: event.target.value }))}
      value={picks[line] ?? ""}
    >
      <option value="">Skip this line</option>
      {options.map((option) => (
        <option key={option.id} value={option.id}>
          {option.parentName ? `${option.athleteName} (${option.parentName})` : option.athleteName}
        </option>
      ))}
    </select>
  );

  return (
    <div className="record-sheet">
      <header>
        <p className="eyebrow">After the event</p>
        <h3>{`Add each ${words.person}'s ${NOUN} link`}</h3>
        <p>Links are saved for you to check first. Nothing is emailed until you press Send.</p>
      </header>
      <div aria-label="How to add links" className="group-delivery-modes" role="group">
        <button
          aria-pressed={mode === "match"}
          className={`button button-sm ${mode === "match" ? "button-dark" : "button-light"}`}
          onClick={() => setMode("match")}
          type="button"
        >
          Match by name
        </button>
        <button
          aria-pressed={mode === "everyone"}
          className={`button button-sm ${mode === "everyone" ? "button-dark" : "button-light"}`}
          onClick={() => setMode("everyone")}
          type="button"
        >
          One link for everyone
        </button>
      </div>
      {mode === "match" ? (
        <>
          <div className="record-sheet-fields group-delivery-fields">
            <label>
              {`One line per ${words.person}: their name, then the link`}
              <textarea
                onChange={(event) => {
                  setPaste(event.target.value);
                  setPicks({});
                }}
                placeholder={"Ava Smith — https://studio.pixieset.com/ava\nMia Jones, https://www.dropbox.com/…"}
                rows={7}
                value={paste}
              />
            </label>
            <small>A dash, a comma or two spreadsheet columns all work. Names match whatever the case or spacing.</small>
          </div>
          {paste.trim() ? (
            <ul className="group-delivery-results">
              <li data-tone="good">
                <span>{`${match.matched.length} matched by name`}</span>
              </li>
              {match.ambiguous.map((item) => (
                <li data-tone="warn" key={`a${item.line}`}>
                  <span>{`Line ${item.line}: more than one ${words.person} is called “${item.name}”. Who is it?`}</span>
                  {pickFor(item.line, item.candidates)}
                </li>
              ))}
              {match.unmatched.map((item) => (
                <li data-tone="warn" key={`u${item.line}`}>
                  <span>{`Line ${item.line}: nobody on the roster is called “${item.name}”.`}</span>
                  {pickFor(item.line, live)}
                </li>
              ))}
              {match.repeated.map((item) => (
                <li data-tone="warn" key={`r${item.line}`}>
                  <span>{`Line ${item.line}: “${item.name}” is named twice. The first line is used; pick someone for this one or skip it.`}</span>
                  {pickFor(item.line, live)}
                </li>
              ))}
              {match.problems.map((item) => (
                <li data-tone="warn" key={`p${item.line}`}>
                  <span>
                    {`Line ${item.line}: ${
                      item.problem === "no_link"
                        ? "no link found"
                        : item.problem === "no_name"
                          ? "a link with no name"
                          : "the link must start with https://"
                    }. Skipped.`}
                  </span>
                </li>
              ))}
              {match.matched.map((item) => {
                const had = byId.get(item.participantId)?.delivery?.url;
                return (
                  <li key={`m${item.line}`}>
                    <span>
                      <strong>{item.athleteName}</strong>
                      {had && had !== item.url ? " · replaces the link they have" : had === item.url ? " · already has this link" : ""}
                    </span>
                  </li>
                );
              })}
            </ul>
          ) : null}
        </>
      ) : (
        <div className="record-sheet-fields group-delivery-fields">
          <label>
            {GROUP_DELIVERY_WORDS.linkLabel}
            <input
              inputMode="url"
              onChange={(event) => setEveryone(event.target.value)}
              placeholder="https://"
              type="url"
              value={everyone}
            />
          </label>
          <small>{`${GROUP_DELIVERY_WORDS.oneLinkLead} (${live.length}).`}</small>
          {everyoneProblem ? <p className="form-error">That link must be a full web address starting with https://.</p> : null}
        </div>
      )}
      {error ? (
        <p className="form-error" role="alert">
          {error}
        </p>
      ) : null}
      <footer>
        <button className="button button-light" onClick={onClose} type="button">
          Close
        </button>
        {mode === "match" ? (
          <button className="button button-dark" disabled={busy || !links.length} onClick={() => void save(links)} type="button">
            {busy ? <LoaderCircle aria-hidden className="spin" size={14} /> : null}
            {waiting ? `Save ${links.length} (${waiting} skipped)` : `Save ${links.length} ${links.length === 1 ? "link" : "links"}`}
          </button>
        ) : (
          <button
            className="button button-dark"
            disabled={busy || !everyone.trim() || Boolean(everyoneProblem) || !live.length}
            onClick={() => void save(live.map((participant) => ({ participantId: participant.id, url: everyone.trim() })))}
            type="button"
          >
            {busy ? <LoaderCircle aria-hidden className="spin" size={14} /> : null}
            {`Use for all ${live.length}`}
          </button>
        )}
      </footer>
    </div>
  );
}

/**
 * One place's link, in their roster entry: attach or change it, take it off,
 * and send it — or send it anyway while they still owe. Buttons only (it sits
 * inside the entry's form), so Enter in the link box never saves the entry.
 */
export function ParticipantDeliveryEditor({
  projectId,
  participant,
  busy,
  run,
}: {
  projectId: string;
  participant: Participant;
  busy: boolean;
  run: Run;
}) {
  const [url, setUrl] = useState(participant.delivery?.url ?? "");
  const [problem, setProblem] = useState<string | null>(null);
  const state = participantDeliveryState(participant);
  const saved = participant.delivery?.url ?? "";
  const dirty = url.trim() !== saved;
  const line = participantDeliveryLine(participant);
  return (
    <div className="participant-delivery-edit">
      <label>
        <span>
          {GROUP_DELIVERY_WORDS.linkLabel} <small>after the event</small>
        </span>
        <input
          inputMode="url"
          onChange={(event) => setUrl(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") event.preventDefault();
          }}
          placeholder="https://"
          type="url"
          value={url}
        />
      </label>
      <p>{line ? line.text : GROUP_DELIVERY_WORDS.linkHint}</p>
      {problem ? (
        <p className="form-error" role="alert">
          {problem}
        </p>
      ) : null}
      <div className="participant-delivery-edit-actions">
        {dirty ? (
          <button
            className="button button-sm button-light"
            disabled={busy}
            onClick={() => {
              const next = url.trim();
              if (next && deliveryUrlProblem(next)) {
                setProblem("That link must be a full web address starting with https://.");
                return;
              }
              setProblem(null);
              void run(() => attachParticipantDeliveries(projectId, [{ participantId: participant.id, url: next || null }]));
            }}
            type="button"
          >
            {url.trim() ? "Save link" : "Take the link off"}
          </button>
        ) : null}
        {!dirty && (state === "ready" || state === "changed") ? (
          <button
            className="button button-sm button-dark"
            disabled={busy}
            onClick={() => void run(() => releaseParticipantDeliveries(projectId, [participant.id]))}
            type="button"
          >
            <Send aria-hidden size={14} /> {participant.email ? `Email them their ${NOUN}` : `Show on their order page`}
          </button>
        ) : null}
        {!dirty && state === "held_unpaid" ? (
          <button
            className="button button-sm button-light"
            disabled={busy}
            onClick={() => void run(() => releaseParticipantDeliveries(projectId, [participant.id], true))}
            type="button"
          >
            <Send aria-hidden size={14} /> Send anyway, though they owe
          </button>
        ) : null}
      </div>
    </div>
  );
}
