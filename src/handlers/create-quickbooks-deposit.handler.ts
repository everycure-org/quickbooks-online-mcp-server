import { ToolResponse } from "../types/tool-response.js";
import { formatError } from "../helpers/format-error.js";
import { qboRead, qboRequest } from "../helpers/qbo-rest.js";
import { auditEnvironment, auditErrorTag, decideWrite, logWrite } from "../helpers/write-guard.js";
import { findSalesReceiptByDocNumber } from "./create-quickbooks-sales-receipt.handler.js";

const TOOL = "create_deposit";

export interface CreateDepositInput {
  /** Chariot deposit ID. Sent as QBO requestid. */
  idempotency_key: string;
  /** Payout date (YYYY-MM-DD). */
  txn_date: string;
  /** Bank account the payout landed in. */
  deposit_to_account_id: string;
  /** DocNumbers (HubSpot Gift IDs) of the sales receipts in this payout. */
  sales_receipt_doc_numbers: string[];
  /** Payout amount; must equal the sum of the receipts to the cent. */
  expected_total: number;
  /** Memo with IDs only. */
  private_note: string;
  dry_run?: boolean;
}

export interface DepositReceiptSummary {
  id: string;
  doc_number: string;
  amount: number;
}

export interface CreateDepositResult {
  status: "created" | "already_exists" | "dry_run";
  id: string | null;
  total_amt: number;
  txn_date: string;
  deposit_to_account_id: string;
  sales_receipts: DepositReceiptSummary[];
  payload: Record<string, any>;
  environment: string;
  dry_run_reason?: string;
  deposit?: Record<string, any>;
}

/** Thrown for input that fails validation; nothing is written. */
export class DepositValidationError extends Error {
  constructor(readonly problems: string[]) {
    super(`Deposit validation failed: ${problems.join("; ")}`);
    this.name = "DepositValidationError";
  }
}

const toCents = (amount: number) => Math.round(amount * 100);

/** IDs of deposits a sales receipt is already linked to. */
export function depositIdsOf(receipt: Record<string, any>): string[] {
  return (receipt.LinkedTxn ?? [])
    .filter((t: any) => t.TxnType === "Deposit")
    .map((t: any) => String(t.TxnId));
}

export function buildDepositPayload(
  input: Pick<CreateDepositInput, "txn_date" | "deposit_to_account_id" | "private_note">,
  receipts: DepositReceiptSummary[]
): Record<string, any> {
  return {
    TxnDate: input.txn_date,
    DepositToAccountRef: { value: input.deposit_to_account_id },
    PrivateNote: input.private_note,
    Line: receipts.map((r) => ({
      Amount: r.amount,
      LinkedTxn: [{ TxnId: r.id, TxnType: "SalesReceipt", TxnLineId: "0" }],
    })),
  };
}

/** Linked SalesReceipt IDs on an existing deposit. */
function linkedReceiptIds(deposit: Record<string, any>): string[] {
  return (deposit.Line ?? []).flatMap((l: any) =>
    (l.LinkedTxn ?? []).filter((t: any) => t.TxnType === "SalesReceipt").map((t: any) => String(t.TxnId))
  );
}

interface Resolved {
  receipts: Record<string, any>[];
  summaries: DepositReceiptSummary[];
  /** Set when every receipt already sits in this one deposit. */
  existingDepositId?: string;
}

