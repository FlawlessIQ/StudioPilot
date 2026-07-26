import type { AutomationRun } from "@/features/automation/schema";
import { automationRunSchema } from "@/features/automation/schema";
import type {
  AutomationRule,
  WorkflowAction,
} from "./automation-types";

export interface AutomationRunStore {
  findByIdempotencyKey(
    tenantId: string,
    idempotencyKey: string,
  ): Promise<AutomationRun | null>;
  create(run: AutomationRun): Promise<void>;
  update(run: AutomationRun): Promise<void>;
}

export interface AutomationActionHandler {
  execute(input: {
    tenantId: string;
    projectId: string | null;
    workflowRunId: string | null;
    automationRunId: string;
    action: WorkflowAction;
    payload: Readonly<Record<string, unknown>>;
  }): Promise<Record<string, unknown>>;
}

function compare(
  actual: unknown,
  operator: AutomationRule["conditions"][number]["operator"],
  expected: unknown,
): boolean {
  if (operator === "exists") return actual !== undefined && actual !== null;
  if (operator === "equals") return actual === expected;
  if (operator === "not_equals") return actual !== expected;
  if (operator === "in") return Array.isArray(expected) && expected.includes(actual);
  if (operator === "not_in") return Array.isArray(expected) && !expected.includes(actual);
  if (operator === "greater_than") {
    return typeof actual === "number" && typeof expected === "number" && actual > expected;
  }
  if (operator === "less_than") {
    return typeof actual === "number" && typeof expected === "number" && actual < expected;
  }
  return false;
}

export function automationConditionsPass(
  rule: AutomationRule,
  payload: Readonly<Record<string, unknown>>,
): boolean {
  return rule.conditions.every((condition) =>
    compare(payload[condition.field], condition.operator, condition.value),
  );
}

export class AutomationService {
  constructor(
    private readonly store: AutomationRunStore,
    private readonly handlers: ReadonlyMap<WorkflowAction["type"], AutomationActionHandler>,
    private readonly createId: () => string,
    private readonly now: () => string = () => new Date().toISOString(),
  ) {}

  async execute(input: {
    tenantId: string;
    projectId: string | null;
    workflowRunId: string | null;
    workflowVersion: number;
    rule: AutomationRule;
    idempotencyKey: string;
    payload: Readonly<Record<string, unknown>>;
    actorId?: string;
  }): Promise<AutomationRun> {
    const prior = await this.store.findByIdempotencyKey(
      input.tenantId,
      input.idempotencyKey,
    );
    if (prior) return prior;

    const timestamp = this.now();
    const actorId = input.actorId ?? "automation-engine";
    const runId = this.createId();
    const base = automationRunSchema.parse({
      id: runId,
      tenantId: input.tenantId,
      projectId: input.projectId,
      workflowRunId: input.workflowRunId,
      workflowVersion: input.workflowVersion,
      automationRuleKey: input.rule.key,
      trigger: input.rule.trigger,
      idempotencyKey: input.idempotencyKey,
      inputSnapshot: input.payload,
      actionTypes: input.rule.actions.map((action) => action.type),
      attemptCount: 1,
      status: "running",
      result: null,
      error: null,
      retryState: { nextAttemptAt: null, maxAttempts: 5 },
      startedAt: timestamp,
      completedAt: null,
      manualRerunOfId: null,
      createdAt: timestamp,
      updatedAt: timestamp,
      createdBy: actorId,
      updatedBy: actorId,
      archivedAt: null,
    });
    await this.store.create(base);

    if (!automationConditionsPass(input.rule, input.payload)) {
      const skipped = automationRunSchema.parse({
        ...base,
        status: "succeeded",
        result: { skipped: true, reason: "conditions_not_met" },
        completedAt: timestamp,
      });
      await this.store.update(skipped);
      return skipped;
    }

    try {
      const actionResults: Record<string, unknown> = {};
      for (const action of input.rule.actions) {
        if (action.requiresApproval) {
          actionResults[action.key] = { status: "approval_required" };
          continue;
        }
        const handler = this.handlers.get(action.type);
        if (!handler) throw new Error(`No handler registered for ${action.type}.`);
        actionResults[action.key] = await handler.execute({
          tenantId: input.tenantId,
          projectId: input.projectId,
          workflowRunId: input.workflowRunId,
          automationRunId: runId,
          action,
          payload: input.payload,
        });
      }
      const completedAt = this.now();
      const completed = automationRunSchema.parse({
        ...base,
        status: "succeeded",
        result: actionResults,
        completedAt,
        updatedAt: completedAt,
      });
      await this.store.update(completed);
      return completed;
    } catch (caught: unknown) {
      const completedAt = this.now();
      const failed = automationRunSchema.parse({
        ...base,
        status: "retry_scheduled",
        error: {
          code: "ACTION_FAILED",
          message: caught instanceof Error ? caught.message : "Automation action failed.",
          retryable: true,
        },
        retryState: {
          nextAttemptAt: new Date(
            new Date(completedAt).valueOf() + 60_000,
          ).toISOString(),
          maxAttempts: 5,
        },
        completedAt,
        updatedAt: completedAt,
      });
      await this.store.update(failed);
      return failed;
    }
  }
}
