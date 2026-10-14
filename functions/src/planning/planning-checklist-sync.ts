import { getFirestore, type Firestore } from "firebase-admin/firestore";
import { onDocumentWritten } from "firebase-functions/v2/firestore";
import {
  CHECKLIST_STATES,
  PLANNING_CHECKLIST_SOURCE,
  checklistFor,
  checklistIsCustom,
  checklistScopeOf,
  checklistTaskPlan,
  followEventDate,
  planningChecklistTaskId,
} from "./planning-checklist.js";
import { jobKindOf } from "../job-kinds/job-kinds.js";

/**
 * A planner's planning checklist, written and kept in step
 * (docs/planner-journey-plan.md, N8; the rules are in planning-checklist.ts).
 *
 * Booking writes it: when a full or partial planning job reaches a booked
 * state with a wedding date, every item of the studio's list (its own, or
 * the starter list) becomes a task with a fixed id, due its months or weeks
 * before the day, or today when that day has passed. The job then carries
 * `planningChecklist.appliedAt`, so it is written once: an item the studio
 * finished or removed is never written again, and a list edited later
 * changes only jobs booked after it.
 *
 * A moved wedding date moves the open tasks with it, each by its own offset,
 * unless the studio moved that task by hand.
 *
 * A project trigger rather than a hook in each command, because a job books
 * and moves through several paths (the booking orchestrator, updateProject,
 * a signed amendment, an import, Cue) and every one of them writes the
 * project. Every other job returns before reading anything.
 */

const text = (value: unknown) => (typeof value === "string" ? value.trim() : "");
const dayOf = (value: unknown) => text(value).slice(0, 10);
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const CREATED_BY = "planning-checklist";

export type ChecklistOutcome = "applied" | "already" | "not_yet" | "missing";

/** Write the job's checklist once, if it is due one now. Safe to call again. */
export async function applyPlanningChecklist(db: Firestore, projectId: string, now: string): Promise<ChecklistOutcome> {
  return db.runTransaction(async (transaction) => {
    const projectReference = db.doc(`projects/${projectId}`);
    const project = await transaction.get(projectReference);
    const data = project.data();
    if (!data) return "missing";
    const marker = data.planningChecklist as { appliedAt?: unknown } | undefined;
    if (marker?.appliedAt) return "already";
    const scope = checklistScopeOf(data);
    const eventDate = dayOf(data.eventDate);
    const tenantId = text(data.tenantId);
    if (!scope || !tenantId || data.archivedAt || !CHECKLIST_STATES.has(text(data.state)) || !DAY.test(eventDate)) return "not_yet";
    const tenant = await transaction.get(db.doc(`tenants/${tenantId}`));
    const stored = tenant.get("planningChecklists");
    // A mitzvah's own list, not the studio's wedding one (planning-checklist.ts).
    const items = checklistFor(stored, scope, jobKindOf(data));
    const references = items.map((entry) => db.doc(`tasks/${planningChecklistTaskId(projectId, entry.key)}`));
    const existing = references.length ? await transaction.getAll(...references) : [];
    const today = now.slice(0, 10);
    const plan = checklistTaskPlan({
      projectId,
      eventDate,
      items,
      today,
      existing: existing.filter((snapshot) => snapshot.exists).map((snapshot) => ({ ...snapshot.data(), id: snapshot.id })),
    });
    for (const task of plan.create) {
      transaction.set(db.doc(`tasks/${task.id}`), {
        id: task.id,
        tenantId,
        projectId,
        workflowRunId: null,
        checkpointId: null,
        title: task.title,
        description: "",
        assignedUserId: null,
        assignedRole: null,
        dueDate: task.dueDate,
        priority: "normal",
        blocking: false,
        source: PLANNING_CHECKLIST_SOURCE,
        checklistKey: task.checklistKey,
        checklistAmount: task.checklistAmount,
        checklistUnit: task.checklistUnit,
        checklistDueDate: task.checklistDueDate,
        status: "not_started",
        completedAt: null,
        completedBy: null,
        createdAt: now,
        updatedAt: now,
        createdBy: CREATED_BY,
        updatedBy: CREATED_BY,
        archivedAt: null,
      });
    }
    for (const change of plan.update) {
      transaction.update(db.doc(`tasks/${change.id}`), {
        dueDate: change.dueDate,
        checklistDueDate: change.checklistDueDate,
        updatedAt: now,
        updatedBy: CREATED_BY,
      });
    }
    transaction.update(projectReference, {
      planningChecklist: {
        scope,
        appliedAt: now,
        itemCount: items.length,
        studioList: checklistIsCustom(stored, scope, jobKindOf(data)),
      },
    });
    return "applied";
  });
}

/** The wedding moved: the open checklist tasks on StudioCue's dates follow it. */
export async function followPlanningChecklist(
  db: Firestore,
  tenantId: string,
  projectId: string,
  eventDate: string,
  now: string,
): Promise<number> {
  const tasks = await db
    .collection("tasks")
    .where("tenantId", "==", tenantId)
    .where("projectId", "==", projectId)
    .where("source", "==", PLANNING_CHECKLIST_SOURCE)
    .get();
  const moves = followEventDate({
    eventDate,
    today: now.slice(0, 10),
    tasks: tasks.docs.map((snapshot) => ({ ...snapshot.data(), id: snapshot.id })),
  });
  if (!moves.length) return 0;
  const batch = db.batch();
  for (const move of moves) {
    batch.update(db.doc(`tasks/${move.id}`), {
      dueDate: move.dueDate,
      checklistDueDate: move.checklistDueDate,
      updatedAt: now,
      updatedBy: CREATED_BY,
    });
  }
  await batch.commit();
  return moves.length;
}

export const planningChecklistOnProjectWritten = onDocumentWritten(
  { document: "projects/{projectId}", region: "us-east4" },
  async (event) => {
    const before = event.data?.before?.data();
    const after = event.data?.after?.data();
    if (!after) return;
    const applied = Boolean((after.planningChecklist as { appliedAt?: unknown } | undefined)?.appliedAt);
    // Every job without a planning tier, and every month-of job, ends here.
    if (!applied && !checklistScopeOf(after)) return;
    const db = getFirestore();
    const now = new Date().toISOString();
    if (!applied) {
      await applyPlanningChecklist(db, event.params.projectId, now);
      return;
    }
    const eventDate = dayOf(after.eventDate);
    if (!before || dayOf(before.eventDate) === eventDate || !DAY.test(eventDate)) return;
    await followPlanningChecklist(db, text(after.tenantId), event.params.projectId, eventDate, now);
  },
);
