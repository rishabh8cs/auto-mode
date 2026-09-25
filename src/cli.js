#!/usr/bin/env node
import readline from "node:readline";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { config as loadEnv } from "dotenv";
import Anthropic from "@anthropic-ai/sdk";
import { TIERS } from "./models.js";
import { selectModel, runWithFallback } from "./router.js";
import { calculateCost, formatUsd } from "./pricing.js";

// Load ANTHROPIC_API_KEY (and anything else) from a .env file next to the
// project root — resolved by script location, not cwd, so `auto-claude`
// works the same whether you're inside the repo or linked globally and run
// it from elsewhere. Never overrides a var already set in the shell.
const __dirname = path.dirname(fileURLToPath(import.meta.url));
loadEnv({ path: path.join(__dirname, "..", ".env"), quiet: true });

const COLOR = {
  reset: "\x1b[0m",
  dim: "\x1b[2m",
  bold: "\x1b[1m",
  cyan: "\x1b[36m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  red: "\x1b[31m",
  magenta: "\x1b[35m",
};

function paint(color, text) {
  if (!process.stdout.isTTY) return text;
  return `${COLOR[color]}${text}${COLOR.reset}`;
}

function usage() {
  console.log(`${paint("bold", "auto-claude")} — auto-routing model selector for the Claude API

Usage:
  auto-claude "<prompt>"              Classify and answer a single prompt
  auto-claude -i, --interactive       Interactive REPL mode
  echo "<prompt>" | auto-claude       Read the prompt from stdin

Options:
  --model <tier>     Skip the classifier; force haiku|sonnet|opus|fable
  --no-stream        Buffer the full response instead of streaming it
  --json             Print a single JSON result object instead of formatted text
  -h, --help         Show this help

Tiers:
  haiku   ${TIERS.haiku.id}   ($${TIERS.haiku.input}/$${TIERS.haiku.output} per MTok)
  sonnet  ${TIERS.sonnet.id}  ($${TIERS.sonnet.input}/$${TIERS.sonnet.output} per MTok)
  opus    ${TIERS.opus.id}    ($${TIERS.opus.input}/$${TIERS.opus.output} per MTok)
  fable   ${TIERS.fable.id}         ($${TIERS.fable.input}/$${TIERS.fable.output} per MTok)
`);
}

function parseArgs(argv) {
  const args = { positional: [], model: null, stream: true, json: false, interactive: false, help: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    switch (arg) {
      case "-h":
      case "--help":
        args.help = true;
        break;
      case "-i":
      case "--interactive":
        args.interactive = true;
        break;
      case "--no-stream":
        args.stream = false;
        break;
      case "--json":
        args.json = true;
        break;
      case "--model":
        args.model = argv[++i];
        break;
      default:
        args.positional.push(arg);
    }
  }
  return args;
}

async function readStdin() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  return Buffer.concat(chunks).toString("utf8").trim();
}

/**
 * Run one prompt end-to-end: classify, stream/buffer the answer with
 * fallback, and render the result. Returns the cost of this single call.
 */
async function handlePrompt(client, prompt, opts) {
  const t0 = Date.now();
  const classification = await selectModel(client, prompt, opts.model);
  const tier = TIERS[classification.model];

  if (!opts.json) {
    console.log(
      paint("dim", `→ routed to `) +
        paint("cyan", tier.label) +
        paint("dim", ` (${(classification.confidence * 100).toFixed(0)}% confidence) — ${classification.reasoning}`),
    );
  }

  let fallbackNotice = null;
  const onText = opts.stream ? (text) => process.stdout.write(text) : undefined;
  const onFallback = (from, to, err) => {
    fallbackNotice = { from: from.key, to: to.key, reason: err?.type ?? err?.message };
    if (!opts.json) {
      console.error(
        paint("yellow", `\n[fallback] ${from.label} unavailable (${err?.type ?? err?.status ?? "error"}) — retrying on ${to.label}...\n`),
      );
    }
  };

  const { tier: servedTier, usedFallback, finalMessage } = await runWithFallback(
    client,
    classification.model,
    prompt,
    { onText, onFallback },
  );

  const text = finalMessage.content
    .filter((b) => b.type === "text")
    .map((b) => b.text)
    .join("");

  if (!opts.stream && !opts.json) {
    console.log(text);
  }

  const cost = calculateCost(servedTier.key, finalMessage.usage);
  const elapsedMs = Date.now() - t0;

  if (opts.json) {
    console.log(
      JSON.stringify(
        {
          prompt,
          classification,
          servedModel: servedTier.id,
          servedTier: servedTier.key,
          usedFallback,
          fallback: fallbackNotice,
          text,
          usage: finalMessage.usage,
          cost: cost.total,
          costBreakdown: cost,
          elapsedMs,
        },
        null,
        2,
      ),
    );
  } else {
    console.log(
      "\n" +
        paint(
          "dim",
          `— ${servedTier.label}${usedFallback ? " (fallback)" : ""} · ${cost.inputTokens} in / ${cost.outputTokens} out tokens · ${formatUsd(cost.total)} · ${elapsedMs}ms`,
        ),
    );
  }

  return cost.total;
}

async function runInteractive(client, opts) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  console.log(paint("bold", "auto-claude interactive mode") + paint("dim", " — type a prompt, or 'exit' to quit.\n"));

  let sessionCost = 0;
  const ask = () =>
    new Promise((resolve) => rl.question(paint("green", "> "), resolve));

  // eslint-disable-next-line no-constant-condition
  while (true) {
    const line = (await ask()).trim();
    if (!line) continue;
    if (["exit", "quit", ":q"].includes(line.toLowerCase())) break;

    try {
      sessionCost += await handlePrompt(client, line, opts);
      console.log(paint("dim", `(session total: ${formatUsd(sessionCost)})\n`));
    } catch (err) {
      console.error(paint("red", `\n[error] ${err?.message ?? err}\n`));
    }
  }

  rl.close();
  console.log(paint("dim", `\nSession total: ${formatUsd(sessionCost)}`));
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));

  if (opts.help) {
    usage();
    return;
  }

  const client = new Anthropic();

  if (opts.interactive) {
    await runInteractive(client, opts);
    return;
  }

  let prompt = opts.positional.join(" ").trim();
  if (!prompt && !process.stdin.isTTY) {
    prompt = await readStdin();
  }

  if (!prompt) {
    usage();
    process.exitCode = 1;
    return;
  }

  await handlePrompt(client, prompt, opts);
}

main().catch((err) => {
  if (err instanceof Anthropic.APIError) {
    console.error(paint("red", `\n[API error ${err.status ?? ""}] ${err.type ?? err.message}`));
  } else {
    console.error(paint("red", `\n[error] ${err?.message ?? err}`));
  }
  process.exitCode = 1;
});
