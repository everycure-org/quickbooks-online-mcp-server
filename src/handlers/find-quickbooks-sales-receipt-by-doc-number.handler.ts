import { ToolResponse } from "../types/tool-response.js";
import { formatError } from "../helpers/format-error.js";
import { findSalesReceiptByDocNumber } from "./create-quickbooks-sales-receipt.handler.js";

export async function findQuickbooksSalesReceiptByDocNumber(
  docNumber: string
): Promise<ToolResponse<Record<string, any> | null>> {
  try {
    return { result: await findSalesReceiptByDocNumber(docNumber), isError: false, error: null };
  } catch (error) {
    return { result: null, isError: true, error: formatError(error) };
  }
}
