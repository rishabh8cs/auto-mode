// Model tier configuration: routing targets, pricing, and per-tier defaults.
//
// Model IDs and per-million-token pricing verified against
// https://platform.claude.com/docs/en/about-claude/pricing (2026-09-25).
// Sonnet 4.5 and Opus 4.5 are legacy-but-active model generations, kept here
// because the routing spec names them explicitly; swap to claude-sonnet-5 /
// claude-opus-5 to move onto the current generation.

export const TIERS = {
  haiku: {
    key: "haiku",
    label: "Haiku 4.5",
    id: "claude-haiku-4-5",
    maxTokens: 1024,
    input: 1.0,
    output: 5.0,
    description:
      "Simple factual lookups, quick answers, grammar checks, basic summaries (<100 tokens expected)",
  },
  sonnet: {
    key: "sonnet",
    label: "Sonnet 4.5",
    id: "claude-sonnet-4-5",
    maxTokens: 4096,
    input: 3.0,
    output: 15.0,
    description:
      "Medium complexity: code reviews, document generation, structured analysis, writing tasks (100-500 tokens)",
  },
  opus: {
    key: "opus",
    label: "Opus 4.5",
    id: "claude-opus-4-5",
    maxTokens: 8192,
    input: 5.0,
    output: 25.0,
    description:
      "Complex reasoning: system design, deep analysis, multi-step problems, research synthesis (500+ tokens)",
  },
  fable: {
    key: "fable",
    label: "Fable 5",
    id: "claude-fable-5",
    maxTokens: 16000,
    input: 10.0,
    output: 50.0,
    description:
      "Agentic workloads, long-horizon tasks, codebase-wide refactors, scientific research — only when the user explicitly asks for the \"best\" or \"most capable\" model",
  },
};

export const TIER_ORDER = ["fable", "opus", "sonnet", "haiku"];

export function isValidTier(key) {
  return Object.prototype.hasOwnProperty.call(TIERS, key);
}

// The fallback chain for a tier is every tier at or below it in capability,
// cheapest-last-resort being Haiku. On overload/rate-limit we step down one
// rung at a time rather than jumping straight to Haiku, so quality only
// degrades as far as it has to.
export function fallbackChain(startKey) {
  const startIndex = TIER_ORDER.indexOf(startKey);
  if (startIndex === -1) {
    throw new Error(`Unknown model tier "${startKey}"`);
  }
  return TIER_ORDER.slice(startIndex).map((key) => TIERS[key]);
}
