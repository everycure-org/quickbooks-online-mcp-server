import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { ToolDefinition } from "../types/tool-definition.js";
import { z } from "zod";

/**
 * Some MCP clients serialise the nested `params` object as a JSON string.
 * Accept that shape by parsing it before validation; the advertised JSON
 * schema is unchanged (zod-to-json-schema describes the inner object).
 */
export function parseJsonStringParams(value: unknown): unknown {
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value);
  } catch {
    return value; // let the object schema report a clear type error
  }
}

export function RegisterTool<T extends z.ZodType<any, any>>(
  server: McpServer,
  toolDefinition: ToolDefinition<T>
) {
  server.tool(
    toolDefinition.name,
    toolDefinition.description,
    { params: z.preprocess(parseJsonStringParams, toolDefinition.schema) as unknown as T },
    toolDefinition.handler
  );
}
