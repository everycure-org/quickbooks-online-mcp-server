import { createQuickbooksSalesReceipt } from "../handlers/create-quickbooks-sales-receipt.handler.js";
import { ToolDefinition } from "../types/tool-definition.js";
import { z } from "zod";

const toolName = "create_sales_receipt";
const toolDescription =
  "Create a sales receipt in QuickBooks Online for a donation, idempotently. " +
  "Validates totals, decimals, the single allowed negative fee line, that every referenced " +
  "customer/account/department/item/class exists and is active, and that the deposit account is " +
  "Undeposited Funds. If a receipt with the same doc_number already exists it is returned with " +
  "status \"already_exists\" instead of creating a duplicate. dry_run defaults to true; writes also " +
  "require QBO_WRITE_ENABLED=true on the server (and QBO_PRODUCTION_WRITES_CONFIRMED=true in production).";

const lineSchema = z.object({
  item_id: z.string().min(1).describe("QBO Item ID (SalesItemLineDetail.ItemRef)"),
  class_id: z.string().min(1).describe("QBO Class ID (SalesItemLineDetail.ClassRef), e.g. Fundraising"),
  amount: z
    .number()
    .describe("Line amount in dollars, at most 2 decimal places. Negative only for the fees item."),
  description: z.string().max(4000).optional().describe("Line description"),
});

const toolSchema = z.object({
  idempotency_key: z
    .string()
    .min(1)
    .max(50)
    .describe("Sent as QBO requestid for duplicate protection. Use the HubSpot Gift record ID."),
  doc_number: z
    .string()
    .min(1)
    .max(21)
    .describe("QBO DocNumber, used to look receipts up. Use the HubSpot Gift record ID."),
  txn_date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "txn_date must be YYYY-MM-DD")
    .describe("Donation date (not deposit date), YYYY-MM-DD"),
  customer_id: z.string().min(1).describe("QBO Customer ID, e.g. the \"Chariot - Unrestricted\" customer"),
  deposit_to_account_id: z
    .string()
    .min(1)
    .describe("QBO Account ID to deposit to. Must have AccountSubType UndepositedFunds (account 1410)."),
  department_id: z.string().min(1).describe("QBO Department ID, e.g. Development"),
  private_note: z
    .string()
    .min(1)
    .max(4000)
    .describe("Memo with IDs only: HubSpot Gift ID, Chariot deposit ID, Chariot donation ID. No donor PII."),
  lines: z.array(lineSchema).min(1).describe("Receipt lines: donation line(s) plus an optional negative fee line"),
  dry_run: z
    .boolean()
    .optional()
    .default(true)
    .describe("Default true: validate and return the exact payload without writing to QBO"),
});

const toolHandler = async ({ params }: any) => {
  const response = await createQuickbooksSalesReceipt(params);
  if (response.isError) {
    return { isError: true, content: [{ type: "text" as const, text: `Error creating sales receipt: ${response.error}` }] };
  }
  return { content: [{ type: "text" as const, text: JSON.stringify(response.result, null, 2) }] };
};

export const CreateSalesReceiptTool: ToolDefinition<typeof toolSchema> = {
  name: toolName,
  description: toolDescription,
  schema: toolSchema,
  handler: toolHandler,
};
