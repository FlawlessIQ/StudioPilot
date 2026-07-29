#!/usr/bin/env node

import { performance } from "node:perf_hooks";

const scenarios = {
  health: { method: "GET", path: "/api/health", expected: [200] },
  sendgridWebhook: {
    method: "POST",
    path: "/api/webhooks/sendgrid/events",
    expected: [400, 401, 403],
    body: "[]",
  },
  stripeWebhook: {
    method: "POST",
    path: "/api/webhooks/stripe",
    expected: [400, 401, 403],
    body: "{}",
  },
  ai: {
    method: "POST",
    path: "/api/functions/aiCommand",
    expected: [401, 403],
    body: "{}",
  },
  document: {
    method: "POST",
    path: "/api/functions/documentCommand",
    expected: [401, 403],
    body: "{}",
  },
  readiness: {
    method: "POST",
    path: "/api/functions/readinessCommand",
    expected: [401, 403],
    body: "{}",
  },
  reconciliation: {
    method: "POST",
    path: "/api/functions/providerReconciliation",
    expected: [401, 403, 404],
    body: "{}",
  },
  email: {
    method: "POST",
    path: "/api/functions/communicationsCommand",
    expected: [401, 403],
    body: "{}",
  },
};

function argument(name, fallback) {
  const position = process.argv.indexOf(`--${name}`);
  return position >= 0 ? process.argv[position + 1] : fallback;
}

const scenarioName = argument("scenario", "health");
const scenario = scenarios[scenarioName];
if (!scenario) {
  throw new Error(
    `Unknown scenario "${scenarioName}". Choose ${Object.keys(scenarios).join(", ")}.`,
  );
}

const baseUrl = (
  process.env.LOAD_BASE_URL ??
  argument("base-url", "http://127.0.0.1:3000")
).replace(/\/$/, "");
const iterations = Number(argument("iterations", process.env.LOAD_ITERATIONS ?? "25"));
const concurrency = Number(argument("concurrency", process.env.LOAD_CONCURRENCY ?? "5"));
const timeoutMs = Number(argument("timeout-ms", process.env.LOAD_TIMEOUT_MS ?? "10000"));
const p95ObjectiveMs = Number(
  argument("p95-ms", process.env.LOAD_P95_OBJECTIVE_MS ?? "1500"),
);
const errorRateObjective = Number(
  argument("error-rate", process.env.LOAD_ERROR_RATE_OBJECTIVE ?? "0.01"),
);

if (
  !Number.isSafeInteger(iterations) ||
  iterations < 1 ||
  iterations > 10_000 ||
  !Number.isSafeInteger(concurrency) ||
  concurrency < 1 ||
  concurrency > 200
) {
  throw new Error("Iterations or concurrency is outside the bounded safety range.");
}

const productionTarget =
  /\.hosted\.app$/.test(new URL(baseUrl).hostname) ||
  process.env.NODE_ENV === "production";
if (
  productionTarget &&
  scenarioName !== "health" &&
  process.env.ALLOW_PRODUCTION_LOAD_TEST !== "true"
) {
  throw new Error(
    "Production mutation scenarios require ALLOW_PRODUCTION_LOAD_TEST=true.",
  );
}

function percentile(values, fraction) {
  if (!values.length) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * fraction) - 1)];
}

let cursor = 0;
const results = [];

async function worker() {
  while (cursor < iterations) {
    const index = cursor;
    cursor += 1;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const startedAt = performance.now();
    try {
      const response = await fetch(`${baseUrl}${scenario.path}`, {
        method: scenario.method,
        headers: scenario.body ? { "content-type": "application/json" } : undefined,
        body: scenario.body,
        signal: controller.signal,
      });
      results[index] = {
        durationMs: performance.now() - startedAt,
        ok: scenario.expected.includes(response.status),
        status: response.status,
      };
      await response.arrayBuffer();
    } catch (error) {
      results[index] = {
        durationMs: performance.now() - startedAt,
        ok: false,
        status: error instanceof Error ? error.name : "request_error",
      };
    } finally {
      clearTimeout(timer);
    }
  }
}

await Promise.all(
  Array.from({ length: Math.min(concurrency, iterations) }, () => worker()),
);

const durations = results.map((result) => result.durationMs);
const failures = results.filter((result) => !result.ok);
const report = {
  scenario: scenarioName,
  baseUrl,
  iterations,
  concurrency,
  passed: results.length - failures.length,
  failed: failures.length,
  errorRate: failures.length / results.length,
  latencyMs: {
    p50: Math.round(percentile(durations, 0.5)),
    p95: Math.round(percentile(durations, 0.95)),
    p99: Math.round(percentile(durations, 0.99)),
    max: Math.round(Math.max(...durations)),
  },
  objectives: { p95Ms: p95ObjectiveMs, errorRate: errorRateObjective },
  statuses: Object.fromEntries(
    [...new Set(results.map((result) => String(result.status)))].map((status) => [
      status,
      results.filter((result) => String(result.status) === status).length,
    ]),
  ),
};

console.log(JSON.stringify(report, null, 2));
if (
  report.errorRate > errorRateObjective ||
  report.latencyMs.p95 > p95ObjectiveMs
) {
  process.exitCode = 1;
}
