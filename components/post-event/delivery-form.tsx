"use client";

import { type FormEvent, useMemo, useState, useSyncExternalStore } from "react";
import { CheckCircle2, CircleDashed, Film, Images, Plus, ScanText, Send, Trash2 } from "lucide-react";
import {
  refreshTenantRecords,
  useTenantDocuments,
} from "@/components/live/tenant-records";
import { splitUpcomingAndPast } from "@/features/ordering/attention";
import { liveProjects } from "@/features/projects/put-away";
import { useWorkspace } from "@/features/auth/workspace-context";
import { sendPostEventCommand } from "@/lib/post-event/command-client";
import { useReturnToJob } from "@/lib/projects/return-to-job";
import { parseGalleryAnnouncement } from "@/features/post-event/gallery-announcement";
import { DELIVERY_GATE_STEPS, POST_PRODUCTION_META } from "@/features/post-production/checklist";
import { linkHost } from "@/features/post-event/link-host";
import {
  DELIVERABLE_KINDS,
  defaultKindFor,
  deliverableDueDate,
  deliveryProgress,
  kindDefaults,
  releaseHeadline,
  releasedKind,
  type DeliverableKind,
} from "@/features/post-event/deliverables";
import { jobExpectedDeliverables } from "@/features/post-event/job-deliverables";
import { jobPackageSnapshotIds } from "@/features/crew/staffing-plan";
import { ReplaceDeliveryLink } from "@/components/post-event/replace-delivery-link";
import { addCalendarDays, formatEventDate, todayLocalIso } from "@/lib/format/event-date";
import { friendlyError } from "@/lib/ai/friendly-error";
import { InfoHint } from "@/components/ui/info-hint";
import { ConfirmStep } from "@/components/ui/confirm-step";
import { jobClientRecipient, recipientLabel } from "@/features/projects/client-recipient";

/**
 * Releasing a job's deliverables (H4, docs/delivery-plan-2026-09-28.md).
 *
 * A job used to be delivered once, with one link, as "photographs". A job now
 * expects a list — a gallery, a highlight film, a full film — each released
 * when it is ready, photos and a film in one click if they are ready together.
 * The job is delivered when every final one has gone out; the review asks and
 * the album workflow start then, once.
 *
 * The release click is the approval (Q22): the couple's email is previewed
 * here, with a line from the studio if they want one, and nothing else is
 * drafted behind it.
 */

type Row = Record<string, unknown> & { id: string };
type Item = {
  key: string;
  kind: DeliverableKind;
  galleryUrl: string;
  accessCode: string;
  expirationDate: string;
  deliveryDraftId: string | null;
};

const record = (value: unknown): Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
const text = (value: unknown) => (typeof value === "string" ? value : "");
const reviewKey = (label: string) => (label === "the_knot" ? "theKnot" : label);
const KIND_LABEL: Record<DeliverableKind, string> = {
  sneak_peek: "Sneak peek",
  gallery: "Photo gallery",
  highlight_film: "Highlight film",
  full_film: "Full film",
  teaser: "Film teaser",
  raw_files: "Raw files",
  album: "Album",
  other: "Something else",
};

let itemCounter = 0;
const newItem = (kind: DeliverableKind, from?: Partial<Item>): Item => ({
  key: `item-${(itemCounter += 1)}`,
  kind,
  galleryUrl: "",
  accessCode: "",
  expirationDate: "",
  deliveryDraftId: null,
  ...from,
});

