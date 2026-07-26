import type { z } from "zod";
import {
  automationRuleSchema,
  workflowActionSchema,
} from "@/features/workflows/schema";

export type AutomationRule = z.infer<typeof automationRuleSchema>;
export type WorkflowAction = z.infer<typeof workflowActionSchema>;
