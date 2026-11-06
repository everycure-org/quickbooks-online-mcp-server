import { ToolResponse } from "../types/tool-response.js";
import { formatError } from "../helpers/format-error.js";
import { escapeQueryValue, qboQuery, qboRead, qboRequest } from "../helpers/qbo-rest.js";
import { auditEnvironment, auditErrorTag, decideWrite, logWrite } from "../helpers/write-guard.js";

const TOOL = "create_customer";

export interface CreateCustomerInput {
  display_name: string;
  company_name?: string;
  parent_id?: string;
  dry_run?: boolean;
}

export interface CreateCustomerResult {
  status: "created" | "already_exists" | "dry_run";
  id: string | null;
  payload: Record<string, any>;
  environment: string;
  dry_run_reason?: string;
  customer?: Record<string, any>;
}

export function buildCustomerPayload(input: CreateCustomerInput): Record<string, any> {
  return {
    DisplayName: input.display_name,
    ...(input.company_name ? { CompanyName: input.company_name } : {}),
    ...(input.parent_id
      ? { ParentRef: { value: input.parent_id }, Job: true, BillWithParent: true }
      : {}),
  };
}

export async function findCustomerByDisplayName(displayName: string): Promise<Record<string, any> | null> {
  // DisplayName is unique across active and inactive customers, so search both.
  const rows = await qboQuery(
    "Customer",
    `select * from Customer where DisplayName = '${escapeQueryValue(displayName)}' and Active in (true, false)`
  );
  return rows[0] ?? null;
}

export async function createQuickbooksCustomer(
  input: CreateCustomerInput
): Promise<ToolResponse<CreateCustomerResult>> {
  try {
    const decision = decideWrite(TOOL, input.dry_run ?? true, { requireProductionConfirmation: false });
    const payload = buildCustomerPayload(input);

    const existing = await findCustomerByDisplayName(input.display_name);
    if (existing) {
      logWrite({ tool: TOOL, environment: decision.environment, qbo_id: existing.Id, result: "already_exists" });
      return {
        result: { status: "already_exists", id: existing.Id, payload, environment: decision.environment, customer: existing },
        isError: false,
        error: null,
      };
    }

    if (input.parent_id) {
      const parent = await qboRead("Customer", input.parent_id);
      if (!parent) throw new Error(`parent customer ${input.parent_id} does not exist`);
      if (parent.Active === false) throw new Error(`parent customer ${input.parent_id} is inactive`);
    }

    if (decision.dryRun) {
      logWrite({ tool: TOOL, environment: decision.environment, qbo_id: null, result: "dry_run" });
      return {
        result: {
          status: "dry_run",
          id: null,
          payload,
          environment: decision.environment,
          ...(decision.forcedReason ? { dry_run_reason: decision.forcedReason } : {}),
        },
        isError: false,
        error: null,
      };
    }

    const res = await qboRequest("POST", "customer", { body: payload });
    logWrite({ tool: TOOL, environment: decision.environment, qbo_id: res.Customer?.Id, result: "created" });
    return {
      result: { status: "created", id: res.Customer.Id, payload, environment: decision.environment, customer: res.Customer },
      isError: false,
      error: null,
    };
  } catch (error) {
    logWrite({ tool: TOOL, environment: auditEnvironment(), qbo_id: null, result: "error", error: auditErrorTag(error) });
    return { result: null, isError: true, error: formatError(error) };
  }
}
