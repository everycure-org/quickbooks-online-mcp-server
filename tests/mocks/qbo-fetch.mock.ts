/**
 * A tiny in-memory QBO REST fake for handlers that use helpers/qbo-rest.
 * Install it as global.fetch; it records every call for assertions.
 */
import { jest } from '@jest/globals';

export interface RecordedCall {
  method: string;
  url: URL;
  body?: any;
}

export interface FakeQbo {
  fetch: jest.Mock<any>;
  calls: RecordedCall[];
  /** Entities served by GET /<entity>/<id>, keyed "Entity:id". */
  entities: Map<string, Record<string, any>>;
  /** Rows returned for queries, keyed by entity name. */
  queryRows: Record<string, Record<string, any>[]>;
  /** Response body for POSTs, keyed by resource path (e.g. "salesreceipt"). */
  postResponses: Record<string, any>;
  posts(): RecordedCall[];
}

function json(status: number, body: unknown) {
  return { ok: status >= 200 && status < 300, status, text: async () => JSON.stringify(body) };
}

export function createFakeQbo(): FakeQbo {
  const fake: FakeQbo = {
    calls: [],
    entities: new Map(),
    queryRows: {},
    postResponses: {},
    posts: () => fake.calls.filter((c) => c.method === 'POST'),
    fetch: jest.fn(),
  };
  fake.fetch.mockImplementation(async (input: any, init: any = {}) => {
    const url = new URL(String(input));
    const method = init.method ?? 'GET';
    const body = init.body ? JSON.parse(init.body) : undefined;
    fake.calls.push({ method, url, body });
    const resource = url.pathname.replace(/^\/v3\/company\/[^/]+\//, '');

    if (method === 'GET' && resource === 'query') {
      const q = url.searchParams.get('query') ?? '';
      const entity = /from (\w+)/i.exec(q)?.[1] ?? '';
      return json(200, { QueryResponse: { [entity]: fake.queryRows[entity] ?? [] } });
    }
    if (method === 'GET') {
      const [entityLower, id] = resource.split('/');
      const hit = [...fake.entities.entries()].find(([k]) => k.toLowerCase() === `${entityLower}:${decodeURIComponent(id)}`);
      if (!hit) {
        return json(400, { Fault: { Error: [{ Message: 'Object Not Found', Detail: 'not found', code: '610' }] } });
      }
      return json(200, { [hit[0].split(':')[0]]: hit[1] });
    }
    const response = fake.postResponses[resource];
    if (!response) return json(500, { Fault: { Error: [{ Message: 'unexpected POST', code: '999' }] } });
    return json(response.status ?? 200, response.body);
  });
  return fake;
}
