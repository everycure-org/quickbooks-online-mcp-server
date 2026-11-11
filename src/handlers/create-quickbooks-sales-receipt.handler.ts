import { ToolResponse } from "../types/tool-response.js";
import { formatError } from "../helpers/format-error.js";
import { getAllowedNegativeItemIds } from "../helpers/qbo-config.js";
import { escapeQueryValue, qboQuery, qboRead, qboRequest } from "../helpers/qbo-rest.js";
import { auditEnvironment, auditErrorTag, decideWrite, logWrite } from "../helpers/write-guard.js";

const TOOL = "create_sales_receipt";

export interface SalesReceiptLineInput {
  item_id: string;
  class_id: string;
  amount: number;
  description?: string;
}

export interface CreateSalesReceiptInput {
  idempotency_key: string;
  doc_number: string;
  txn_date: string;
  customer_id: string;
  deposit_to_account_id: string;
  department_id: string;
  private_note: string;
  lines: SalesReceiptLineInput[];
  dry_run?: boolean;
}

export interface CreateSalesReceiptResult {
  status: "created" | "already_exists" | "dry_run";
  id: string | null;
  doc_number: string;
  total_amt: number;
  txn_date: string;
  payload: Record<string, any>;
  environment: string;
  /** Present when a real write was requested but configuration forced a dry run. */
  dry_run_reason?: string;
  /** The receipt as stored in QBO (created or already existing). */
  sales_receipt?: Record<string, any>;
}

/** Thrown for input that fails business validation; nothing is written. */
export class SalesReceiptValidationError extends Error {
  constructor(readonly problems: string[]) {
    super(`Sales receipt validation failed: ${problems.join("; ")}`);
    this.name = "SalesReceiptValidationError";
  }
}

const toCents = (amount: number) => Math.round(amount * 100);
const hasAtMostTwoDecimals = (amount: number) => Math.abs(amount * 100 - toCents(amount)) < 1e-6;

export function buildSalesReceiptPayload(input: CreateSalesReceiptInput): Record<string, any> {
  return {
    DocNumber: input.doc_number,
    TxnDate: input.txn_date,
    CustomerRef: { value: input.customer_id },
    DepositToAccountRef: { value: input.deposit_to_account_id },
    DepartmentRef: { value: input.department_id },
    PrivateNote: input.private_note,
    Line: input.lines.map((line) => ({
      DetailType: "SalesItemLineDetail",
      Amount: line.amount,
      ...(line.description ? { Description: line.description } : {}),
      SalesItemLineDetail: {
        ItemRef: { value: line.item_id },
        ClassRef: { value: line.class_id },
        Qty: 1,
        UnitPrice: line.amount,
      },
    })),
  };
}

/** Pure checks that need no QBO calls. Returns the net total in dollars. */
export function validateSalesReceiptLines(lines: SalesReceiptLineInput[]): number {
  const problems: string[] = [];
  const allowedNegative = new Set(getAllowedNegativeItemIds());

  lines.forEach((line, i) => {
    if (!Number.isFinite(line.amount)) problems.push(`lines[${i}].amount must be a finite number`);
    else if (!hasAtMostTwoDecimals(line.amount)) problems.push(`lines[${i}].amount ${line.amount} has more than 2 decimal places`);
    if (line.amount === 0) problems.push(`lines[${i}].amount must not be 0`);
  });

  const negative = lines
    .map((line, i) => ({ line, i }))
    .filter(({ line }) => line.amount < 0);
  if (negative.length > 1) problems.push(`at most one negative line is allowed, got ${negative.length}`);
  for (const { line, i } of negative) {
    if (!allowedNegative.has(line.item_id)) {
      problems.push(
        `lines[${i}] is negative but item ${line.item_id} is not in QBO_ALLOWED_NEGATIVE_ITEM_IDS`
      );
    }
  }

  const totalCents = lines.reduce((sum, l) => sum + toCents(l.amount), 0);
  if (totalCents <= 0) problems.push(`total of all lines must be greater than 0, got ${(totalCents / 100).toFixed(2)}`);

  if (problems.length) throw new SalesReceiptValidationError(problems);
  return totalCents / 100;
}

async function checkActive(entity: string, id: string, label: string, problems: string[]) {
  const record = await qboRead(entity, id);
  if (!record) problems.push(`${label} ${id} does not exist`);
  else if (record.Active === false) problems.push(`${label} ${id} is inactive`);
  return record;
}

