import { deleteQuickbooksEstimate } from "../handlers/delete-quickbooks-estimate.handler.js";
import { ToolDefinition } from "../types/tool-definition.js";
import { z } from "zod";

const toolName = "delete_estimate";
const toolDescription = "Delete (void) an estimate in QuickBooks Online.";
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
  const response = await deleteQuickbooksEstimate(args.params.idOrEntity);
  if (response.isError) {
    return { content: [{ type: "text" as const, text: `Error deleting estimate: ${response.error}` }] };
  }
  return {
    content: [
      { type: "text" as const, text: `Estimate deleted:` },
      { type: "text" as const, text: JSON.stringify(response.result) },
    ],
  };
};

export const DeleteEstimateTool: ToolDefinition<typeof toolSchema> = {
  name: toolName,
  description: toolDescription,
  schema: toolSchema,
  handler: toolHandler,
}; 