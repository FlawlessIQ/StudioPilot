import assert from "node:assert/strict";
import test from "node:test";
import {
  pendingImportNotice,
  type PendingImportRecord,
} from "@/features/studio-import/pending-notice";

const session = (
  id: string,
  status: string,
  updatedAt = "2026-08-01T00:00:00.000Z",
): PendingImportRecord => ({ id, status, updatedAt });

const version = (
  id: string,
  importSessionId: string,
  overrides: Partial<PendingImportRecord> = {},
): PendingImportRecord => ({
  id,
  importSessionId,
  assetType: "package",
  status: "draft",
  reviewDecision: "approved",
  ...overrides,
});

const base = {
  packages: [] as PendingImportRecord[],
  questionnaireTemplates: [] as PendingImportRecord[],
  destination: "library" as const,
};

test("nothing is claimed before the collections have loaded", () => {
  // A banner that appears and then vanishes is worse than one that waits.
  assert.equal(
    pendingImportNotice({ ...base, sessions: null, versions: [] }),
    null,
  );
  assert.equal(
    pendingImportNotice({ ...base, sessions: [], versions: null }),
    null,
  );
});

test("an unfinished session with approved drafts asks to be activated", () => {
  // The exact reported state: ten approved drafts, nothing pending.
  const notice = pendingImportNotice({
    ...base,
    sessions: [session("s1", "review_ready")],
    versions: Array.from({ length: 10 }, (_, index) =>
      version(`v${index}`, "s1"),
    ),
  });
  assert.equal(
    notice?.title,
    "10 approved import drafts are waiting to be activated",
  );
  assert.equal(notice?.label, "Finish and activate");
  // And it can be dismissed — the thing the reported banner could not do.
  assert.equal(notice?.sessionId, "s1");
});

test("one approved draft reads as one", () => {
  const notice = pendingImportNotice({
    ...base,
    sessions: [session("s1", "review_ready")],
    versions: [version("v1", "s1")],
  });
  assert.equal(
    notice?.title,
    "1 approved import draft is waiting to be activated",
  );
});

test("drafts still awaiting a decision are counted separately", () => {
  const notice = pendingImportNotice({
    ...base,
    sessions: [session("s1", "review_ready")],
    versions: [
      version("v1", "s1"),
      version("v2", "s1", { reviewDecision: "pending" }),
      version("v3", "s1", { reviewDecision: "pending" }),
    ],
  });
  assert.match(notice?.detail ?? "", /Resolve 2 remaining drafts/);
});

test("a session with no approvals asks for review, not activation", () => {
  const notice = pendingImportNotice({
    ...base,
    sessions: [session("s1", "review_ready")],
    versions: [version("v1", "s1", { reviewDecision: "pending" })],
  });
  assert.equal(notice?.title, "An AI import still needs your review");
  assert.equal(notice?.label, "Resume import");
});

test("a cancelled session says nothing, even with approved drafts intact", () => {
  // This is what "Already handled" buys. Cancelling keeps the extraction —
  // the drafts below are deliberately still approved and still drafts — and
  // the studio stops being told its work is not live.
  assert.equal(
    pendingImportNotice({
      ...base,
      sessions: [session("s1", "cancelled")],
      versions: Array.from({ length: 10 }, (_, index) =>
        version(`v${index}`, "s1"),
      ),
    }),
    null,
  );
});

test("the most recently touched unfinished session wins", () => {
  const notice = pendingImportNotice({
    ...base,
    sessions: [
      session("old", "review_ready", "2026-01-01T00:00:00.000Z"),
      session("new", "review_ready", "2026-08-20T00:00:00.000Z"),
    ],
    versions: [version("v1", "new")],
  });
  assert.equal(notice?.sessionId, "new");
});

test("an activated session whose content never landed offers a repair", () => {
  const notice = pendingImportNotice({
    ...base,
    sessions: [session("s1", "activated")],
    versions: [version("v1", "s1", { status: "active" })],
  });
  assert.equal(notice?.kind, "repair");
  // Not dismissible: its content is live, cancelSession refuses it, and
  // syncing is the only real remedy.
  assert.equal(notice?.sessionId, null);
});

test("an activated session whose content did land says nothing", () => {
  assert.equal(
    pendingImportNotice({
      ...base,
      sessions: [session("s1", "activated")],
      versions: [version("v1", "s1", { status: "active" })],
      packages: [{ id: "p1", sourceStudioAssetVersionId: "v1" }],
    }),
    null,
  );
});

test("a packages page ignores questionnaires that have not landed", () => {
  // Each destination only nags about what it is responsible for showing.
  assert.equal(
    pendingImportNotice({
      ...base,
      destination: "packages",
      sessions: [session("s1", "activated")],
      versions: [
        version("v1", "s1", { status: "active", assetType: "questionnaire" }),
      ],
    }),
    null,
  );
  assert.equal(
    pendingImportNotice({
      ...base,
      destination: "questionnaires",
      sessions: [session("s1", "activated")],
      versions: [version("v1", "s1", { status: "active" })],
    }),
    null,
  );
});
