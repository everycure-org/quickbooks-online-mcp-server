import { jest, describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import { readdirSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { mockQuickbooksClient } from '../../mocks/quickbooks.mock';

jest.unstable_mockModule('../../../src/clients/quickbooks-client', () => ({
  quickbooksClient: mockQuickbooksClient,
}));

const { McpServer } = await import('@modelcontextprotocol/sdk/server/mcp.js');
const { Client } = await import('@modelcontextprotocol/sdk/client/index.js');
const { InMemoryTransport } = await import('@modelcontextprotocol/sdk/inMemory.js');
const { RegisterTool } = await import('../../../src/helpers/register-tool');

const toolsDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../src/tools');

const TYPED_KEYS = ['type', 'anyOf', 'oneOf', 'allOf', 'enum', 'const', 'not'];

/** Collect JSON-pointer paths of schema nodes that carry no type information. */
function findUntypedNodes(node: any, at: string, out: string[]): void {
  if (!node || typeof node !== 'object') return;
  if (node.$ref) out.push(`${at} ($ref)`);
  else if (!TYPED_KEYS.some((k) => k in node)) out.push(at);
  for (const [k, child] of Object.entries<any>(node.properties ?? {})) findUntypedNodes(child, `${at}/properties/${k}`, out);
  if (node.items) findUntypedNodes(node.items, `${at}/items`, out);
  for (const key of ['anyOf', 'oneOf', 'allOf']) {
    (node[key] ?? []).forEach((child: any, i: number) => findUntypedNodes(child, `${at}/${key}/${i}`, out));
  }
}

describe('tool input schemas', () => {
  let client: InstanceType<typeof Client>;
  let tools: Awaited<ReturnType<InstanceType<typeof Client>['listTools']>>['tools'];

  beforeAll(async () => {
    const server = new McpServer({ name: 'schema-test', version: '1.0.0' }, { capabilities: { tools: {} } });
    for (const file of readdirSync(toolsDir).filter((f) => f.endsWith('.tool.ts'))) {
      const mod = await import(path.join(toolsDir, file));
      for (const def of Object.values<any>(mod)) RegisterTool(server, def);
    }
    const [serverTransport, clientTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    client = new Client({ name: 'schema-test-client', version: '1.0.0' });
    await client.connect(clientTransport);
    tools = (await client.listTools()).tools;
  });

  afterAll(async () => {
    await client.close();
  });

  it('registers every tool module', () => {
    expect(tools.length).toBeGreaterThanOrEqual(140);
  });

  it('no tool has an empty or untyped input schema', () => {
    const problems: string[] = [];
    for (const tool of tools) {
      const params: any = (tool.inputSchema as any).properties?.params;
      if (!params || params.type !== 'object' || Object.keys(params.properties ?? {}).length === 0) {
        problems.push(`${tool.name}: params is missing or has no properties`);
        continue;
      }
      const untyped: string[] = [];
      findUntypedNodes(params, '#/properties/params', untyped);
      for (const p of untyped) problems.push(`${tool.name}: untyped schema at ${p}`);
    }
    expect(problems).toEqual([]);
  });

  it('exposes the criteria array shape on search tools', () => {
    const accounts: any = tools.find((t) => t.name === 'search_accounts')!.inputSchema;
    const variants = accounts.properties.params.properties.criteria.anyOf;
    const arrayForm = variants.find((v: any) => v.type === 'array');
    expect(arrayForm.items.properties.field.enum).toContain('AccountType');
    expect(arrayForm.items.required).toEqual(['field', 'value']);
  });

  it('accepts params serialised as a JSON string', async () => {
    // The string is parsed into an object, so validation reaches the
    // field-level rule (id min length) instead of failing on the params type.
    await expect(
      client.callTool({
        name: 'void_sales_receipt',
        arguments: { params: JSON.stringify({ id: '', reason: 'x' }) },
      })
    ).rejects.toThrow(/"params",\s*"id"/);
  });
});
