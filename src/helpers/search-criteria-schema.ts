import { z } from "zod";

/**
 * Explicit, client-visible schema for the `criteria` input of the generic
 * search tools (items, accounts, invoices). Every node is typed so MCP clients
 * can build a proper object instead of guessing.
 *
 * Fresh sub-schemas are built per use so zod-to-json-schema emits them inline
 * rather than as $ref pointers, which several MCP clients cannot resolve.
 */

const OPERATORS = ["=", "IN", "<", ">", "<=", ">=", "LIKE"] as const;

const valueSchema = () =>
  z
    .union([z.string(), z.number(), z.boolean(), z.array(z.union([z.string(), z.number()]))])
    .describe("Value to compare against. Use an array with the IN operator.");

const filterSchema = (filterFields: readonly [string, ...string[]]) =>
  z.object({
    field: z.enum(filterFields).describe("Filterable entity field"),
    value: valueSchema(),
    operator: z.enum(OPERATORS).optional().describe("Comparison operator, default ="),
  });

export function buildSearchCriteriaSchema(
  filterFields: readonly [string, ...string[]],
  sortFields: readonly [string, ...string[]]
) {
  const advanced = z
    .object({
      filters: z.array(filterSchema(filterFields)).optional().describe("Filters, ANDed together"),
      asc: z.enum(sortFields).optional().describe("Sort ascending by this field"),
      desc: z.enum(sortFields).optional().describe("Sort descending by this field"),
      limit: z.number().int().positive().optional().describe("Max rows to return"),
      offset: z.number().int().nonnegative().optional().describe("Rows to skip"),
      count: z.boolean().optional().describe("Return only a count"),
      fetchAll: z.boolean().optional().describe("Page through and return all rows"),
    })
    .strict()
    .describe("Advanced form: { filters, asc, desc, limit, offset, count, fetchAll }");

  return z
    .union([
      advanced,
      z.array(filterSchema(filterFields)).describe("Array form: [{ field, value, operator }]"),
      z.record(valueSchema()).describe("Simple form: { FieldName: value }"),
    ])
    .describe("Search criteria. Use {} or { limit: N } to list without filters.");
}
