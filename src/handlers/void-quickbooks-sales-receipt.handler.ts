import { ToolResponse } from "../types/tool-response.js";
import { formatError } from "../helpers/format-error.js";
import { qboRead, qboRequest } from "../helpers/qbo-rest.js";
import { auditEnvironment, auditErrorTag, decideWrite, logWrite } from "../helpers/write-guard.js";

const TOOL = "void_sales_receipt";
const PRIVATE_NOTE_MAX = 4000;
/** Marker appended to PrivateNote so a second void is recognised and skipped. */
export const VOID_MARKER = "[VOIDED by MCP]";

export interface VoidSalesReceiptInput {
  id: string;
  reason: string;
}

export interface VoidSalesReceiptResult {
  status: "voided" | "already_voided" | "dry_run";
  id: string;
  doc_number?: string;
  environment: string;
  payload: Record<string, any>;
  dry_run_reason?: string;
  sales_receipt?: Record<string, any>;
}

export function buildVoidPayload(current: Record<string, any>, reason: string): Record<string, any> {
  const note = [current.PrivateNote, `${VOID_MARKER} ${reason}`].filter(Boolean).join(" | ");
  if (note.length > PRIVATE_NOTE_MAX) {
    throw new Error(
      `PrivateNote would be ${note.length} characters after appending the reason (max ${PRIVATE_NOTE_MAX}); shorten the reason`
    );
  }
  return { Id: current.Id, SyncToken: current.SyncToken, sparse: true, PrivateNote: note };
}

export async function voidQuickbooksSalesReceipt(
  input: VoidSalesReceiptInput
): Promise<ToolResponse<VoidSalesReceiptResult>> {
  const audit = { tool: TOOL, qbo_id: input.id };
  try {
    // Void is never a dry run by request; only configuration can force one.
    const decision = decideWrite(TOOL, false, { requireProductionConfirmation: true });

    const current = await qboRead("SalesReceipt", input.id);
    if (!current) throw new Error(`Sales receipt ${input.id} does not exist`);

    const base = { id: current.Id, doc_number: current.DocNumber, environment: decision.environment };
    if (typeof current.PrivateNote === "string" && current.PrivateNote.includes(VOID_MARKER)) {
      logWrite({ ...audit, doc_number: current.DocNumber, environment: decision.environment, result: "already_voided" });
      return {
        result: { status: "already_voided", ...base, payload: {}, sales_receipt: current },
        isError: false,
        error: null,
      };
    }

    const payload = buildVoidPayload(current, input.reason);

    if (decision.dryRun) {
      logWrite({ ...audit, doc_number: current.DocNumber, environment: decision.environment, result: "dry_run" });
      return {
        result: {
          status: "dry_run",
          ...base,
          payload,
          // Void never requests a dry run itself, so a dry run is always config-forced.
          dry_run_reason: decision.forcedReason,
        },
        isError: false,
        error: null,
      };
    }

    // For SalesReceipt, `operation=void` voids a QuickBooks Payments card charge
    // and fails on receipts without one. Voiding the receipt itself is a sparse
    // update with include=void.
    const res = await qboRequest("POST", "salesreceipt", {
      query: { operation: "update", include: "void" },
      body: payload,
    });
    logWrite({ ...audit, doc_number: current.DocNumber, environment: decision.environment, result: "voided" });
    return {
      result: { status: "voided", ...base, payload, sales_receipt: res.SalesReceipt },
      isError: false,
      error: null,
    };
  } catch (error) {
    logWrite({ ...audit, environment: auditEnvironment(), result: "error", error: auditErrorTag(error) });
    return { result: null, isError: true, error: formatError(error) };
  }
}
