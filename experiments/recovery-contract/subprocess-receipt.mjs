/**
 * Classify subprocess outcomes without treating a missing exit status as
 * successful work. Capture the real exit signal, error type, elapsed time and
 * bounded stdout/stderr. Never retry a possibly consequential action here.
 *
 * A genuine injected SIGKILL has signal SIGKILL with no spawn error.
 * A timed-out child has error.code ETIMEDOUT, irrespective of its signal.
 */
import { spawnSync } from "node:child_process";
import { performance } from "node:perf_hooks";

export const DEFAULT_TIMEOUT_MS = 60000;
export function invokeChild(executable, args, {
  timeoutMs = DEFAULT_TIMEOUT_MS,
  outputLimit = 1200,
} = {}) {
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 120000) {
    throw new Error("Invalid bounded child timeout");
  }
  if (!Number.isSafeInteger(outputLimit) || outputLimit < 1 || outputLimit > 12000) {
    throw new Error("Invalid bounded child output limit");
  }
  const started = performance.now();
  const result = spawnSync(executable, args, {
    encoding: "utf8",
    timeout: timeoutMs,
    killSignal: "SIGKILL",
    maxBuffer: 1048576,
  });
  const error = result.error
    ? { code: result.error.code ?? null, message: String(result.error.message).slice(0, 250) }
    : null;
  const timedOut = error?.code === "ETIMEDOUT";
  return {
    status: result.status,
    signal: result.signal,
    timedOut,
    error,
    durationMs: Math.round(performance.now() - started),
    timeoutMs,
    stdout: String(result.stdout ?? "").trim().slice(0, outputLimit),
    stderr: String(result.stderr ?? "").trim().slice(0, outputLimit),
  };
}

export function assertChildOutcome(receipt, expectedStatus, label) {
  if (receipt.timedOut || receipt.error || receipt.status !== expectedStatus) {
    throw new Error(
      "Child lifecycle unexpected for " + label + ": " + JSON.stringify(receipt)
    );
  }
}
