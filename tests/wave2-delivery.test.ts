import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import type { Firestore } from "firebase-admin/firestore";
import { deliveryProgress } from "../features/post-event/deliverables.ts";
import { jobExpectedDeliverables } from "../features/post-event/job-deliverables.ts";
import { postProductionUndoRefusal, previousAlbumStatus } from "../features/post-event/undo.ts";
import { postProductionRows } from "../features/post-production/checklist.ts";
import {
  requirementIsSatisfied,
  requirementMayBeAttested,
} from "../features/post-event/closeout-attestation.ts";
import {
  requirementMayBeAttested as serverMayBeAttested,
} from "../functions/src/post-event/closeout-attestation.ts";
import {
  markDeliveryComplete,
  releaseDeliverables,
  recordDeliveryInputSchema,
  replaceDeliveryLink,
  replaceDeliveryLinkInputSchema,
} from "../functions/src/post-event/release.ts";
import { renderEmailTemplate } from "../functions/src/communications/email-templates.ts";

/**
 * Wave 2 — delivery-stage fixes. GR Productions sells photo and video
 * together and its couples get these emails for real, so most of this runs the
 * release code against an in-memory Firestore rather than reading its source.
 */

const read = (path: string) => readFileSync(path, "utf8");
const fromMarker = (path: string) => {
  const source = read(path);
  return source.slice(source.indexOf("// ── shared below ──"));
};

// ── a small in-memory Firestore: enough for the release transactions ──────

type Data = Record<string, unknown>;

function setPath(target: Data, path: string, value: unknown) {
  const parts = path.split(".");
  let cursor = target;
  for (const part of parts.slice(0, -1)) {
    if (typeof cursor[part] !== "object" || cursor[part] === null) cursor[part] = {};
    cursor = cursor[part] as Data;
  }
  cursor[parts[parts.length - 1]!] = value;
}

function fakeDb(seed: Record<string, Data>) {
  const store = new Map<string, Data>(Object.entries(seed).map(([path, data]) => [path, structuredClone(data)]));
  const snapshot = (path: string) => {
    const data = store.get(path);
    const ref = doc(path);
    return {
      id: ref.id,
      ref,
      exists: data !== undefined,
      data: () => (data ? structuredClone(data) : undefined),
      get: (field: string) =>
        field.split(".").reduce<unknown>((value, key) => (value as Data | undefined)?.[key], data),
    };
  };
  function doc(path: string) {
    return { path, id: path.split("/").pop()! };
  }
  function query(collection: string, filters: Array<[string, unknown]> = []) {
    return {
      kind: "query" as const,
      collection,
      filters,
      where: (field: string, _op: string, value: unknown) => query(collection, [...filters, [field, value]]),
      limit: () => query(collection, filters),
    };
  }
  const run = (target: { path?: string; kind?: string; collection?: string; filters?: Array<[string, unknown]> }) => {
    if (target.kind === "query") {
      const docs = [...store.keys()]
        .filter((path) => path.startsWith(`${target.collection}/`) && path.split("/").length === 2)
        .map(snapshot)
        .filter((snap) => target.filters!.every(([field, value]) => snap.get(field) === value));
      return { docs, empty: docs.length === 0 };
    }
    return snapshot(target.path!);
  };
  const transaction = {
    get: async (target: Parameters<typeof run>[0]) => run(target),
    create: (ref: { path: string }, data: Data) => {
      if (store.has(ref.path)) throw Object.assign(new Error("ALREADY_EXISTS"), { code: 6 });
      store.set(ref.path, structuredClone(data));
    },
    set: (ref: { path: string }, data: Data) => store.set(ref.path, structuredClone(data)),
    update: (ref: { path: string }, patch: Data) => {
      const current = store.get(ref.path);
      if (!current) throw new Error(`NOT_FOUND:${ref.path}`);
      for (const [key, value] of Object.entries(patch)) setPath(current, key, structuredClone(value));
    },
  };
  const db = {
    doc,
    collection: (name: string) => query(name),
    runTransaction: async <T>(fn: (tx: typeof transaction) => Promise<T>) => fn(transaction),
  };
  return {
    db: db as unknown as Firestore,
    store,
    all: (collection: string) =>
      [...store.entries()].filter(([path]) => path.startsWith(`${collection}/`)).map(([, data]) => data),
  };
}

