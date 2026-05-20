import https from "https";
import http from "http";
import { URL } from "url";
import { quickbooksClient } from "../clients/quickbooks-client.js";
import { ToolResponse } from "../types/tool-response.js";
import { formatError } from "../helpers/format-error.js";

const ALLOWED_UPLOAD_CONTENT_TYPES = new Set([
  "application/pdf",
  "image/png",
  "image/jpeg",
]);

// 20 MB hard cap to prevent memory exhaustion
const MAX_FILE_SIZE_BYTES = 20 * 1024 * 1024;
const DOWNLOAD_TIMEOUT_MS = 30_000;
const MAX_REDIRECTS = 5;

export interface UploadAttachmentFromUrlInput {
  file_url: string;
  file_name?: string;
  note?: string;
  category?: string;
  attachable_ref?: {
    entity_ref_type: string;
    entity_ref_value: string;
  };
}

function sanitizeFilename(name: string): string {
  return name.replace(/[\r\n"\\]/g, "_");
}

function deriveFilenameFromUrl(rawUrl: string): string {
  try {
    const parsed = new URL(rawUrl);
    const segments = parsed.pathname.split("/").filter(Boolean);
    const last = segments[segments.length - 1];
    return last ? decodeURIComponent(last) : "attachment";
  } catch {
    return "attachment";
  }
}

function downloadUrl(
  rawUrl: string,
  redirectsLeft: number
): Promise<{ buffer: Buffer; contentType: string }> {
  return new Promise((resolve, reject) => {
    let parsed: URL;
    try {
      parsed = new URL(rawUrl);
    } catch {
      return reject(new Error(`Invalid URL: ${rawUrl}`));
    }

    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
      return reject(new Error(`URL must use http or https, got: ${parsed.protocol}`));
    }

    const transport = parsed.protocol === "https:" ? https : http;
    const req = transport.get(rawUrl, { timeout: DOWNLOAD_TIMEOUT_MS }, (res) => {
      // Follow redirects (3xx) safely
      if (
        res.statusCode &&
        res.statusCode >= 300 &&
        res.statusCode < 400 &&
        res.headers.location
      ) {
        if (redirectsLeft <= 0) {
          return reject(new Error("Too many redirects while downloading file"));
        }
        res.resume(); // discard body
        const nextUrl = new URL(res.headers.location, rawUrl).toString();
        return resolve(downloadUrl(nextUrl, redirectsLeft - 1));
      }

      if (!res.statusCode || res.statusCode < 200 || res.statusCode >= 300) {
        res.resume();
        return reject(new Error(`Failed to download file: HTTP ${res.statusCode}`));
      }

      const rawContentType = res.headers["content-type"] ?? "application/octet-stream";
      // Strip parameters (e.g. "image/jpeg; charset=utf-8" → "image/jpeg")
      const contentType = rawContentType.split(";")[0].trim().toLowerCase();

      const chunks: Buffer[] = [];
      let totalBytes = 0;

      res.on("data", (chunk: Buffer) => {
        totalBytes += chunk.length;
        if (totalBytes > MAX_FILE_SIZE_BYTES) {
          req.destroy();
          reject(new Error(`File exceeds maximum allowed size of ${MAX_FILE_SIZE_BYTES / 1024 / 1024} MB`));
        } else {
          chunks.push(chunk);
        }
      });

      res.on("end", () => resolve({ buffer: Buffer.concat(chunks), contentType }));
      res.on("error", reject);
    });

    req.on("timeout", () => {
      req.destroy();
      reject(new Error("Timed out while downloading file"));
    });
    req.on("error", reject);
  });
}

async function uploadToQuickbooks(
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
              reject(new Error(`QBO upload failed (${res.statusCode}): ${responseText}`));
            } else {
              resolve(json);
            }
          } catch {
            reject(new Error(`QBO upload: unexpected response (${res.statusCode}): ${responseText}`));
          }
        });
        res.on("error", reject);
      }
    );
    req.on("error", reject);
    req.write(body);
    req.end();
  });
}

export async function uploadAttachmentFromUrl(
  data: UploadAttachmentFromUrlInput
): Promise<ToolResponse<any>> {
  try {
    // Download the file first (before authenticating to fail fast on bad URLs)
    const { buffer, contentType } = await downloadUrl(data.file_url, MAX_REDIRECTS);

    if (!ALLOWED_UPLOAD_CONTENT_TYPES.has(contentType)) {
      return {
        result: null,
        isError: true,
        error: `Unsupported content type "${contentType}" from URL. QuickBooks only accepts: ${[...ALLOWED_UPLOAD_CONTENT_TYPES].join(", ")}`,
      };
    }

    await quickbooksClient.authenticate();

    const fileName = sanitizeFilename(
      data.file_name ?? deriveFilenameFromUrl(data.file_url)
    );

    const metadata: Record<string, unknown> = {
      FileName: fileName,
      ContentType: contentType,
    };
    if (data.note) metadata.Note = data.note;
    if (data.category) metadata.Category = data.category;
    if (data.attachable_ref) {
      metadata.AttachableRef = [
        {
          EntityRef: {
            type: data.attachable_ref.entity_ref_type,
            value: data.attachable_ref.entity_ref_value,
          },
        },
      ];
    }

    const { accessToken, realmId, isSandbox } = quickbooksClient.getAuthCredentials();
    const uploadResult = await uploadToQuickbooks(buffer, metadata, accessToken, realmId, isSandbox);

    return { result: uploadResult, isError: false, error: null };
  } catch (error) {
    return { result: null, isError: true, error: formatError(error) };
  }
}
