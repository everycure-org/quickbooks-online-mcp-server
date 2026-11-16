import { createQuickbooksDeposit } from "../handlers/create-quickbooks-deposit.handler.js";
import { ToolDefinition } from "../types/tool-definition.js";
import { z } from "zod";

const toolName = "create_deposit";
const toolDescription =
  "Create a QuickBooks Online bank deposit for one Chariot payout, idempotently. It links the payout's " +
  "sales receipts (by DocNumber, i.e. HubSpot Gift ID) so they move out of Undeposited Funds into the " +
  "bank account. Before writing it checks that every receipt exists, is not voided, was posted to " +
  "Undeposited Funds and is not in another deposit, that the target is an active Bank account, and that " +
  "the receipts total exactly expected_total. If all the receipts are already in one deposit, that " +
  "deposit is returned with status \"already_exists\". dry_run defaults to true; writes also require " +
  "QBO_WRITE_ENABLED=true on the server (and QBO_PRODUCTION_WRITES_CONFIRMED=true in production).";

const toolSchema = z.object({
  idempotency_key: z
    .string()
    .min(1)
    .max(50)
    .describe("Sent as QBO requestid for duplicate protection. Use the Chariot deposit ID."),
  txn_date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "txn_date must be YYYY-MM-DD")
    .describe("Payout (deposit) date, YYYY-MM-DD"),
  deposit_to_account_id: z
    .string()
    .min(1)
    .describe("QBO Account ID of the bank account the payout landed in. Must be an active Bank account."),
  sales_receipt_doc_numbers: z
    .array(z.string().min(1).max(21))
    .min(1)
    .describe("DocNumbers (HubSpot Gift IDs) of every sales receipt in this payout"),
  expected_total: z
    .number()
    .describe("Payout amount in dollars. Must equal the sum of the receipts' totals to the cent."),
  private_note: z
    .string()
    .min(1)
    .max(4000)
    .describe("Memo with IDs only, e.g. the Chariot deposit ID. No donor PII."),
  dry_run: z
    .boolean()
    .optional()
    .default(true)
    .describe("Default true: validate and return the exact payload without writing to QBO"),
});

const toolHandler = async ({ params }: any) => {
  const response = await createQuickbooksDeposit(params);
  if (response.isError) {
    return { isError: true, content: [{ type: "text" as const, text: `Error creating deposit: ${response.error}` }] };
  }
  return { content: [{ type: "text" as const, text: JSON.stringify(response.result, null, 2) }] };
};

export const CreateDepositTool: ToolDefinition<typeof toolSchema> = {
  name: toolName,
  description: toolDescription,
  schema: toolSchema,
  handler: toolHandler,
};
