import { voidQuickbooksSalesReceipt } from "../handlers/void-quickbooks-sales-receipt.handler.js";
import { ToolDefinition } from "../types/tool-definition.js";
import { z } from "zod";

const toolName = "void_sales_receipt";
const toolDescription =
  "Void a QuickBooks Online sales receipt (amounts go to zero, the record and audit trail stay). " +
  "Fetches the current SyncToken first and appends the reason to PrivateNote. Voiding an already " +
  "voided receipt returns status \"already_voided\". Requires QBO_WRITE_ENABLED=true on the server " +
  "(and QBO_PRODUCTION_WRITES_CONFIRMED=true in production); otherwise returns the payload as a dry run.";

const toolSchema = z.object({
  id: z.string().min(1).describe("The QBO Sales Receipt ID"),
  reason: z.string().min(1).max(500).describe("Why the receipt is voided; appended to PrivateNote"),
});

const toolHandler = async ({ params }: any) => {
  const response = await voidQuickbooksSalesReceipt(params);
  if (response.isError) {
    return { isError: true, content: [{ type: "text" as const, text: `Error voiding sales receipt: ${response.error}` }] };
  }
  return { content: [{ type: "text" as const, text: JSON.stringify(response.result, null, 2) }] };
};

export const VoidSalesReceiptTool: ToolDefinition<typeof toolSchema> = {
  name: toolName,
  description: toolDescription,
  schema: toolSchema,
  handler: toolHandler,
};