/** Reference checks against QBO (read-only). */
async function validateReferences(input: CreateSalesReceiptInput): Promise<void> {
  const problems: string[] = [];
  const itemIds = [...new Set(input.lines.map((l) => l.item_id))];
  const classIds = [...new Set(input.lines.map((l) => l.class_id))];

  const [prefs, , account] = await Promise.all([
    qboRequest("GET", "preferences"),
    checkActive("Customer", input.customer_id, "customer", problems),
    checkActive("Account", input.deposit_to_account_id, "deposit account", problems),
    checkActive("Department", input.department_id, "department", problems),
    ...itemIds.map((id) => checkActive("Item", id, "item", problems)),
    ...classIds.map((id) => checkActive("Class", id, "class", problems)),
  ]);

  // QBO accepts DepartmentRef/ClassRef when tracking is off and silently drops
  // them, which would post receipts that P&L-by-class/location reports miss.
  const accounting = prefs?.Preferences?.AccountingInfoPrefs ?? {};
  if (accounting.TrackDepartments !== true) {
    problems.push(
      "QBO company setting 'Track locations' is off, so DepartmentRef would be dropped; turn it on (Account and settings > Advanced > Categories)"
    );
  }
  if (accounting.ClassTrackingPerTxnLine !== true) {
    problems.push(
      "QBO company setting 'Track classes' must be on and assigned 'One to each row', otherwise line ClassRef is dropped (Account and settings > Advanced > Categories)"
    );
  }

  if (account && account.AccountSubType !== "UndepositedFunds") {
    problems.push(
      `deposit account ${input.deposit_to_account_id} has AccountSubType ${account.AccountSubType}; only UndepositedFunds is allowed`
    );
  }
  if (problems.length) throw new SalesReceiptValidationError(problems);
}

export async function findSalesReceiptByDocNumber(docNumber: string): Promise<Record<string, any> | null> {
  const rows = await qboQuery(
    "SalesReceipt",
    `select * from SalesReceipt where DocNumber = '${escapeQueryValue(docNumber)}'`
  );
  return rows[0] ?? null;
}

export async function createQuickbooksSalesReceipt(
  input: CreateSalesReceiptInput
): Promise<ToolResponse<CreateSalesReceiptResult>> {
  const audit = { tool: TOOL, idempotency_key: input.idempotency_key, doc_number: input.doc_number };
  try {
    const decision = decideWrite(TOOL, input.dry_run ?? true, { requireProductionConfirmation: true });
    const totalAmt = validateSalesReceiptLines(input.lines);
    const payload = buildSalesReceiptPayload(input);

    const existing = await findSalesReceiptByDocNumber(input.doc_number);
    if (existing) {
      logWrite({ ...audit, environment: decision.environment, qbo_id: existing.Id, result: "already_exists" });
      return {
        result: {
          status: "already_exists",
          id: existing.Id,
          doc_number: existing.DocNumber,
          total_amt: existing.TotalAmt,
          txn_date: existing.TxnDate,
          payload,
          environment: decision.environment,
          sales_receipt: existing,
        },
        isError: false,
        error: null,
      };
    }

    await validateReferences(input);

    if (decision.dryRun) {
      logWrite({ ...audit, environment: decision.environment, qbo_id: null, result: "dry_run" });
      return {
        result: {
          status: "dry_run",
          id: null,
          doc_number: input.doc_number,
          total_amt: totalAmt,
          txn_date: input.txn_date,
          payload,
          environment: decision.environment,
          ...(decision.forcedReason ? { dry_run_reason: decision.forcedReason } : {}),
        },
        isError: false,
        error: null,
      };
    }

    const res = await qboRequest("POST", "salesreceipt", {
      query: { requestid: input.idempotency_key },
      body: payload,
    });
    const created = res.SalesReceipt;
    logWrite({ ...audit, environment: decision.environment, qbo_id: created?.Id, result: "created" });
    return {
      result: {
        status: "created",
        id: created.Id,
        doc_number: created.DocNumber,
        total_amt: created.TotalAmt,
        txn_date: created.TxnDate,
        payload,
        environment: decision.environment,
        sales_receipt: created,
      },
      isError: false,
      error: null,
    };
  } catch (error) {
    logWrite({ ...audit, environment: auditEnvironment(), qbo_id: null, result: "error", error: auditErrorTag(error) });
    return { result: null, isError: true, error: formatError(error) };
  }
}