/** Look up and check every receipt and the target account (read-only). */
async function resolveAndValidate(input: CreateDepositInput): Promise<Resolved> {
  const problems: string[] = [];

  const docNumbers = input.sales_receipt_doc_numbers;
  const duplicates = docNumbers.filter((d, i) => docNumbers.indexOf(d) !== i);
  if (duplicates.length) problems.push(`duplicate doc numbers: ${[...new Set(duplicates)].join(", ")}`);
  if (!Number.isFinite(input.expected_total) || input.expected_total <= 0) {
    problems.push("expected_total must be greater than 0");
  } else if (Math.abs(input.expected_total * 100 - toCents(input.expected_total)) >= 1e-6) {
    problems.push(`expected_total ${input.expected_total} has more than 2 decimal places`);
  }
  if (problems.length) throw new DepositValidationError(problems);

  const [account, ...found] = await Promise.all([
    qboRead("Account", input.deposit_to_account_id),
    ...docNumbers.map((d) => findSalesReceiptByDocNumber(d)),
  ]);

  if (!account) problems.push(`deposit account ${input.deposit_to_account_id} does not exist`);
  else {
    if (account.Active === false) problems.push(`deposit account ${input.deposit_to_account_id} is inactive`);
    if (account.AccountType !== "Bank") {
      problems.push(
        `deposit account ${input.deposit_to_account_id} has AccountType ${account.AccountType}; only Bank accounts are allowed`
      );
    }
  }

  const receipts: Record<string, any>[] = [];
  const depositsSeen = new Set<string>();
  let undeposited = 0;
  found.forEach((r, i) => {
    const doc = docNumbers[i];
    if (!r) {
      problems.push(`sales receipt ${doc} does not exist`);
      return;
    }
    receipts.push(r);
    if (typeof r.PrivateNote === "string" && /^Voided\b/.test(r.PrivateNote)) problems.push(`sales receipt ${doc} is voided`);
    else if (!(r.TotalAmt > 0)) problems.push(`sales receipt ${doc} has a total of ${r.TotalAmt}`);
    const linked = depositIdsOf(r);
    if (linked.length) linked.forEach((id) => depositsSeen.add(id));
    else undeposited++;
  });

  // Accounts the receipts were posted to must be Undeposited Funds.
  const sourceAccountIds = [...new Set(receipts.map((r) => r.DepositToAccountRef?.value).filter(Boolean))] as string[];
  const sourceAccounts = await Promise.all(sourceAccountIds.map((id) => qboRead("Account", id)));
  sourceAccountIds.forEach((id, i) => {
    if (sourceAccounts[i]?.AccountSubType !== "UndepositedFunds") {
      const docs = receipts.filter((r) => r.DepositToAccountRef?.value === id).map((r) => r.DocNumber);
      problems.push(`sales receipts ${docs.join(", ")} were not posted to Undeposited Funds (account ${id})`);
    }
  });
  receipts
    .filter((r) => !r.DepositToAccountRef?.value)
    .forEach((r) => problems.push(`sales receipt ${r.DocNumber} has no deposit account`));

  const summaries = receipts.map((r) => ({ id: String(r.Id), doc_number: String(r.DocNumber), amount: Number(r.TotalAmt) }));
  const sumCents = summaries.reduce((s, r) => s + toCents(r.amount), 0);

  // Idempotency: a receipt can only be in one deposit.
  let existingDepositId: string | undefined;
  if (depositsSeen.size > 0) {
    if (depositsSeen.size === 1 && undeposited === 0 && receipts.length === docNumbers.length) {
      existingDepositId = [...depositsSeen][0];
    } else {
      const inDeposits = receipts
        .filter((r) => depositIdsOf(r).length)
        .map((r) => `${r.DocNumber} (deposit ${depositIdsOf(r).join(", ")})`);
      problems.push(`some sales receipts are already in a deposit: ${inDeposits.join("; ")}`);
    }
  }

  if (!existingDepositId && problems.length === 0 && sumCents !== toCents(input.expected_total)) {
    problems.push(
      `sales receipts total ${(sumCents / 100).toFixed(2)} but expected_total is ${input.expected_total.toFixed(2)}`
    );
  }
  if (problems.length) throw new DepositValidationError(problems);
  return { receipts, summaries, existingDepositId };
}

export async function createQuickbooksDeposit(
  input: CreateDepositInput
): Promise<ToolResponse<CreateDepositResult>> {
  const audit = { tool: TOOL, idempotency_key: input.idempotency_key };
  try {
    const decision = decideWrite(TOOL, input.dry_run ?? true, { requireProductionConfirmation: true });
    const { summaries, existingDepositId } = await resolveAndValidate(input);
    const payload = buildDepositPayload(input, summaries);
    const base = {
      txn_date: input.txn_date,
      deposit_to_account_id: input.deposit_to_account_id,
      sales_receipts: summaries,
      payload,
      environment: decision.environment,
    };

    if (existingDepositId) {
      const existing = await qboRead("Deposit", existingDepositId);
      if (!existing) throw new Error(`sales receipts link to deposit ${existingDepositId}, which could not be read`);
      const existingSet = new Set(linkedReceiptIds(existing));
      const sameSet =
        existingSet.size === summaries.length && summaries.every((r) => existingSet.has(r.id));
      if (!sameSet) {
        throw new DepositValidationError([
          `the sales receipts are in deposit ${existingDepositId}, which links a different set of receipts`,
        ]);
      }
      logWrite({ ...audit, environment: decision.environment, qbo_id: existing.Id, result: "already_exists" });
      return {
        result: {
          status: "already_exists",
          id: existing.Id,
          ...base,
          total_amt: existing.TotalAmt,
          txn_date: existing.TxnDate,
          deposit_to_account_id: existing.DepositToAccountRef?.value,
          deposit: existing,
        },
        isError: false,
        error: null,
      };
    }

    if (decision.dryRun) {
      logWrite({ ...audit, environment: decision.environment, qbo_id: null, result: "dry_run" });
      return {
        result: {
          status: "dry_run",
          id: null,
          ...base,
          total_amt: input.expected_total,
          ...(decision.forcedReason ? { dry_run_reason: decision.forcedReason } : {}),
        },
        isError: false,
        error: null,
      };
    }

    const res = await qboRequest("POST", "deposit", {
      query: { requestid: input.idempotency_key },
      body: payload,
    });
    const created = res.Deposit;
    logWrite({ ...audit, environment: decision.environment, qbo_id: created?.Id, result: "created" });
    return {
      result: {
        status: "created",
        id: created.Id,
        ...base,
        total_amt: created.TotalAmt,
        txn_date: created.TxnDate,
        deposit: created,
      },
      isError: false,
      error: null,
    };
  } catch (error) {
    logWrite({ ...audit, environment: auditEnvironment(), qbo_id: null, result: "error", error: auditErrorTag(error) });
    return { result: null, isError: true, error: formatError(error) };
  }
}