export function DeliveryForm({ projectId }: { projectId?: string }) {
  const workspace = useWorkspace();
  const returnToJob = useReturnToJob(projectId ?? null);
  const { records: projects, loading } = useTenantDocuments("projects");
  const deliverableFirst = useMemo(() => {
    const split = splitUpcomingAndPast(liveProjects(projects), (p) => p.eventDate);
    return [...split.past, ...split.upcoming];
  }, [projects]);
  const { records: tenants } = useTenantDocuments("tenants");
  const { records: packageSnapshots } = useTenantDocuments("packageSnapshots");
  const { records: deliveryDrafts } = useTenantDocuments("deliveryDrafts");
  const { records: deliveryRecords } = useTenantDocuments("deliveryRecords");
  const { records: productionRecords } = useTenantDocuments("postProductionRecords");
  const { records: contacts } = useTenantDocuments("contacts");
  // Hydration flag without a frame to miss (a background tab runs no rAF).
  const interactive = useSyncExternalStore(
    () => () => {},
    () => true,
    () => false,
  );
  const [selectedProjectId, setSelectedProjectId] = useState(projectId ?? "");
  const project = (projects ?? []).find((candidate) => candidate.id === selectedProjectId) as Row | undefined;
  const state = text(project?.state);
  const productionRecord = (productionRecords ?? []).find((item) => item.projectId === selectedProjectId);
  const postProductionOpen = Boolean(selectedProjectId && productionRecord);
  const outstandingGateSteps = (() => {
    if (!productionRecord) return [];
    const steps = (productionRecord.steps ?? {}) as Record<string, { complete?: boolean } | undefined>;
    return DELIVERY_GATE_STEPS.filter((key) => steps[key]?.complete !== true);
  })();
  const releasable = ["POST_PRODUCTION", "DELIVERED", "REVIEW_REQUESTED"].includes(state);
  const gateBlocked = !postProductionOpen || outstandingGateSteps.length > 0 || !releasable;

  /**
   * Every package on the job, not the primary alone: a photo + video wedding
   * showed only the gallery here, so releasing it read as "complete delivery"
   * with the film still owed (Wave 2; features/post-event/job-deliverables.ts).
   * A job whose snapshot ids are not set yet falls back to snapshots filed
   * against it, as this form always did.
   */
  const snapshots = useMemo(() => {
    const ids = jobPackageSnapshotIds(project);
    const all = packageSnapshots ?? [];
    const named = all.filter((candidate) => ids.includes(candidate.id));
    return named.length ? named : all.filter((candidate) => candidate.projectId === selectedProjectId).slice(0, 1);
  }, [packageSnapshots, project, selectedProjectId]);
  const expected = useMemo(() => jobExpectedDeliverables(snapshots), [snapshots]);
  // A replaced link is history, not a delivery: it stays out of the list.
  const released = (deliveryRecords ?? [])
    .filter((item) => item.projectId === selectedProjectId && !item.archivedAt && item.status !== "revoked")
    .sort((left, right) => text(right.sentAt).localeCompare(text(left.sentAt)));
  const progress = deliveryProgress(expected, released);
  const nextKind: DeliverableKind =
    progress.outstanding.find((entry) => entry.final)?.kind ?? progress.outstanding[0]?.kind ?? "gallery";

  const tenant = tenants?.find((candidate) => candidate.id === workspace.tenantId) ?? tenants?.[0];
  const reviewLinks = record(tenant?.reviewLinks);
  const deliveryDefaults = record(tenant?.deliveryDefaults);
  const drafts = [...(deliveryDrafts ?? [])]
    .filter((item) => item.projectId === selectedProjectId && item.status === "review_required")
    .sort((left, right) =>
      String(right.receivedAt ?? right.createdAt ?? "").localeCompare(String(left.receivedAt ?? left.createdAt ?? "")),
    );
  const defaultExpirationDays = Number(deliveryDefaults.galleryExpirationDays ?? 90);
  const defaultExpiry = addCalendarDays(
    todayLocalIso(),
    Number.isFinite(defaultExpirationDays) && defaultExpirationDays >= 0 ? defaultExpirationDays : 90,
  );
  const preferredReview = [
    ["google", reviewLinks.google],
    ["weddingwire", reviewLinks.weddingwire],
    ["the_knot", reviewLinks.theKnot],
    ["facebook", reviewLinks.facebook],
    ["custom", reviewLinks.custom],
  ].find(([, value]) => text(value));
  const albumInPackage = snapshots.some((snapshot) =>
    (Array.isArray(snapshot.includedDeliverables) ? snapshot.includedDeliverables : []).some((deliverable) =>
      /album/i.test(String(deliverable)),
    ),
  );
  const reviewAsksOff = typeof project?.reviewRequestsSkippedAt === "string";

  // What the studio has typed; `null` means "not touched — use the records".
  const [itemsEdit, setItems] = useState<Item[] | null>(null);
  const [announcement, setAnnouncement] = useState("");
  const [message, setMessage] = useState("");
  const [reviewLabelEdit, setReviewLabel] = useState<string | null>(null);
  const [reviewUrlEdit, setReviewUrl] = useState<string | null>(null);
  const [albumIncludedEdit, setAlbumIncluded] = useState<boolean | null>(null);
  const [albumInstructionsUrlEdit, setAlbumInstructionsUrl] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // Controlled, so a required field inside it (the delivery date) can be
  // shown when the browser blocks submit — a closed <details> swallows the
  // validation bubble and the button looks dead (audit-2 N6).
  const [advancedOpenEdit, setAdvancedOpen] = useState<boolean | null>(null);
  /**
   * The release emails the couple, and an email can't be unsent. The preview
   * above is the approval (Q22), but the button sat directly under a long
   * form and one press sent it — so the last step names who gets it and what
   * can be fixed afterwards, then sends. Browser validation still runs first:
   * the step opens from the form's own submit (wave 3).
   */
  const [confirmingRelease, setConfirmingRelease] = useState(false);
  // One release, one key, for as long as it takes to succeed (D1).
  const [releaseKey, setReleaseKey] = useState(() => crypto.randomUUID());
  // Before the wedding the release form is folded away (see below); a studio
  // preparing a link early can still open it.
  const [earlyOpen, setEarlyOpen] = useState(false);

  // Until touched: the newest draft from the inbox, else one empty item for
  // the next thing this job owes.
  const firstDraft = drafts[0];
  const items: Item[] =
    itemsEdit ??
    [
      // A fixed key while untouched: a fresh one each render remounted the
      // field under the cursor whenever the records refreshed.
      firstDraft
        ? newItem((text(firstDraft.kind) as DeliverableKind) || "gallery", {
            key: `draft-${firstDraft.id}`,
            galleryUrl: text(firstDraft.galleryUrl),
            accessCode: text(firstDraft.accessCode),
            expirationDate: text(firstDraft.expirationDate),
            deliveryDraftId: firstDraft.id,
          })
        : newItem(nextKind, { key: `first-${nextKind}` }),
    ];
  /** The expiry shown is the expiry sent: a default the studio left alone still counts. */
  const expiryOf = (item: Item): string => {
    if (item.expirationDate) return item.expirationDate;
    const host = linkHost(item.galleryUrl);
    if (host.host === "wetransfer") return addCalendarDays(todayLocalIso(), 7);
    const video = host.mediaType === "video" || kindDefaults(item.kind).mediaType === "video";
    return video ? "" : defaultExpiry;
  };
  const updateItem = (key: string, patch: Partial<Item>) =>
    setItems(items.map((item) => (item.key === key ? { ...item, ...patch } : item)));
  const reviewLabel = reviewLabelEdit ?? (preferredReview ? String(preferredReview[0]) : "google");
  const reviewUrl = reviewUrlEdit ?? (preferredReview ? text(preferredReview[1]) : "");
  const albumIncluded = albumIncludedEdit ?? albumInPackage;
  const albumInstructionsUrl = albumInstructionsUrlEdit ?? text(deliveryDefaults.albumInstructionsUrl);

  const releaseKinds = items.map((item) => item.kind);
  const after = deliveryProgress(expected, [
    ...released,
    ...items.map((item) => ({ kind: item.kind, status: "sent" })),
  ]);
  const completesDelivery = state === "POST_PRODUCTION" && after.complete;
  // The review link is optional (Wave 2): without one, or with the asks
  // turned off for this couple, delivery completes and nothing is scheduled.
  const asksFollow = Boolean(reviewUrl.trim()) && !reviewAsksOff;
  const advancedOpen = advancedOpenEdit ?? false;
  const headline = releaseHeadline(
    items.map((item) => ({
      kind: item.kind,
      mediaType:
        linkHost(item.galleryUrl).mediaType !== "other"
          ? linkHost(item.galleryUrl).mediaType
          : kindDefaults(item.kind).mediaType,
    })),
  );

  async function send(type: string, input: Record<string, unknown>, success: string, key?: string) {
    setBusy(true);
    setNotice(null);
    try {
      const response = await sendPostEventCommand(type, input, key);
      refreshTenantRecords("deliveryRecords", "deliveryDrafts", "projects", "postProductionRecords", "projectCloseouts");
      setNotice(response.persisted ? success : "Development preview: nothing was sent.");
      return response;
    } catch (caught: unknown) {
      setNotice(friendlyError(caught, "That could not be done."));
      return null;
    } finally {
      setBusy(false);
    }
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    if (!confirmingRelease) {
      setConfirmingRelease(true);
      return;
    }
    setConfirmingRelease(false);
    const data = new FormData(event.currentTarget);
    const response = await send(
      "recordDelivery",
      {
        projectId: selectedProjectId,
        items: items.map((item) => ({
          kind: item.kind,
          galleryUrl: item.galleryUrl.trim(),
          accessCode: item.accessCode.trim() || null,
          expirationDate: expiryOf(item) || null,
          deliveryDraftId: item.deliveryDraftId,
        })),
        deliveryDate: String(data.get("deliveryDate")),
        notes: String(data.get("notes") ?? "") || null,
        messageToCouple: message.trim() || null,
        reviewDestinationLabel: reviewLabel,
        reviewDestinationUrl: reviewUrl.trim() || null,
        albumIncluded,
        albumInstructionsUrl: albumIncluded && albumInstructionsUrl ? albumInstructionsUrl : null,
        saveStudioDefaults: data.get("saveStudioDefaults") === "on",
      },
      completesDelivery
        ? asksFollow
          ? "Delivered. The couple's email is on its way, and the review asks start in three days."
          : "Delivered. The couple's email is on its way. No review asks were scheduled."
        : `Sent. The couple's email is on its way.${
            after.outstanding.filter((entry) => entry.final).length
              ? ` Still to come: ${after.outstanding.filter((entry) => entry.final).map((entry) => entry.label.toLowerCase()).join(" and ")}.`
              : ""
          }`,
      releaseKey,
    );
    if (response?.persisted) {
      setItems(null);
      setMessage("");
      setReleaseKey(crypto.randomUUID());
      returnToJob({ delayMs: 1600 });
    }
  }

  function extractAnnouncement() {
    const parsed = parseGalleryAnnouncement(announcement);
    if (!parsed.galleryUrl) {
      setNotice("No link was found. Paste the whole notice from your gallery or video host.");
      return;
    }
    const media = linkHost(parsed.galleryUrl).mediaType;
    const target = items.find((item) => !item.galleryUrl) ?? items[items.length - 1]!;
    updateItem(target.key, {
      galleryUrl: parsed.galleryUrl,
      accessCode: parsed.accessCode,
      expirationDate: parsed.expirationDate || target.expirationDate,
      kind: target.galleryUrl ? target.kind : media === "video" ? "highlight_film" : target.kind || defaultKindFor(media),
    });
    setNotice("Link and access details read. Check them and release.");
  }

  const expiredSoonest = released.find((item) => item.expirationDate)?.expirationDate;

  /**
   * Twelve days before the wedding the tab showed the whole release form —
   * link, access code, the couple's email, a full-colour Release button — and
   * one cream line at the bottom saying none of it could be used yet (UI audit,
   * 2026-10-02). Until the event is behind the job, it is one line saying when
   * this opens and what it will deliver.
   */
  const eventBehindJob = [
    "EVENT_COMPLETE",
    "POST_PRODUCTION",
    "DELIVERED",
    "REVIEW_REQUESTED",
    "CLOSED",
  ].includes(state);
  if (project && !eventBehindJob && released.length === 0 && !earlyOpen) {
    return (
      <div className="delivery-before-event">
        <p>
          <strong>
            {`Opens after the wedding${
              text(project.eventDate) ? ` on ${formatEventDate(text(project.eventDate))}` : ""
            }.`}
          </strong>{" "}
          {expected.length
            ? `What it delivers: ${expected.map((entry) => entry.label).join(", ")}.`
            : null}
        </p>
        <button
          className="button button-light button-sm"
          onClick={() => setEarlyOpen(true)}
          type="button"
        >
          Fill it in early
        </button>
      </div>
    );
  }

  return (
    <form
      className="delivery-form delivery-release-form"
      onInvalidCapture={() => {
        setAdvancedOpen(true);
        setNotice("Something below is missing — it's highlighted.");
      }}
      onSubmit={(event) => void submit(event)}
    >
      {/* Opened for one job, the form names it. A disabled select showed
          "Select a project" for an archived job it had filtered out (walked
          2026-09-29). */}
      {/* Opened for one job, the job bar above already names it. */}
      {projectId ? (
        <input name="projectId" type="hidden" value={projectId} />
      ) : (
        <label className="form-span delivery-project-first">
          Project
          <select
            disabled={loading}
            name="projectId"
            onChange={(event) => {
              setSelectedProjectId(event.target.value);
              setItems(null);
            }}
            required
            value={selectedProjectId}
          >
            <option value="">Select a project</option>
            {deliverableFirst.map((candidate) => (
              <option key={candidate.id} value={candidate.id}>
                {String(candidate.name)}
              </option>
            ))}
          </select>
        </label>
      )}

      {!selectedProjectId ? (
        <section className="delivery-project-empty form-span">
          <Images size={20} />
          <span>
            <strong>Choose the project to deliver</strong>
            <small>StudioCue shows what it delivers, what has gone out, and what the inbox caught.</small>
          </span>
        </section>
      ) : (
        <>
          {/* What this job delivers, and where each one is. */}
          <section className="delivery-progress form-span" aria-label="What this job delivers">
            <p className="eyebrow">What this job delivers</p>
            <ul>
              {expected.map((entry) => {
                const sent = released.find((item) => releasedKind(item) === entry.kind);
                const due = deliverableDueDate(text(project?.eventDate), entry);
                return (
                  <li className={sent ? "is-sent" : ""} key={entry.key}>
                    {sent ? <CheckCircle2 aria-hidden="true" size={16} /> : <CircleDashed aria-hidden="true" size={16} />}
                    <span>
                      <strong>{entry.label}</strong>
                      <small>
                        {sent
                          ? `Sent ${text(sent.deliveryDate) ? formatEventDate(text(sent.deliveryDate)) : ""}${
                              sent.viewedAt ? " · opened" : ""
                            }${sent.status === "downloaded" ? " · downloaded" : ""}`
                          : due
                            ? `Due ${formatEventDate(due)}`
                            : "Not sent yet"}
                        {entry.final ? "" : " · extra"}
                      </small>
                      {sent ? (
                        <ReplaceDeliveryLink
                          delivery={sent}
                          onReplaced={setNotice}
                          projectId={selectedProjectId}
                        />
                      ) : null}
                    </span>
                  </li>
                );
              })}
              {released
                .filter((item) => !expected.some((entry) => entry.kind === releasedKind(item)))
                .map((item) => (
                  <li className="is-sent" key={item.id}>
                    <CheckCircle2 aria-hidden="true" size={16} />
                    <span>
                      <strong>{text(item.label) || KIND_LABEL[releasedKind(item)]}</strong>
                      <small>Sent {text(item.deliveryDate) ? formatEventDate(text(item.deliveryDate)) : ""}</small>
                      <ReplaceDeliveryLink delivery={item} onReplaced={setNotice} projectId={selectedProjectId} />
                    </span>
                  </li>
                ))}
            </ul>
            {released.length ? (
              <div className="delivery-progress-actions">
                {released[0] && released[0].status !== "downloaded" ? (
                  <button
                    className="button button-secondary"
                    disabled={busy}
                    onClick={() =>
                      void send(
                        "markDeliveryDownloaded",
                        { projectId: selectedProjectId, deliveryRecordId: released[0]!.id },
                        "Recorded. The closeout no longer waits on the download.",
                      )
                    }
                    type="button"
                  >
                    They have downloaded it
                  </button>
                ) : null}
                {state === "POST_PRODUCTION" && !progress.complete ? (
                  <button
                    className="button button-quiet"
                    disabled={busy}
                    onClick={() =>
                      void send(
                        "markDeliveryComplete",
                        {
                          projectId: selectedProjectId,
                          reviewDestinationUrl: reviewUrl || null,
                          reviewDestinationLabel: reviewLabel,
                        },
                        asksFollow
                          ? "Delivery closed. The review asks start in three days."
                          : "Delivery closed. No review asks were scheduled.",
                      )
                    }
                    title={asksFollow ? undefined : "No review link, so no review asks will be scheduled"}
                    type="button"
                  >
                    Mark delivery complete
                  </button>
                ) : null}
                {expiredSoonest ? (
                  <small>Downloads until {formatEventDate(text(expiredSoonest))}</small>
                ) : null}
              </div>
            ) : null}
          </section>

          {/* The job's forwarding address is shown once, with a Copy button,
              by the post-production checklist above this form — both render
              together on /studio/delivery and in Cue. It was here too. */}

          {drafts.length ? (
            <section className="delivery-drafts form-span" aria-label="Caught by the inbox">
              <p className="eyebrow">
                Caught by the inbox
                <InfoHint label="Caught by the inbox">
                  Links StudioCue read from your gallery host’s “ready” email, forwarded to this job. Add one to this
                  release, or leave it.
                </InfoHint>
              </p>
              {drafts.map((draft) => {
                const inUse = items.some((item) => item.deliveryDraftId === draft.id);
                return (
                  <article key={draft.id}>
                    <span>
                      <strong>{text(draft.label) || KIND_LABEL[(text(draft.kind) as DeliverableKind) || "gallery"]}</strong>
                      <small>{text(draft.galleryUrl)}</small>
                    </span>
                    {inUse ? (
                      <em>In this release</em>
                    ) : (
                      <button
                        className="button button-light button-sm"
                        onClick={() =>
                          setItems([
                            ...items.filter((item) => item.galleryUrl),
                            newItem((text(draft.kind) as DeliverableKind) || "gallery", {
                              galleryUrl: text(draft.galleryUrl),
                              accessCode: text(draft.accessCode),
                              expirationDate: text(draft.expirationDate),
                              deliveryDraftId: draft.id,
                            }),
                          ].slice(0, 4))
                        }
                        type="button"
                      >
                        Add to this release
                      </button>
                    )}
                    <button
                      aria-label={`Discard ${text(draft.label) || "this draft"}`}
                      className="button button-quiet button-sm"
                      disabled={busy}
                      onClick={() => {
                        setItems(items.filter((item) => item.deliveryDraftId !== draft.id));
                        void send(
                          "discardDeliveryDraft",
                          { projectId: selectedProjectId, deliveryDraftId: draft.id },
                          "Discarded.",
                        );
                      }}
                      title="Discard"
                      type="button"
                    >
                      <Trash2 aria-hidden="true" size={14} />
                    </button>
                  </article>
                );
              })}
            </section>
          ) : null}

          <section className="delivery-items form-span" aria-label="This release">
            <p className="eyebrow">This release</p>
            {items.map((item, index) => {
              const host = linkHost(item.galleryUrl);
              const video = host.mediaType === "video" || kindDefaults(item.kind).mediaType === "video";
              return (
                <fieldset className="delivery-item" key={item.key}>
                  <legend>
                    {video ? <Film aria-hidden="true" size={15} /> : <Images aria-hidden="true" size={15} />}
                    {items.length > 1 ? `Item ${index + 1}` : "What you're sending"}
                  </legend>
                  <label>
                    What it is
                    <select
                      onChange={(event) => updateItem(item.key, { kind: event.target.value as DeliverableKind })}
                      value={item.kind}
                    >
                      {DELIVERABLE_KINDS.filter((kind) => kind !== "album").map((kind) => (
                        <option key={kind} value={kind}>
                          {KIND_LABEL[kind]}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="form-span">
                    Link
                    <input
                      onChange={(event) => updateItem(item.key, { galleryUrl: event.target.value })}
                      placeholder="https://…"
                      required
                      type="url"
                      value={item.galleryUrl}
                    />
                    <small>{host.name ? `${host.name} · ${host.mediaType === "video" ? "a film" : host.mediaType === "files" ? "a file transfer" : "a gallery"}` : "Pixieset, Pic-Time, ShootProof, SmugMug, Vimeo, YouTube, Frame.io, Dropbox, Drive or your own site."}</small>
                  </label>
                  <label>
                    {video ? "Password" : "Access code"}
                    <input
                      onChange={(event) => updateItem(item.key, { accessCode: event.target.value })}
                      value={item.accessCode}
                    />
                  </label>
                  <label>
                    {host.host === "wetransfer" ? "Link expires (WeTransfer: 7 days)" : "Downloads until"}
                    <input
                      onChange={(event) => updateItem(item.key, { expirationDate: event.target.value })}
                      type="date"
                      value={expiryOf(item)}
                    />
                  </label>
                  {items.length > 1 ? (
                    <button
                      className="button button-quiet button-sm"
                      onClick={() => setItems(items.filter((candidate) => candidate.key !== item.key))}
                      type="button"
                    >
                      Remove
                    </button>
                  ) : null}
                </fieldset>
              );
            })}
            {items.length < 4 ? (
              <button
                className="button button-light button-sm"
                onClick={() => {
                  const next =
                    progress.outstanding.find((entry) => !releaseKinds.includes(entry.kind))?.kind ?? "highlight_film";
                  setItems([...items, newItem(next)]);
                }}
                type="button"
              >
                <Plus aria-hidden="true" size={14} /> Send something else with it
              </button>
            ) : null}
            <details className="delivery-announcement-paste">
              <summary>
                <ScanText aria-hidden="true" size={14} /> Paste the host&rsquo;s &ldquo;ready&rdquo; email instead
              </summary>
              <textarea
                aria-label="The ready notice"
                onChange={(event) => setAnnouncement(event.target.value)}
                placeholder="Paste the whole email from your gallery or video host…"
                value={announcement}
              />
              <button
                className="button button-secondary"
                disabled={!announcement.trim()}
                onClick={extractAnnouncement}
                type="button"
              >
                Read the link and code
              </button>
            </details>
          </section>

          {/* The release is the approval (Q22): the email, as it will go. */}
          <section className="delivery-preview form-span" aria-label="The couple's email">
            <p className="eyebrow">The couple&rsquo;s email</p>
            <label>
              A line from you (optional)
              <textarea
                maxLength={1200}
                onChange={(event) => setMessage(event.target.value)}
                placeholder="It was a joy to be part of your day…"
                rows={2}
                value={message}
              />
            </label>
            <div className="delivery-preview-card">
              <small>Subject</small>
              <strong>{headline.subject}</strong>
              <p>
                {/* What functions/src/communications/email-templates.ts
                    `deliveryLine` sends; it said "these… in their browser". */}
                {message.trim() ? `${message.trim()} ` : ""}
                {items.length > 1
                  ? "Everything is below — each one opens in your browser."
                  : "It's ready whenever you are — the button below opens it in your browser."}
                {items.some((item) => item.accessCode.trim()) ? " The code is beside it." : ""}
              </p>
              <span className="delivery-preview-buttons">
                {items.map((item) => (
                  <em key={item.key}>
                    {item.kind === "sneak_peek"
                      ? "See your sneak peek"
                      : linkHost(item.galleryUrl).mediaType === "video" || kindDefaults(item.kind).mediaType === "video"
                        ? `Watch your ${KIND_LABEL[item.kind].toLowerCase()}`
                        : "Open your photographs"}
                  </em>
                ))}
              </span>
            </div>
          </section>

          <details
            className="delivery-advanced-options form-span"
            onToggle={(event) => setAdvancedOpen((event.currentTarget as HTMLDetailsElement).open)}
            open={advancedOpen}
          >
            <summary>
              {completesDelivery
                ? asksFollow
                  ? "This completes delivery: review asks and album"
                  : "This completes delivery: album (no review asks)"
                : "Review asks, album and studio defaults"}
            </summary>
            <div className="delivery-advanced-grid">
              <label>
                Delivery date
                <input defaultValue={todayLocalIso()} name="deliveryDate" required type="date" />
              </label>
              <label>
                Review destination
                <select
                  onChange={(event) => {
                    setReviewLabel(event.target.value);
                    setReviewUrl(text(reviewLinks[reviewKey(event.target.value)]));
                  }}
                  value={reviewLabel}
                >
                  <option value="google">Google</option>
                  <option value="weddingwire">WeddingWire</option>
                  <option value="the_knot">The Knot</option>
                  <option value="facebook">Facebook</option>
                  <option value="custom">Other</option>
                </select>
              </label>
              <label className="form-span">
                Review link
                <input
                  onChange={(event) => setReviewUrl(event.target.value)}
                  type="url"
                  value={reviewUrl}
                />
                <small>
                  {reviewAsksOff
                    ? "Review asks are off for this couple, so none will be scheduled."
                    : !reviewUrl.trim()
                      ? "Optional. Leave it empty and StudioCue won't ask this couple for a review."
                      : completesDelivery
                        ? "This release completes the job: two review asks start three days from today."
                        : "Used when the last final item goes out. The asks wait until then, so a film isn't beaten to it."}
                </small>
              </label>
              <label className="delivery-album-toggle">
                <input checked={albumIncluded} onChange={(event) => setAlbumIncluded(event.target.checked)} type="checkbox" />
                <Images /> This job includes an album
              </label>
              {albumIncluded ? (
                <label className="form-span">
                  Album selection instructions
                  <input
                    onChange={(event) => setAlbumInstructionsUrl(event.target.value)}
                    type="url"
                    value={albumInstructionsUrl}
                  />
                </label>
              ) : null}
              <label className="form-span">
                Internal notes
                <textarea name="notes" />
                <small>For your studio only. The couple never sees these.</small>
              </label>
              <label className="delivery-album-toggle">
                <input defaultChecked name="saveStudioDefaults" type="checkbox" />
                Remember the review link, expiry and album instructions for next time
              </label>
            </div>
          </details>

          {!postProductionOpen ? (
            <p className="delivery-gate-notice form-span" role="status">
              <strong>Not ready to release yet.</strong>{" "}Post-production opens after the event.
            </p>
          ) : outstandingGateSteps.length ? (
            <p className="delivery-gate-notice form-span" role="status">
              <strong>Back up the cards first.</strong> Tick{" "}
              {outstandingGateSteps.map((key) => POST_PRODUCTION_META[key].label).join(", ")}{" "}
              on the checklist above — it&rsquo;s the one step that protects the files.
            </p>
          ) : !releasable ? (
            <p className="delivery-gate-notice form-span" role="status">
              <strong>This job is past delivery.</strong>
            </p>
          ) : null}
          {confirmingRelease && !gateBlocked ? (
            <ConfirmStep
              busy={busy}
              cancelLabel="Not yet"
              className="form-span"
              confirmLabel={completesDelivery ? "Yes, release and complete delivery" : "Yes, email it now"}
              confirmType="submit"
              label="Release to the couple?"
              onCancel={() => setConfirmingRelease(false)}
            >
              {`${recipientLabel(jobClientRecipient(project, contacts)) ?? "The couple"} will be emailed ${
                items.length > 1 ? `these ${items.length} links` : "this link"
              } now. An email can't be unsent — if a link turns out wrong, use "Wrong link?" here and they get one email with the right one.${
                completesDelivery && asksFollow ? " Review asks start in three days." : ""
              }`}
            </ConfirmStep>
          ) : (
            <button className="button button-dark" disabled={!interactive || gateBlocked || busy} type="submit">
              <Send size={16} /> {busy ? "Sending…" : completesDelivery ? "Release and complete delivery" : "Release to the couple"}
            </button>
          )}
          {notice ? (
            <p className="form-notice form-span" role="status">
              {notice}
            </p>
          ) : null}
        </>
      )}
    </form>
  );
}
