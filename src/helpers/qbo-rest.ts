import { quickbooksClient } from "../clients/quickbooks-client.js";
import { getQboBaseUrl, QBO_MINOR_VERSION } from "./qbo-config.js";

/**
 * Thin raw-REST client for QBO endpoints that node-quickbooks cannot express
 * (requestid idempotency, operation=void, explicit minorversion).
 *
 * Authentication reuses the server's existing token handling
 * (quickbooksClient.authenticate refreshes as needed). Tokens are never
 * included in errors or logs.
 */

export class QboApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly faultCode?: string
  ) {
    super(message);
    this.name = "QboApiError";
  }
}

type QueryParams = Record<string, string | undefined>;

function describeFault(body: any, status: number): { message: string; code?: string } {
  const errors = body?.Fault?.Error;
  if (Array.isArray(errors) && errors.length > 0) {
    const parts = errors.map((e: any) =>
      [e.code ? `[${e.code}]` : "", e.Message, e.Detail].filter(Boolean).join(" ")
    );
    return { message: `QBO ${status}: ${parts.join("; ")}`, code: errors[0]?.code };
  }
  return { message: `QBO request failed with HTTP ${status}` };
}

export async function qboRequest<T = any>(
  method: "GET" | "POST",
  resourcePath: string,
  options: { query?: QueryParams; body?: unknown } = {}
): Promise<T> {
  await quickbooksClient.authenticate();
  const { accessToken, realmId } = quickbooksClient.getAuthCredentials();

  const url = new URL(`${getQboBaseUrl()}/v3/company/${encodeURIComponent(realmId)}/${resourcePath}`);
  for (const [k, v] of Object.entries(options.query ?? {})) {
    if (v !== undefined) url.searchParams.set(k, v);
  }
  url.searchParams.set("minorversion", QBO_MINOR_VERSION);

  const res = await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: "application/json",
      ...(options.body !== undefined ? { "Content-Type": "application/json" } : {}),
    },
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
  });

  const text = await res.text();
  let parsed: any;
  try {
    parsed = text ? JSON.parse(text) : {};
  } catch {
    throw new QboApiError(`QBO returned a non-JSON response (HTTP ${res.status})`, res.status);
  }

  // QBO can return a Fault with HTTP 200 for some batch-ish operations.
  if (!res.ok || parsed?.Fault) {
    const { message, code } = describeFault(parsed, res.status);
    throw new QboApiError(message, res.status, code);
  }
  return parsed as T;
}

/** Escape a value for use inside single quotes in a QBO query. */
export function escapeQueryValue(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}

/** Run a QBO query and return the rows for `entity` (empty array when none). */
export async function qboQuery<T = any>(entity: string, query: string): Promise<T[]> {
  const res = await qboRequest("GET", "query", { query: { query } });
  return (res?.QueryResponse?.[entity] as T[] | undefined) ?? [];
}

/** Read one entity by ID. Returns null when QBO reports it does not exist. */
export async function qboRead<T = any>(entity: string, id: string): Promise<T | null> {
  try {
    const res = await qboRequest("GET", `${entity.toLowerCase()}/${encodeURIComponent(id)}`);
    return (res?.[entity] as T | undefined) ?? null;
  } catch (err) {
    // 610 = Object Not Found
    if (err instanceof QboApiError && err.faultCode === "610") return null;
    throw err;
  }
}