const TENANT = "t1";
const NOW = "2026-10-01T12:00:00.000Z";

/** A GR-style photo + video wedding in post-production, cards backed up. */
function photoAndVideoJob(project: Data = {}) {
  return fakeDb({
    "projects/p1": {
      tenantId: TENANT,
      state: "POST_PRODUCTION",
      stateVersion: 7,
      packageSnapshotId: "snap_photo",
      additionalPackageSnapshotIds: ["snap_video"],
      eventDate: "2026-08-01",
      ...project,
    },
    "packageSnapshots/snap_photo": {
      tenantId: TENANT,
      includedCoverage: [{ role: "photographer", count: 2 }],
      includedPhotographers: 2,
    },
    "packageSnapshots/snap_video": {
      tenantId: TENANT,
      includedCoverage: [{ role: "videographer", count: 1 }],
      includedPhotographers: 0,
    },
    "postProductionRecords/p1": {
      tenantId: TENANT,
      steps: { backup_complete: { complete: true } },
    },
  });
}

const release = (
  db: Firestore,
  key: string,
  items: Array<{ kind: string; galleryUrl: string }>,
  extra: Data = {},
) =>
  releaseDeliverables(
    db,
    { tenantId: TENANT, actorId: "owner", role: "studio_owner", idempotencyKey: key, now: NOW },
    recordDeliveryInputSchema.parse({ projectId: "p1", deliveryDate: "2026-10-01", items, ...extra }),
  );

// ── 1. every package's deliverables ──────────────────────────────────────

test("a photo + video job expects the gallery and the film, from both packages", () => {
  const expected = jobExpectedDeliverables([
    { includedCoverage: [{ role: "photographer", count: 2 }] },
    { includedCoverage: [{ role: "videographer", count: 1 }], includedDeliverables: ["Full-length film"] },
  ]);
  assert.deepEqual(expected.map((entry) => entry.kind), ["gallery", "highlight_film", "full_film"]);
  // The gallery alone does not complete it.
  assert.equal(deliveryProgress(expected, [{ kind: "gallery", status: "sent" }]).complete, false);
  // No package at all is still one gallery.
  assert.deepEqual(jobExpectedDeliverables([]).map((entry) => entry.kind), ["gallery"]);
  // One kind in both packages appears once, final if either says so, due soonest.
  const merged = jobExpectedDeliverables([
    { deliverables: [{ kind: "gallery", final: false, turnaroundDays: 60 }] },
    { deliverables: [{ kind: "gallery", final: true, turnaroundDays: 30 }] },
  ]);
  assert.equal(merged.length, 1);
  assert.equal(merged[0]!.final, true);
  assert.equal(merged[0]!.turnaroundDays, 30);
});

test("the functions copy of the job's deliverables and the undo rules match features/", () => {
  assert.equal(
    fromMarker("functions/src/post-event/job-deliverables.ts"),
    fromMarker("features/post-event/job-deliverables.ts"),
  );
  assert.equal(fromMarker("functions/src/post-event/undo.ts"), fromMarker("features/post-event/undo.ts"));
});

test("sending the gallery on a photo + video job does not deliver the job; the film does", async () => {
  const { db, store, all } = photoAndVideoJob();
  const first = await release(db, "release-gallery-1", [{ kind: "gallery", galleryUrl: "https://gr.pic-time.com/g" }], {
    reviewDestinationUrl: "https://g.page/r/review",
  });
  assert.equal(first.projectState, "POST_PRODUCTION");
  assert.deepEqual(first.outstanding, ["Highlight film"]);
  assert.equal(store.get("projects/p1")!.state, "POST_PRODUCTION");
  assert.equal(all("reviewRequests").length, 0, "no review asks while the film is owed");
  assert.equal(store.get("projects/p1")!.nextAction, "Deliver the highlight film");

  const second = await release(db, "release-film-1", [{ kind: "highlight_film", galleryUrl: "https://vimeo.com/123" }]);
  assert.equal(second.projectState, "DELIVERED");
  assert.equal(all("reviewRequests").length, 2, "the asks start once, when the film lands");
});

