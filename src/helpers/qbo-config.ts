/**
 * Runtime configuration for QBO environment selection and write safety.
 *
 * Every value is read from the environment on each call (not cached at import)
 * so that a misconfiguration is reported where it matters and tests can vary it.
 */

export type QboEnvironment = "sandbox" | "production";

const BASE_URLS: Record<QboEnvironment, string> = {
  sandbox: "https://sandbox-quickbooks.api.intuit.com",
  production: "https://quickbooks.api.intuit.com",
};

/** Minor version sent on every raw REST call made by this server. */
export const QBO_MINOR_VERSION = "75";

function parseEnvironment(name: string, raw: string): QboEnvironment {
  const value = raw.trim().toLowerCase();
  if (value !== "sandbox" && value !== "production") {
    throw new Error(`${name} must be "sandbox" or "production", got "${raw}"`);
  }
  return value;
}

/**
 * QBO_ENVIRONMENT is the canonical setting. QUICKBOOKS_ENVIRONMENT is still
 * honoured because existing deployments set it; if both are set they must agree.
 * Defaults to sandbox.
 */
export function getQboEnvironment(): QboEnvironment {
  const primary = process.env.QBO_ENVIRONMENT;
  const legacy = process.env.QUICKBOOKS_ENVIRONMENT;
  const fromPrimary = primary ? parseEnvironment("QBO_ENVIRONMENT", primary) : undefined;
  const fromLegacy = legacy ? parseEnvironment("QUICKBOOKS_ENVIRONMENT", legacy) : undefined;
  if (fromPrimary && fromLegacy && fromPrimary !== fromLegacy) {
    throw new Error(
      `QBO_ENVIRONMENT (${fromPrimary}) and QUICKBOOKS_ENVIRONMENT (${fromLegacy}) disagree`
    );
  }
  return fromPrimary ?? fromLegacy ?? "sandbox";
}

export function getQboBaseUrl(): string {
  return BASE_URLS[getQboEnvironment()];
}

function isTrue(name: string): boolean {
  return (process.env[name] ?? "").trim().toLowerCase() === "true";
}

/** Master switch for every write tool. Defaults to false (all writes are dry runs). */
export function isWriteEnabled(): boolean {
  return isTrue("QBO_WRITE_ENABLED");
}

/** Second switch required for sales receipt create/void against production. */
export function isProductionWriteConfirmed(): boolean {
  return isTrue("QBO_PRODUCTION_WRITES_CONFIRMED");
}

/**
 * Item IDs allowed to carry a negative line amount on a sales receipt
 * (the merchant/platform fees item). Comma separated, e.g. "25".
 */
export function getAllowedNegativeItemIds(): string[] {
  return (process.env.QBO_ALLOWED_NEGATIVE_ITEM_IDS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}
