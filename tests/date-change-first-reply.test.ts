import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { followDateToFirstReply } from "../functions/src/crm/date-change-follow.ts";

/**
 * Prod walk, 2026-10-23: an inquiry for a taken date got a drafted decline;
 * the studio moved the job to a free date and the draft still said "May 15 …
 * we already have a conflict", one tap from sending.
 */
type Data = Record<string, unknown>;
function fakeDb(seed: Record<string, Data>) {
  const store = new Map(Object.entries(seed).map(([k, v]) => [k, { ...v }]));
  const snap = (path: string) => {
    const data = store.get(path);
    return {
      id: path.split("/").pop()!,
      exists: data !== undefined,
      ref: ref(path),
      data: () => (data ? { ...data } : undefined),
      get: (field: string) => data?.[field],
    };
  };
  const ref = (path: string) => ({
    path,
    id: path.split("/").pop()!,
    get: async () => snap(path),
  });
  const query = (name: string, filters: Array<[string, string, unknown]>) => ({
    where: (field: string, op: string, value: unknown) => query(name, [...filters, [field, op, value]]),
    limit: () => query(name, filters),
    get: async () => ({
      docs: [...store.entries()]
        .filter(([path]) => path.startsWith(`${name}/`))
        .filter(([, data]) =>
          filters.every(([field, op, value]) =>
            op === "in" ? (value as unknown[]).includes(data[field]) : data[field] === value,
          ),
        )
        .map(([path]) => snap(path)),
    }),
  });
  const db = {
    doc: ref,
    collection: (name: string) => query(name, []),
    batch: () => {
      const ops: Array<() => void> = [];
      return {
        update: (r: { path: string }, data: Data) => ops.push(() => store.set(r.path, { ...store.get(r.path), ...data })),
        set: (r: { path: string }, data: Data) => ops.push(() => store.set(r.path, { ...store.get(r.path), ...data })),
        commit: async () => ops.forEach((op) => op()),
      };
    },
  };
  return { db: db as never, store };
}

const T = "tenant_a";
const seed = (draftStatus = "review_required", state = "LEAD"): Record<string, Data> => ({
  "projects/job": { tenantId: T, state, leadId: "lead", eventDate: "2027-06-19", eventKind: "wedding", city: "Boston", venueName: null },
  "projects/other": { tenantId: T, state: "CONTRACT_PENDING", eventDate: "2027-05-15", eventKind: "wedding" },
  "leads/lead": { tenantId: T, eventDate: "2027-05-15", city: "Boston", availabilityStatus: "conflict" },
  "aiActions/ai_reply_lead": { tenantId: T, status: draftStatus, archivedAt: null },
});

test("a moved date redrafts the waiting first reply, asking availability again", async () => {
  const { db, store } = fakeDb(seed());
  const result = await followDateToFirstReply(db, { tenantId: T, projectId: "job", now: "2026-10-23T20:00:00Z" });
  assert.equal(result.redrafted, "ai_reply_lead");
  assert.equal(store.get("leads/lead")!.eventDate, "2027-06-19");
  assert.equal(store.get("leads/lead")!.availabilityStatus, "available");
  assert.equal(store.get("aiActions/ai_reply_lead")!.archivedAt, "2026-10-23T20:00:00Z");
  assert.equal(store.get("aiJobs/lead_intake_lead")!.status, "queued");
});

test("moved onto a held date, the redraft knows it is taken", async () => {
  const data = seed();
  data["projects/job"]!.eventDate = "2027-05-15";
  data["leads/lead"]!.eventDate = "2027-04-01";
  const { db, store } = fakeDb(data);
  await followDateToFirstReply(db, { tenantId: T, projectId: "job", now: "n" });
  assert.equal(store.get("leads/lead")!.availabilityStatus, "conflict");
});

test("a reply already sent, or a job past inquiry, is left alone", async () => {
  for (const [status, state] of [["approved", "LEAD"], ["review_required", "PROPOSAL"]]) {
    const { db, store } = fakeDb(seed(status, state));
    assert.equal((await followDateToFirstReply(db, { tenantId: T, projectId: "job", now: "n" })).redrafted, null);
    assert.equal(store.get("leads/lead")!.eventDate, "2027-05-15");
    assert.equal(store.has("aiJobs/lead_intake_lead"), false);
  }
});

test("the job edit runs it after the save", () => {
  const crm = readFileSync("functions/src/crm/commands.ts", "utf8");
  assert.match(crm, /if \(dateMoved\.eventDateChanged && dateMoved\.projectId\) \{[\s\S]{0,700}await followDateToFirstReply\(db, \{/);
});
