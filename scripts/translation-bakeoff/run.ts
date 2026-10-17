/**
 * scripts/translation-bakeoff/run.ts
 *
 * Side-by-side translation comparison across providers, on one corpus:
 *   - real impressions from the DB (.env.local / .env → dev DB; never point
 *     this at prod), bucketed per IP via the production prompt resolver
 *   - the committed hard cases in ./cases.ts
 *
 *   npx tsx scripts/translation-bakeoff/run.ts
 *   npx tsx scripts/translation-bakeoff/run.ts --per-ip=10 --no-db
 *   npx tsx scripts/translation-bakeoff/run.ts --providers=gemini,claude-haiku-5-5
 *
 * Every provider gets the same system prompt and the same user turn
 * (buildUserInput) — no per-provider prompt tuning, so differences in the
 * output are the model's. Providers whose API key is missing are skipped
 * with a warning rather than failing the run.
 *
 * Writes ./out/bakeoff-<timestamp>.{json,html}. The out/ directory is
 * gitignored: it holds users' impression text. The verdict belongs in the
 * wiki (translation-system.md), not in the repo.
 *
 * Calls run sequentially. That keeps latency numbers free of self-inflicted
 * rate-limit queuing and lets Claude's 5-minute prompt cache warm on the
 * first call per IP prompt, the way it would in production during a live.
 */
import { config as loadEnv } from "dotenv";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { HARD_CASES, type BakeoffCase } from "./cases";
import {
  ANTHROPIC_MODELS,
  type AnthropicModel,
} from "../../src/lib/translator/anthropic";

// .env.local first so it wins over .env, matching Next.js precedence.
// Must run before anything that reads process.env at import time
// (src/lib/prisma.ts does), hence the dynamic imports in main().
loadEnv({ path: [".env.local", ".env"], quiet: true });

const LOCALES = ["ko", "ja", "en"] as const;
type Locale = (typeof LOCALES)[number];
const BUCKET_IPS = ["hasunosora", "nijigasaki"] as const;

// ANTHROPIC_MODELS is a static import: anthropic.ts reads no env at
// import time, so it is safe ahead of loadEnv (unlike prisma, below).
type ProviderId = "gemini" | "openai" | AnthropicModel;
const ALL_PROVIDERS: ProviderId[] = ["gemini", "openai", ...ANTHROPIC_MODELS];

function isAnthropicModel(p: ProviderId): p is AnthropicModel {
  return (ANTHROPIC_MODELS as readonly string[]).includes(p);
}

// USD per million tokens, from platform.claude.com pricing as of
// 2026-10-17. Only Claude cost is computed: its per-call cost depends on
// cache write vs read, which the response usage reports. Gemini/OpenAI
// costs are already known from production and their raw helpers don't
// surface usage. Keyed by AnthropicModel so a model added to
// ANTHROPIC_MODELS fails typecheck here until it has a price.
const CLAUDE_PRICES: Record<AnthropicModel, {
  input: number;
  cacheWrite5m: number;
  cacheRead: number;
  output: number;
}> = {
  "claude-haiku-5-5": { input: 0.1, cacheWrite5m: 0.125, cacheRead: 0.01, output: 0.5 },
  "claude-sonnet-5-5": { input: 2, cacheWrite5m: 2.5, cacheRead: 0.1, output: 10 },
};

type Row = BakeoffCase & { origin: "db" | "hard" };

type Result = {
  provider: ProviderId;
  latencyMs: number;
  raw: string | null;
  parsed: Record<Locale, string> | null;
  error: string | null; // provider call failed
  parseError: string | null; // call succeeded, output unparseable
  usage?: {
    input: number;
    cacheWrite: number;
    cacheRead: number;
    output: number;
    costUsd: number;
  };
};

