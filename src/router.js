import Anthropic from "@anthropic-ai/sdk";
import { classify } from "./classifier.js";
import { fallbackChain, TIERS, isValidTier } from "./models.js";

function isRetryableOnFallback(err) {
  // 429 rate_limit_error -> RateLimitError; 500/529 (incl. overloaded_error)
  // -> InternalServerError. Anything else (bad request, auth, not found) is
  // not fixed by trying a smaller model, so let it propagate.
  return (
    err instanceof Anthropic.RateLimitError ||
    err instanceof Anthropic.InternalServerError
  );
}

function errorLabel(err) {
  return err?.type ?? (err?.status ? `HTTP ${err.status}` : err?.message ?? String(err));
}

/**
 * Classify a prompt and pick the model tier that should answer it.
 * @returns {Promise<{model: string, confidence: number, reasoning: string}>}
 */
export async function selectModel(client, userPrompt, forcedTier) {
  if (forcedTier) {
    if (!isValidTier(forcedTier)) {
      throw new Error(
        `Unknown --model "${forcedTier}". Choose one of: ${Object.keys(TIERS).join(", ")}`,
      );
    }
    return {
      model: forcedTier,
      confidence: 1,
      reasoning: "Model explicitly selected via --model flag; classifier skipped.",
    };
  }
  return classify(client, userPrompt);
}

/**
 * Run the prompt against the model chain starting at `startTier`, streaming
 * text deltas through onText, and stepping down to the next cheaper tier if
 * the current one is overloaded or rate-limited.
 *
 * @returns {Promise<{tier: object, usedFallback: boolean, attempts: Array, finalMessage: object}>}
 */
export async function runWithFallback(client, startTier, userPrompt, { onText, onFallback } = {}) {
  const chain = fallbackChain(startTier);
  const attempts = [];

  for (let i = 0; i < chain.length; i++) {
    const tier = chain[i];
    try {
      const stream = client.messages.stream({
        model: tier.id,
        max_tokens: tier.maxTokens,
        messages: [{ role: "user", content: userPrompt }],
      });

      if (onText) {
        stream.on("text", onText);
      }

      const finalMessage = await stream.finalMessage();
      attempts.push({ tier: tier.key, ok: true });

      return {
        tier,
        usedFallback: i > 0,
        attempts,
        finalMessage,
      };
    } catch (err) {
      attempts.push({ tier: tier.key, ok: false, error: errorLabel(err) });

      const hasNextTier = i < chain.length - 1;
      if (isRetryableOnFallback(err) && hasNextTier) {
        const nextTier = chain[i + 1];
        onFallback?.(tier, nextTier, err);
        continue;
      }
      throw err;
    }
  }

  // Unreachable: fallbackChain() always contains at least the starting tier.
  throw new Error("Model fallback chain exhausted with no attempts recorded.");
}
