import { aiScheduleDraftSchema, type AiScheduleDraft } from "@/features/schedules/schema";
import type { AiProvider, ProviderContext } from "@/server/integrations/contracts";

export class AiScheduleService {
  constructor(private readonly ai: AiProvider) {}
  async draft(context: ProviderContext, facts: Readonly<Record<string, unknown>>): Promise<AiScheduleDraft> {
    const output = await this.ai.generateStructured(context, {
      task: "schedule",
      prompt: `Create a schedule draft using only these verified facts: ${JSON.stringify(facts)}`,
      outputSchema: aiScheduleDraftSchema,
    });
    return aiScheduleDraftSchema.parse(output);
  }
}
