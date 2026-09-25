import { TIERS } from "./models.js";

// Cache write/read multipliers relative to a model's base input price,
// per https://platform.claude.com/docs/en/about-claude/pricing#prompt-caching.
// This tool doesn't set cache_control on requests, so these stay at 0 in
// practice — they're here so cost math is correct if that ever changes.
const CACHE_WRITE_5M_MULTIPLIER = 1.25;
const CACHE_READ_MULTIPLIER = 0.1;

export function calculateCost(tierKey, usage = {}) {
  const tier = TIERS[tierKey];
  if (!tier) throw new Error(`Unknown model tier "${tierKey}"`);

  const inputTokens = usage.input_tokens ?? 0;
  const outputTokens = usage.output_tokens ?? 0;
  const cacheWriteTokens = usage.cache_creation_input_tokens ?? 0;
  const cacheReadTokens = usage.cache_read_input_tokens ?? 0;

  const inputCost = (inputTokens / 1_000_000) * tier.input;
  const outputCost = (outputTokens / 1_000_000) * tier.output;
  const cacheWriteCost =
    (cacheWriteTokens / 1_000_000) * tier.input * CACHE_WRITE_5M_MULTIPLIER;
  const cacheReadCost =
    (cacheReadTokens / 1_000_000) * tier.input * CACHE_READ_MULTIPLIER;

  return {
    inputTokens,
    outputTokens,
    cacheWriteTokens,
    cacheReadTokens,
    inputCost,
    outputCost,
    cacheWriteCost,
    cacheReadCost,
    total: inputCost + outputCost + cacheWriteCost + cacheReadCost,
  };
}

export function formatUsd(amount) {
  if (amount < 0.01) return `$${amount.toFixed(6)}`;
  return `$${amount.toFixed(4)}`;
}
