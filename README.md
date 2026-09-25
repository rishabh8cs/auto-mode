# auto-claude

An auto-routing model selector for the Claude API. Every prompt is first run
through a lightweight Haiku classifier that picks the cheapest model tier
capable of answering it, then the prompt is streamed to that model. If the
selected model is overloaded or rate-limited, the request automatically
steps down to the next smaller tier instead of failing.

## Routing tiers

| Tier   | Model              | Use case                                                                                          | Price (in/out per MTok) |
| ------ | ------------------ | --------------------------------------------------------------------------------------------------- | ------------------------ |
| haiku  | `claude-haiku-4-5`  | Simple factual lookups, quick answers, grammar checks, basic summaries (<100 tokens expected)        | $1 / $5                  |
| sonnet | `claude-sonnet-4-5` | Medium complexity: code reviews, document generation, structured analysis, writing (100-500 tokens)  | $3 / $15                 |
| opus   | `claude-opus-4-5`   | Complex reasoning: system design, deep analysis, multi-step problems, research synthesis (500+ tokens) | $5 / $25                |
| fable  | `claude-fable-5`    | Agentic workloads, long-horizon tasks, codebase-wide refactors, scientific research — only when you explicitly ask for the "best" or "most capable" model | $10 / $50 |

The classifier returns `{ model, confidence, reasoning }` and is shown above
every response so you can see (and sanity-check) why a tier was chosen.

On overload (`overloaded_error`) or rate limiting (`rate_limit_error`), the
request retries on the next cheaper tier in the chain
(`fable → opus → sonnet → haiku`) rather than failing outright.

## Setup

```bash
npm install
```

Credentials are resolved by the SDK automatically — set `ANTHROPIC_API_KEY`,
or run `ant auth login` if you use the Anthropic CLI. Nothing needs to be
hardcoded.

## Usage

```bash
# One-shot
node src/cli.js "What's the capital of France?"

# Force a tier, skipping the classifier
node src/cli.js --model opus "Design a rate limiter for a multi-tenant API"

# Buffer instead of stream (useful for piping/scripting)
node src/cli.js --no-stream "Summarize this paragraph: ..."

# Machine-readable output
node src/cli.js --json "..." | jq .cost

# Read the prompt from stdin
cat notes.txt | node src/cli.js

# Interactive REPL (tracks a running session cost)
node src/cli.js -i
```

Or, after `npm link` (or installing globally), just `auto-claude "..."`.

### Output

Each response prints the routing decision, the streamed answer, and a
footer with the model actually served, token usage, and estimated cost:

```
→ routed to Opus 4.5 (92% confidence) — multi-step architectural tradeoffs
<streamed answer>

— Opus 4.5 · 143 in / 612 out tokens · $0.0158 · 4213ms
```

If a fallback occurred, a `[fallback]` notice is printed to stderr and the
footer is marked `(fallback)`.

## Project layout

- `src/models.js` — tier config: model IDs, pricing, max tokens, fallback chain
- `src/classifier.js` — the Haiku-based routing classifier (structured output via Zod)
- `src/router.js` — model selection + streaming with fallback-on-overload
- `src/pricing.js` — cost calculation from `usage`
- `src/cli.js` — argument parsing, streaming output, interactive REPL
