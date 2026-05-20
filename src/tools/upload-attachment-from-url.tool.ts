import { uploadAttachmentFromUrl } from "../handlers/upload-attachment-from-url.handler.js";
import { ToolDefinition } from "../types/tool-definition.js";
import { z } from "zod";

const toolName = "upload_attachment_from_url";
const toolDescription =
  "Download a file from a public URL and upload it as an attachment to QuickBooks Online. " +
  "Supported file types: PDF, PNG, JPEG (detected automatically from the response Content-Type). " +
  "Optionally attach the uploaded file to a QuickBooks entity (e.g. Bill, Invoice, Purchase) by providing attachable_ref. " +
  "Returns the QuickBooks Attachable object including its Id, which can be used with update_attachable to link it to additional entities.";

const toolSchema = z.object({
  file_url: z
    .string()
    .url()
    .describe(
      "Public URL of the file to download and upload. Must be accessible without authentication. Only http and https URLs are supported."
    ),
  file_name: z
    .string()
    .optional()
    .describe(
      "Override the file name stored in QuickBooks. Defaults to the last path segment of the URL."
    ),
  content_type: z
    .enum(["application/pdf", "image/png", "image/jpeg"])
    .optional()
    .describe(
      "Override the MIME type. Required when the URL serves the file as application/octet-stream (common with S3/GCS presigned URLs). Inferred from the HTTP Content-Type header otherwise."
    ),
  note: z.string().optional().describe("Optional note about the attachment"),
  category: z.string().optional().describe("Optional attachment category"),
  attachable_ref: z
    .object({
      entity_ref_type: z
        .string()
        .describe("QuickBooks entity type to attach to (e.g. 'Bill', 'Invoice', 'Purchase')"),
      entity_ref_value: z
        .string()
        .describe("Id of the QuickBooks entity to attach to"),
    })
    .optional()
    .describe(
      "Optionally link the uploaded attachment to a QuickBooks entity immediately after upload"
    ),
});

const toolHandler = async ({ params }: any) => {
  const response = await uploadAttachmentFromUrl(params);
  if (response.isError) {
    return { content: [{ type: "text" as const, text: `Error: ${response.error}` }] };
  }
  return {
    content: [
      { type: "text" as const, text: "Attachment uploaded successfully:" },
      { type: "text" as const, text: JSON.stringify(response.result, null, 2) },
    ],
  };
};

export const UploadAttachmentFromUrlTool: ToolDefinition<typeof toolSchema> = {
  name: toolName,
  description: toolDescription,
  schema: toolSchema,
  handler: toolHandler,
};
