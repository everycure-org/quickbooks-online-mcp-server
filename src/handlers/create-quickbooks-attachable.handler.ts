import https from "https";
import { quickbooksClient } from "../clients/quickbooks-client.js";
import { ToolResponse } from "../types/tool-response.js";
import { formatError } from "../helpers/format-error.js";

const ALLOWED_UPLOAD_CONTENT_TYPES = new Set([
  "application/pdf",
  "image/png",
  "image/jpeg",
]);

export interface CreateAttachableInput {
  file_name: string;
  note?: string;
  category?: string;
  content_type?: string;
  base64_content?: string;
  attachable_ref?: {
    entity_ref_type: string;
    entity_ref_value: string;
  };
}

function sanitizeFilename(name: string): string {
  return name.replace(/[\r\n"\\]/g, "_");
}

async function uploadAttachableFile(
  fileBuffer: Buffer,
  metadata: Record<string, unknown>,
  accessToken: string,
  realmId: string,
  isSandbox: boolean
): Promise<unknown> {
  const boundary = `----QBOBoundary${Date.now()}`;
  const metadataJson = JSON.stringify(metadata);
  const fileName = sanitizeFilename(metadata.FileName as string);
  const contentType = metadata.ContentType as string;

  const bodyParts: Buffer[] = [
    Buffer.from(
      `--${boundary}\r\n` +
        `Content-Disposition: form-data; name="file_metadata_01"\r\n` +
        `Content-Type: application/json\r\n` +
        `\r\n` +
        `${metadataJson}\r\n`
    ),
    Buffer.from(
      `--${boundary}\r\n` +
        `Content-Disposition: form-data; name="file_content_01"; filename="${fileName}"\r\n` +
        `Content-Type: ${contentType}\r\n` +
        `\r\n`
    ),
    fileBuffer,
    Buffer.from(`\r\n--${boundary}--\r\n`),
  ];

  const body = Buffer.concat(bodyParts);
  const host = isSandbox
    ? "sandbox-quickbooks.api.intuit.com"
    : "quickbooks.api.intuit.com";
  const path = `/v3/company/${realmId}/upload`;

  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        hostname: host,
        path,
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": `multipart/form-data; boundary=${boundary}`,
          "Content-Length": body.length,
          Accept: "application/json",
        },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (chunk: Buffer) => chunks.push(chunk));
        res.on("end", () => {
          const responseText = Buffer.concat(chunks).toString("utf-8");
          try {
            const json: unknown = JSON.parse(responseText);
            if (res.statusCode && res.statusCode >= 400) {
              reject(
                new Error(
                  `QBO upload failed (${res.statusCode}): ${responseText}`
                )
              );
            } else {
              resolve(json);
            }
          } catch {
            reject(
              new Error(
                `QBO upload: unexpected response (${res.statusCode}): ${responseText}`
              )
            );
          }
        });
      }
    );
    req.on("error", reject);
    req.write(body);
    req.end();
  });
}

export async function createQuickbooksAttachable(data: CreateAttachableInput): Promise<ToolResponse<any>> {
  try {
    await quickbooksClient.authenticate();

    const payload: Record<string, unknown> = { FileName: data.file_name };
    if (data.note) payload.Note = data.note;
    if (data.category) payload.Category = data.category;
    if (data.content_type) payload.ContentType = data.content_type;
    if (data.attachable_ref) {
      payload.AttachableRef = [
        {
          EntityRef: {
            type: data.attachable_ref.entity_ref_type,
            value: data.attachable_ref.entity_ref_value,
          },
        },
      ];
    }

    if (data.base64_content) {
      const effectiveContentType = data.content_type ?? "application/octet-stream";
      if (!ALLOWED_UPLOAD_CONTENT_TYPES.has(effectiveContentType)) {
        return {
          result: null,
          isError: true,
          error: `Error: Unsupported content_type "${effectiveContentType}" for upload. Allowed types: ${[...ALLOWED_UPLOAD_CONTENT_TYPES].join(", ")}`,
        };
      }
      const { accessToken, realmId, isSandbox } = quickbooksClient.getAuthCredentials();
      const fileBuffer = Buffer.from(data.base64_content, "base64");
      const uploadResult = await uploadAttachableFile(
        fileBuffer,
        payload,
        accessToken,
        realmId,
        isSandbox
      );
      return { result: uploadResult, isError: false, error: null };
    }

    const quickbooks = quickbooksClient.getQuickbooks();
    return new Promise((resolve) => {
      (quickbooks as any).createAttachable(payload, (err: any, created: any) => {
        if (err) resolve({ result: null, isError: true, error: formatError(err) });
        else resolve({ result: created, isError: false, error: null });
      });
    });
  } catch (error) {
    return { result: null, isError: true, error: formatError(error) };
  }
}
