import { findQuickbooksSalesReceiptByDocNumber } from "../handlers/find-quickbooks-sales-receipt-by-doc-number.handler.js";
import { ToolDefinition } from "../types/tool-definition.js";
import { z } from "zod";

const toolName = "find_sales_receipt_by_doc_number";
const toolDescription =
  "Find a QuickBooks Online sales receipt by its DocNumber (e.g. a HubSpot Gift record ID). Returns the receipt or null.";

const toolSchema = z.object({
  doc_number: z.string().min(1).max(21).describe("The sales receipt DocNumber to look up"),
});

const toolHandler = async ({ params }: any) => {
  const response = await findQuickbooksSalesReceiptByDocNumber(params.doc_number);
  if (response.isError) {
    return { isError: true, content: [{ type: "text" as const, text: `Error finding sales receipt: ${response.error}` }] };
  }
  return { content: [{ type: "text" as const, text: JSON.stringify(response.result, null, 2) }] };
};

export const FindSalesReceiptByDocNumberTool: ToolDefinition<typeof toolSchema> = {
  name: toolName,
  description: toolDescription,
  schema: toolSchema,
  handler: toolHandler,
};