test("the form and Today read every package through the one helper", () => {
  for (const path of ["components/post-event/delivery-form.tsx", "components/today/use-today-inbox.ts"]) {
    const source = read(path);
    assert.match(source, /jobExpectedDeliverables\(/, path);
    assert.doesNotMatch(source, /expectedDeliverables\(\{/, `${path} still reads one package`);
  }
  assert.match(read("functions/src/post-event/release.ts"), /jobPackageSnapshotIds\(project\.data\(\)\)/);
});

// ── 2. a wrong link, taken back ──────────────────────────────────────────

test("replacing a wrong link revokes it, releases the right one, and sends one correction email", async () => {
  const { db, store, all } = photoAndVideoJob();
  const first = await release(
    db,
    "release-both-1",
    [
      { kind: "gallery", galleryUrl: "https://gr.pic-time.com/wrong-couple" },
      { kind: "highlight_film", galleryUrl: "https://vimeo.com/123" },
    ],
    { reviewDestinationUrl: "https://g.page/r/review" },
  );
  assert.equal(first.projectState, "DELIVERED");
  const [galleryId] = first.deliveryRecordIds as string[];
  const reviewsBefore = all("reviewRequests").length;
  const emailsBefore = all("emailJobs").length;

  const input = replaceDeliveryLinkInputSchema.parse({
    projectId: "p1",
    deliveryRecordId: galleryId,
    galleryUrl: "https://gr.pic-time.com/right-couple",
    reason: "Pasted the Chen gallery by mistake",
  });
  const result = await replaceDeliveryLink(db, { tenantId: TENANT, actorId: "owner", idempotencyKey: "fix-1", now: NOW }, input);

  const old = store.get(`deliveryRecords/${galleryId}`)!;
  assert.equal(old.status, "revoked");
  assert.equal(old.revokedReason, "Pasted the Chen gallery by mistake");
  const replacement = store.get(`deliveryRecords/${String(result.deliveryRecordId)}`)!;
  assert.equal(replacement.status, "sent");
  assert.equal(replacement.kind, "gallery");
  assert.equal(replacement.galleryUrl, "https://gr.pic-time.com/right-couple");
  assert.equal(old.replacedByDeliveryRecordId, result.deliveryRecordId);

  const newEmails = all("emailJobs").slice(emailsBefore);
  assert.equal(newEmails.length, 1, "one email, not a second delivery");
  assert.equal(newEmails[0]!.type, "delivery_correction");
  assert.equal(all("reviewRequests").length, reviewsBefore, "no second set of review asks");
  assert.equal(store.get("projects/p1")!.state, "DELIVERED");

  // The same wrong record cannot be replaced twice, nor with its own link.
  await assert.rejects(
    replaceDeliveryLink(db, { tenantId: TENANT, actorId: "owner", idempotencyKey: "fix-2", now: NOW }, input),
    /DELIVERY_ALREADY_REPLACED/,
  );
  await assert.rejects(
    replaceDeliveryLink(
      db,
      { tenantId: TENANT, actorId: "owner", idempotencyKey: "fix-3", now: NOW },
      { ...input, deliveryRecordId: String(result.deliveryRecordId) },
    ),
    /DELIVERY_LINK_UNCHANGED/,
  );
});

test("the correction email says the earlier link was wrong and carries the right one", () => {
  const rendered = renderEmailTemplate({
    key: "delivery_correction",
    brand: { studioName: "GR Productions", productName: "StudioCue", accentColor: "#222222", logoUrl: null, contactEmail: null },
    recipientName: "Ada",
    values: {
      items: [{ mediaType: "photo", kind: "gallery", label: "Photo gallery", openUrl: "https://studio-cue.com/d/right-token-123456" }],
    },
  });
  assert.match(rendered.text, /earlier .* was wrong/);
  assert.match(rendered.text, /https:\/\/studio-cue\.com\/d\/right-token-123456/);
  assert.doesNotMatch(rendered.subject, /are ready/, "not a second 'ready' email");
});

test("a revoked link never reaches the couple: the /d/ link forwards, the portal hides it", () => {
  const route = read("app/d/[token]/route.ts");
  assert.match(route, /replacedByDeliveryRecordId/);
  assert.match(read("app/api/client/portal/route.ts"), /collectionName === "deliveryRecords" &&\s*\["revoked", "draft"\]/);
});

// ── 3. review asks: optional at delivery, and skippable ──────────────────

test("delivery completes without a review link, schedules no asks, and says so on the job", async () => {
  const { db, store, all } = photoAndVideoJob();
  const result = await release(db, "release-no-review", [
    { kind: "gallery", galleryUrl: "https://gr.pic-time.com/g" },
    { kind: "highlight_film", galleryUrl: "https://vimeo.com/1" },
  ]);
  assert.equal(result.projectState, "DELIVERED");
  assert.equal(result.reviewRequestsScheduled, 0);
  assert.equal(all("reviewRequests").length, 0);
  assert.equal(store.get("projects/p1")!.reviewRequestsSkippedReason, "no_review_link");
});

test("a job whose review asks were turned off schedules none, even with a link", async () => {
  const { db, all } = photoAndVideoJob({ reviewRequestsSkippedAt: "2026-09-30T00:00:00.000Z" });
  await release(db, "release-skipped", [{ kind: "gallery", galleryUrl: "https://gr.pic-time.com/g" }]);
  await markDeliveryComplete(db, { tenantId: TENANT, actorId: "owner", now: NOW }, {
    projectId: "p1",
    reviewDestinationUrl: "https://g.page/r/review",
    reviewDestinationLabel: "google",
  });
  assert.equal(all("reviewRequests").length, 0);
});

test("skipping review asks is its own command, and the sender honours it", () => {
  const commands = read("functions/src/post-event/commands.ts");
  assert.match(commands, /type: z\.literal\("skipReviewRequests"\)/);
  assert.match(commands, /status: "skipped",\s*skippedBy: identity\.uid/);
  // Closeout does not wait on asks the studio chose not to send.
  assert.match(commands, /typeof project\.get\("reviewRequestsSkippedAt"\) === "string"/);
  // A queued review email re-reads its ask as it goes.
  const worker = read("functions/src/operations/jobs.ts");
  assert.match(worker, /type === "review_request" && document\.get\("reviewRequestId"\)\)\s*\{\s*const ask/);
  assert.match(worker, /\["skipped", "client_confirmed", "manually_confirmed"\]/);
  // Delivery no longer refuses for want of a review link.
  assert.doesNotMatch(read("functions/src/post-event/release.ts"), /throw new Error\("REVIEW_DESTINATION_REQUIRED"\)/);
  assert.doesNotMatch(read("components/post-event/delivery-form.tsx"), /required=\{completesDelivery\}/);
});

test("Cue's review card reads the statuses the server writes and never overwrites the couple's", () => {
  const cards = read("components/ai/actions/studio-actions.tsx");
  assert.match(cards, /\["client_confirmed", "manually_confirmed", "skipped"\]/);
  assert.doesNotMatch(cards, /\["confirmed", "manually_confirmed", "completed"\]/);
  assert.match(read("functions/src/post-event/commands.ts"), /if \(!alreadyConfirmed\)\s*await reference\.update/);
});

// ── 4. one-step undo ─────────────────────────────────────────────────────

test("a ticked studio step can be unticked; the backup cannot once something went out", () => {
  const steps = { backup_complete: { complete: true }, editing_complete: { complete: true } };
  assert.equal(postProductionUndoRefusal(steps, "editing_complete"), null);
  assert.equal(postProductionUndoRefusal(steps, "cull_complete"), "POST_PRODUCTION_STEP_NOT_COMPLETE");
  assert.equal(postProductionUndoRefusal(steps, "client_downloaded"), "POST_PRODUCTION_STEP_NOT_UNDOABLE");
  assert.equal(postProductionUndoRefusal(steps, "backup_complete"), null);
  assert.equal(
    postProductionUndoRefusal({ ...steps, delivery_sent: { complete: true } }, "backup_complete"),
    "POST_PRODUCTION_BACKUP_RELEASED",
  );
  const rows = postProductionRows(steps);
  assert.equal(rows.find((row) => row.key === "editing_complete")!.undoable, true);
  assert.equal(rows.find((row) => row.key === "cull_complete")!.undoable, false);
});

test("an album goes back to where it actually was, one step per undo", () => {
  const history = [
    { status: "instructions_available" },
    { status: "selections_received" },
    { status: "design_sent" },
    { status: "approved" },
  ];
  // Approved straight from design sent: back is design sent, not "revision requested".
  assert.equal(previousAlbumStatus("approved", history), "design_sent");
  const once = [...history, { status: "design_sent", undoneFrom: "approved" }];
  assert.equal(previousAlbumStatus("design_sent", once), "selections_received");
  const twice = [...once, { status: "selections_received", undoneFrom: "design_sent" }];
  assert.equal(previousAlbumStatus("selections_received", twice), "instructions_available");
  assert.equal(previousAlbumStatus("instructions_available", [{ status: "instructions_available" }]), null);
});

test("the album panel offers selections and approval taken outside the portal, and a way back", () => {
  const panel = read("components/post-event/delivery-closeout-workspace.tsx");
  assert.match(panel, /updateAlbum\(album\.id, "selections_received"\)/);
  assert.match(panel, /updateAlbum\(album\.id, "approved"\)/);
  assert.match(panel, /"revertAlbumStatus"/);
  assert.match(read("components/post-event/post-production-checklist.tsx"), /"undoPostProductionStep"/);
});

// ── 5. close and archive asks first ──────────────────────────────────────

test("close and archive is two clicks, and the first says what closing does", () => {
  const panel = read("components/post-event/delivery-closeout-workspace.tsx");
  assert.match(panel, /onClick=\{\(\) => setConfirming\("close"\)\}/);
  assert.match(panel, /Closing stops anything still due to the couple/);
  // closeAndArchive runs only from the confirm button.
  assert.equal(panel.match(/void closeAndArchive\(\)/g)?.length, 1);
});

// ── 6. a job with no package can still close ─────────────────────────────

test("the final balance may be vouched for only when no price was agreed in StudioCue", () => {
  const vouch = { attestedBy: "owner", attestedAt: NOW, note: "Paid in full before we moved over" };
  const base = { key: "final_balance", label: "Final balance settled", complete: false };
  assert.equal(requirementMayBeAttested(base), false);
  assert.equal(requirementIsSatisfied({ ...base, attestation: vouch }), false);
  assert.equal(requirementMayBeAttested({ ...base, noAgreedBalance: true }), true);
  assert.equal(requirementIsSatisfied({ ...base, noAgreedBalance: true, attestation: vouch }), true);
  // The contract never is, and the server copy agrees.
  assert.equal(requirementMayBeAttested({ key: "contract", label: "Contract", complete: false, noAgreedBalance: true }), false);
  assert.equal(serverMayBeAttested({ ...base, noAgreedBalance: true }), true);
  const commands = read("functions/src/post-event/commands.ts");
  assert.match(commands, /noAgreedBalance: !String\(project\.get\("packageSnapshotId"\) \?\? ""\)/);
  assert.match(commands, /if \(!requirementMayBeAttested\(target\)\)/);
});
