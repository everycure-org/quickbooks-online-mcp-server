import {
  getQboEnvironment,
  isProductionWriteConfirmed,
  isWriteEnabled,
  QboEnvironment,
} from "./qbo-config.js";

export interface WriteDecision {
  /** True when the tool must not write and should return its payload instead. */
  dryRun: boolean;
  environment: QboEnvironment;
  /** Set when the caller asked for a real write but configuration forced a dry run. */
  forcedReason?: string;
}

/**
 * Decide whether a write tool may actually write.
 *
 * - QBO_WRITE_ENABLED=false (the default) forces a dry run regardless of input.
 * - In production, tools that pass `requireProductionConfirmation` also need
 *   QBO_PRODUCTION_WRITES_CONFIRMED=true; otherwise the call is refused.
 */
export function decideWrite(
  tool: string,
  requestedDryRun: boolean,
  opts: { requireProductionConfirmation: boolean }
): WriteDecision {
  const environment = getQboEnvironment();
  if (requestedDryRun) return { dryRun: true, environment };

  if (!isWriteEnabled()) {
    const forcedReason = "QBO_WRITE_ENABLED is not true; treated as dry run";
    console.error(`[qbo-write] WARNING ${tool}: ${forcedReason}`);
    return { dryRun: true, environment, forcedReason };
  }

  if (environment === "production" && opts.requireProductionConfirmation && !isProductionWriteConfirmed()) {
    throw new Error(
      `${tool} refused: production writes require QBO_PRODUCTION_WRITES_CONFIRMED=true`
    );
  }
  return { dryRun: false, environment };
}

/** Environment for audit lines; never throws (a bad config is reported by decideWrite). */
export function auditEnvironment(): QboEnvironment | "unknown" {
  try {
    return getQboEnvironment();
  } catch {
    return "unknown";
  }
}

/** Identifier-only error tag for audit lines (QBO fault text can echo names). */
export function auditErrorTag(err: unknown): string {
  const e = err as { name?: string; status?: number; faultCode?: string };
  if (e?.name === "QboApiError") return `qbo_${e.status}${e.faultCode ? `_${e.faultCode}` : ""}`;
  return e?.name ?? "error";
}

export interface WriteAuditEntry {
  tool: string;
  environment: QboEnvironment | "unknown";
  result: string;
  idempotency_key?: string;
  doc_number?: string;
  qbo_id?: string | null;
  error?: string;
}

/**
 * Structured audit line for every write-tool outcome. Callers must only pass
 * identifiers: never donor names, emails, addresses, memo text or tokens.
 */
export function logWrite(entry: WriteAuditEntry): void {
  console.error(`[qbo-write] ${JSON.stringify({ ts: new Date().toISOString(), ...entry })}`);
}
