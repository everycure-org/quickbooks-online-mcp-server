import { createQuickbooksCustomer } from "../handlers/create-quickbooks-customer.handler.js";
import { ToolDefinition } from "../types/tool-definition.js";
import { z } from "zod";

const toolName = "create_customer";
const toolDescription =
  "Create a customer (or sub-customer when parent_id is set) in QuickBooks Online, idempotently by " +
  "DisplayName: if a customer with that DisplayName exists it is returned with status \"already_exists\". " +
  "dry_run defaults to true; writes also require QBO_WRITE_ENABLED=true on the server.";

const toolSchema = z.object({
  display_name: z.string().min(1).max(500).describe("Unique customer DisplayName, e.g. \"Chariot - Unrestricted\""),
  company_name: z.string().max(100).optional().describe("CompanyName"),
  parent_id: z
    .string()
    .min(1)
    .optional()
    .describe("Parent customer ID. When set, creates a sub-customer (ParentRef, Job: true, BillWithParent: true)."),
  dry_run: z
    .boolean()
    .optional()
    .default(true)
    .describe("Default true: validate and return the payload without writing to QBO"),
});

const toolHandler = async ({ params }: any) => {
  const response = await createQuickbooksCustomer(params);
  if (response.isError) {
    return { isError: true, content: [{ type: "text" as const, text: `Error creating customer: ${response.error}` }] };
  }
  return { content: [{ type: "text" as const, text: JSON.stringify(response.result, null, 2) }] };
};

export const CreateCustomerTool: ToolDefinition<typeof toolSchema> = {
  name: toolName,
  description: toolDescription,
  schema: toolSchema,
  handler: toolHandler,
};
