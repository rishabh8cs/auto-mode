import { z } from "zod";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { TIERS } from "./models.js";

const ClassificationSchema = z.object({
  model: z.enum(["haiku", "sonnet", "opus", "fable"]),
  confidence: z.number().min(0).max(1),
  reasoning: z.string(),
});

const CLASSIFIER_SYSTEM_PROMPT = `You are a routing classifier for a Claude API gateway. Read the user's message and decide which model tier should answer it. Respond only through the structured output schema.

Tiers, from cheapest/fastest to most capable:

- haiku: ${TIERS.haiku.description}
- sonnet: ${TIERS.sonnet.description}
- opus: ${TIERS.opus.description}
- fable: ${TIERS.fable.description}

Rules:
1. Pick the cheapest tier that can fully handle the request. Do not over-provision "just in case".
2. Route to "fable" ONLY when the user explicitly asks for the best, most capable, most powerful, or smartest model available, or the task is clearly agentic/long-horizon work spanning an entire codebase or a multi-stage research project. Never pick "fable" by default for merely hard questions — that's "opus" territory.
3. Estimate the expected length and depth of a good answer to decide between haiku/sonnet/opus: a one-line fact or yes/no answer is haiku; a few paragraphs of writing, review, or structured analysis is sonnet; a response that requires weighing tradeoffs across many steps or synthesizing multiple sources is opus.
4. confidence is your certainty in this routing decision, from 0 (a coin flip) to 1 (certain).
5. reasoning is one short sentence explaining the choice — it will be shown to the end user.`;

export async function classify(client, userPrompt) {
  const response = await client.messages.parse({
    model: TIERS.haiku.id,
    max_tokens: 300,
    system: CLASSIFIER_SYSTEM_PROMPT,
    messages: [{ role: "user", content: userPrompt }],
    output_config: {
      format: zodOutputFormat(ClassificationSchema),
    },
  });

  if (!response.parsed_output) {
    // Structured parse failed (rare) - fail open to the mid-tier model
    // rather than block the request.
    return {
      model: "sonnet",
      confidence: 0,
      reasoning: "Classifier output failed to parse; defaulted to sonnet.",
    };
  }

  return response.parsed_output;
}
