import { deleteQuickbooksPayment } from "../handlers/delete-quickbooks-payment.handler.js";
import { ToolDefinition } from "../types/tool-definition.js";
import { z } from "zod";

const toolName = "delete_payment";
const toolDescription = "Delete (void) a payment in QuickBooks Online.";
const toolSchema = z.object({ idOrEntity: z
    .union([
      z.string().min(1).describe("Entity ID"),
      z
        .object({ Id: z.string().min(1), SyncToken: z.string() })
        .passthrough()
        .describe("Entity object with at least Id and SyncToken"),
    ])
    .describe("Entity ID, or the entity object with Id and SyncToken") });

const toolHandler = async (args: any) => {
  const response = await deleteQuickbooksPayment(args.params.idOrEntity);

  if (response.isError) {
    return { content: [{ type: "text" as const, text: `Error deleting payment: ${response.error}` }] };
  }

  return {
    content: [
      { type: "text" as const, text: `Payment deleted:` },
      { type: "text" as const, text: JSON.stringify(response.result) },
    ],
  };
};

export const DeletePaymentTool: ToolDefinition<typeof toolSchema> = {
  name: toolName,
  description: toolDescription,
  schema: toolSchema,
  handler: toolHandler,
};