function parseArgs() {
  const args = process.argv.slice(2);
  const get = (name: string) =>
    args.find((a) => a.startsWith(`--${name}=`))?.split("=")[1];
  const perIp = Number(get("per-ip") ?? 15);
  // NaN (or 0) would make every `length >= perIp` check false, lifting the
  // per-IP cap and sending all 400 sampled rows to every provider.
  if (!Number.isInteger(perIp) || perIp <= 0) {
    throw new Error(`--per-ip must be a positive integer, got: ${get("per-ip")}`);
  }
  const providers = (get("providers")?.split(",") ?? ALL_PROVIDERS) as ProviderId[];
  for (const p of providers) {
    if (!ALL_PROVIDERS.includes(p)) throw new Error(`Unknown provider: ${p}`);
  }
  return { perIp, providers, useDb: !args.includes("--no-db") };
}

async function loadDbRows(perIp: number): Promise<Row[]> {
  const { prisma } = await import("../../src/lib/prisma");
  // Head rows only (supersededAt null): an edited chain's older revisions
  // are near-duplicates of the head and would skew the sample.
  //
  // The IP walk (event → performers → stage identity → artists) is done
  // in this one query rather than per row through promptResolver, which
  // would be one round-trip per impression. Same filter as the resolver:
  // top-level group Artists (type=group, no parent) are the IP slugs.
  const impressions = await prisma.eventImpression.findMany({
    where: { isDeleted: false, isHidden: false, supersededAt: null },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      content: true,
      locale: true,
      event: {
        select: {
          performers: {
            select: {
              stageIdentity: {
                select: {
                  artistLinks: {
                    select: {
                      artist: {
                        select: { slug: true, type: true, parentArtistId: true },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
    take: 400,
  });

  const buckets = new Map<string, Row[]>(BUCKET_IPS.map((ip) => [ip, []]));
  for (const imp of impressions) {
    if (!(LOCALES as readonly string[]).includes(imp.locale)) continue;
    if ([...buckets.values()].every((b) => b.length >= perIp)) break;
    // Bucket by the single bucketed IP among the event's slugs, not by
    // what promptResolver would pick. Cross-IP groups such as AiScReam
    // are top-level group Artists, so an event with one of their members
    // (e.g. Ceras) resolves to ["hasunosora","aiscream"] → multi-IP →
    // generic, and no impression would ever land in an IP bucket. This
    // compares providers on the prompt the impression should get; the
    // resolver behaviour itself is a separate issue.
    const slugs = new Set<string>();
    for (const p of imp.event.performers) {
      for (const { artist } of p.stageIdentity.artistLinks) {
        if (artist.type === "group" && artist.parentArtistId === null) {
          slugs.add(artist.slug);
        }
      }
    }
    const ips = [...slugs].filter((s) => (BUCKET_IPS as readonly string[]).includes(s));
    if (ips.length !== 1) continue;
    const ipKey = ips[0];
    const bucket = buckets.get(ipKey);
    if (!bucket || bucket.length >= perIp) continue;
    bucket.push({
      // Full id: the row id keys the results map, so a truncated prefix
      // could collide and silently merge two rows.
      id: `db-${imp.id}`,
      sourceLocale: imp.locale as Locale,
      ipKey,
      text: imp.content,
      why: "real impression (dev DB)",
      origin: "db",
    });
  }
  await prisma.$disconnect();
  for (const [ip, rows] of buckets) {
    console.log(`  db: ${rows.length} impressions for ${ip}`);
  }
  return [...buckets.values()].flat();
}

type Caller = (row: Row, systemPrompt: string) => Promise<{
  raw: string;
  usage?: Result["usage"];
}>;

async function buildCallers(
  providers: ProviderId[],
): Promise<Map<ProviderId, Caller>> {
  const callers = new Map<ProviderId, Caller>();
  const timeout = () => AbortSignal.timeout(30_000);

  if (providers.includes("gemini")) {
    const key = process.env.GEMINI_API_KEY;
    if (!key) console.warn("  skip gemini: GEMINI_API_KEY not set");
    else {
      const { GoogleGenAI } = await import("@google/genai");
      const { geminiRawTranslate } = await import("../../src/lib/translator/gemini");
      const client = new GoogleGenAI({ apiKey: key });
      callers.set("gemini", async (row, sys) => ({
        raw: await geminiRawTranslate(client, row.text, row.sourceLocale, sys, timeout()),
      }));
    }
  }

  if (providers.includes("openai")) {
    const key = process.env.OPENAI_API_KEY;
    if (!key) console.warn("  skip openai: OPENAI_API_KEY not set");
    else {
      const { default: OpenAI } = await import("openai");
      const { openaiRawTranslate } = await import("../../src/lib/translator/openai");
      const client = new OpenAI({ apiKey: key });
      callers.set("openai", async (row, sys) => ({
        raw: await openaiRawTranslate(client, row.text, row.sourceLocale, sys, timeout()),
      }));
    }
  }

  const claudeModels = providers.filter(isAnthropicModel);
  if (claudeModels.length > 0) {
    const key = process.env.ANTHROPIC_API_KEY;
    if (!key) console.warn("  skip claude: ANTHROPIC_API_KEY not set");
    else {
      const { default: Anthropic } = await import("@anthropic-ai/sdk");
      const { anthropicRawTranslate } = await import(
        "../../src/lib/translator/anthropic"
      );
      const client = new Anthropic({ apiKey: key });
      for (const model of claudeModels) {
        callers.set(model, async (row, sys) => {
          const { raw, usage } = await anthropicRawTranslate(
            client, row.text, row.sourceLocale, sys, timeout(), model,
          );
          const price = CLAUDE_PRICES[model];
          const u = {
            input: usage.input_tokens,
            cacheWrite: usage.cache_creation_input_tokens ?? 0,
            cacheRead: usage.cache_read_input_tokens ?? 0,
            output: usage.output_tokens,
          };
          const costUsd =
            (u.input * price.input +
              u.cacheWrite * price.cacheWrite5m +
              u.cacheRead * price.cacheRead +
              u.output * price.output) /
            1_000_000;
          return { raw, usage: { ...u, costUsd } };
        });
      }
    }
  }
  return callers;
}

function percentile(values: number[], p: number): number {
  if (values.length === 0) return NaN;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)];
}

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function renderHtml(
  rows: Row[],
  results: Map<string, Result[]>,
  providers: ProviderId[],
  startedAt: string,
): string {
  const summary = providers.map((p) => {
    const rs = rows.flatMap((r) => results.get(r.id)!.filter((x) => x.provider === p));
    const lat = rs.filter((r) => !r.error).map((r) => r.latencyMs);
    const cost = rs.reduce((s, r) => s + (r.usage?.costUsd ?? 0), 0);
    const cacheReads = rs.filter((r) => (r.usage?.cacheRead ?? 0) > 0).length;
    return `<tr><td>${p}</td><td>${rs.filter((r) => r.parsed).length}/${rs.length}</td>
      <td>${rs.filter((r) => r.parseError).length}</td><td>${rs.filter((r) => r.error).length}</td>
      <td>${Math.round(percentile(lat, 50))}</td><td>${Math.round(percentile(lat, 95))}</td>
      <td>${rs.some((r) => r.usage) ? `$${cost.toFixed(5)} (cache hits ${cacheReads})` : "—"}</td></tr>`;
  });

  const body = rows.map((row) => {
    const cells = providers.map((p) => {
      const r = results.get(row.id)!.find((x) => x.provider === p);
      if (!r) return "<td class=muted>skipped</td>";
      if (r.error) return `<td class=err>${esc(r.error)}<div class=meta>${r.latencyMs}ms</div></td>`;
      if (!r.parsed) {
        return `<td class=err>parse: ${esc(r.parseError ?? "")}<pre>${esc(r.raw ?? "")}</pre></td>`;
      }
      const lines = LOCALES.map(
        (l) => `<div class="${l === row.sourceLocale ? "src" : ""}"><b>${l}</b> ${esc(r.parsed![l])}</div>`,
      ).join("");
      const meta = `${r.latencyMs}ms${r.usage ? ` · in ${r.usage.input}/cw ${r.usage.cacheWrite}/cr ${r.usage.cacheRead} · out ${r.usage.output}` : ""}`;
      return `<td>${lines}<div class=meta>${meta}</div></td>`;
    });
    return `<tr><td class=case><div class=id>${esc(row.id)} · ${row.ipKey} · ${row.sourceLocale}</div>
      <div class=text>${esc(row.text)}</div><div class=why>${esc(row.why)}</div></td>${cells.join("")}</tr>`;
  });

  return `<!doctype html><html lang="ko"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Translation bake-off</title>
<style>
:root{--bg:#fff;--fg:#18181b;--muted:#71717a;--line:#e4e4e7;--err:#b91c1c;--src:#a1a1aa}
@media (prefers-color-scheme:dark){:root{--bg:#18181b;--fg:#f4f4f5;--muted:#a1a1aa;--line:#3f3f46;--err:#f87171;--src:#71717a}}
body{background:var(--bg);color:var(--fg);font:14px/1.5 system-ui,sans-serif;margin:16px}
table{border-collapse:collapse;width:100%}td,th{border:1px solid var(--line);padding:8px;vertical-align:top;text-align:left}
.case{width:22%}.id,.meta,.why{color:var(--muted);font-size:12px}.text{white-space:pre-wrap;font-weight:600;margin:4px 0}
.src{color:var(--src)}.err{color:var(--err)}.muted{color:var(--muted)}pre{white-space:pre-wrap;font-size:12px}
</style></head><body>
<h1>Translation bake-off</h1><p class=muted>${startedAt} · ${rows.length} cases · source row is dimmed</p>
<h2>Summary</h2><table><tr><th>provider</th><th>parsed</th><th>parse fail</th><th>call error</th><th>p50 ms</th><th>p95 ms</th><th>cost</th></tr>${summary.join("")}</table>
<h2>Cases</h2><table><tr><th>case</th>${providers.map((p) => `<th>${p}</th>`).join("")}</tr>${body.join("")}</table>
</body></html>`;
}

async function main() {
  const { perIp, providers, useDb } = parseArgs();
  const { IP_PROMPTS, FALLBACK_PROMPT } = await import("../../src/lib/translator/prompts");
  const { parseMultilingualResponse } = await import("../../src/lib/translator/prompt");

  console.log("Loading corpus…");
  const rows: Row[] = [
    ...(useDb ? await loadDbRows(perIp) : []),
    ...HARD_CASES.map((c) => ({ ...c, origin: "hard" as const })),
  ];

  const callers = await buildCallers(providers);
  const active = providers.filter((p) => callers.has(p));
  if (active.length === 0) {
    console.error("No provider has an API key — nothing to run");
    process.exit(2);
  }
  console.log(`Running ${rows.length} cases × ${active.join(", ")}`);

  const startedAt = new Date().toISOString();
  const results = new Map<string, Result[]>();
  for (const [i, row] of rows.entries()) {
    const systemPrompt = IP_PROMPTS[row.ipKey] ?? FALLBACK_PROMPT;
    const rowResults: Result[] = [];
    for (const provider of active) {
      const t0 = performance.now();
      const res: Result = {
        provider, latencyMs: 0, raw: null, parsed: null, error: null, parseError: null,
      };
      try {
        const { raw, usage } = await callers.get(provider)!(row, systemPrompt);
        res.latencyMs = Math.round(performance.now() - t0);
        res.raw = raw;
        res.usage = usage;
        try {
          res.parsed = parseMultilingualResponse(raw);
        } catch (err) {
          res.parseError = err instanceof Error ? err.message : String(err);
        }
      } catch (err) {
        res.latencyMs = Math.round(performance.now() - t0);
        res.error = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
      }
      rowResults.push(res);
    }
    results.set(row.id, rowResults);
    const marks = rowResults.map((r) => (r.parsed ? "✓" : "✕")).join("");
    console.log(`  [${i + 1}/${rows.length}] ${marks} ${row.id}`);
  }

  const outDir = join("scripts", "translation-bakeoff", "out");
  mkdirSync(outDir, { recursive: true });
  const stamp = startedAt.replace(/[:.]/g, "-");
  const base = join(outDir, `bakeoff-${stamp}`);
  writeFileSync(
    `${base}.json`,
    JSON.stringify({ startedAt, providers: active, rows, results: Object.fromEntries(results) }, null, 2),
  );
  writeFileSync(`${base}.html`, renderHtml(rows, results, active, startedAt));
  console.log(`\nWrote ${base}.html`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
