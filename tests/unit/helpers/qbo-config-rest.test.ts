import { jest, describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import { mockQuickbooksClient, resetAllMocks } from '../../mocks/quickbooks.mock';

jest.unstable_mockModule('../../../src/clients/quickbooks-client', () => ({
  quickbooksClient: mockQuickbooksClient,
}));

const config = await import('../../../src/helpers/qbo-config');
const rest = await import('../../../src/helpers/qbo-rest');
const guard = await import('../../../src/helpers/write-guard');
const { parseJsonStringParams } = await import('../../../src/helpers/register-tool');

const KEYS = ['QBO_ENVIRONMENT', 'QUICKBOOKS_ENVIRONMENT', 'QBO_WRITE_ENABLED', 'QBO_PRODUCTION_WRITES_CONFIRMED', 'QBO_ALLOWED_NEGATIVE_ITEM_IDS'];
const saved: Record<string, string | undefined> = {};

beforeEach(() => {
  resetAllMocks();
  for (const k of KEYS) {
    saved[k] = process.env[k];
    delete process.env[k];
  }
});
afterEach(() => {
  for (const k of KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

describe('qbo-config', () => {
  it('defaults to sandbox and writes disabled', () => {
    expect(config.getQboEnvironment()).toBe('sandbox');
    expect(config.getQboBaseUrl()).toBe('https://sandbox-quickbooks.api.intuit.com');
    expect(config.isWriteEnabled()).toBe(false);
    expect(config.isProductionWriteConfirmed()).toBe(false);
    expect(config.getAllowedNegativeItemIds()).toEqual([]);
  });

  it('uses QBO_ENVIRONMENT, falling back to QUICKBOOKS_ENVIRONMENT', () => {
    process.env.QUICKBOOKS_ENVIRONMENT = 'production';
    expect(config.getQboEnvironment()).toBe('production');
    expect(config.getQboBaseUrl()).toBe('https://quickbooks.api.intuit.com');
    process.env.QBO_ENVIRONMENT = 'Production';
    expect(config.getQboEnvironment()).toBe('production');
  });

  it('rejects conflicting or invalid environments', () => {
    process.env.QBO_ENVIRONMENT = 'sandbox';
    process.env.QUICKBOOKS_ENVIRONMENT = 'production';
    expect(() => config.getQboEnvironment()).toThrow('disagree');
    delete process.env.QUICKBOOKS_ENVIRONMENT;
    process.env.QBO_ENVIRONMENT = 'prod';
    expect(() => config.getQboEnvironment()).toThrow('must be "sandbox" or "production"');
  });

  it('parses flags and the negative item list', () => {
    process.env.QBO_WRITE_ENABLED = 'TRUE';
    process.env.QBO_PRODUCTION_WRITES_CONFIRMED = 'true';
    process.env.QBO_ALLOWED_NEGATIVE_ITEM_IDS = ' 25, ,31 ';
    expect(config.isWriteEnabled()).toBe(true);
    expect(config.isProductionWriteConfirmed()).toBe(true);
    expect(config.getAllowedNegativeItemIds()).toEqual(['25', '31']);
  });
});

describe('write-guard', () => {
  it('only requires production confirmation for tools that ask for it', () => {
    process.env.QBO_ENVIRONMENT = 'production';
    process.env.QBO_WRITE_ENABLED = 'true';
    expect(guard.decideWrite('create_customer', false, { requireProductionConfirmation: false })).toEqual({ dryRun: false, environment: 'production' });
    expect(() => guard.decideWrite('void_sales_receipt', false, { requireProductionConfirmation: true })).toThrow('QBO_PRODUCTION_WRITES_CONFIRMED');
  });

  it('tags errors without their text', () => {
    expect(guard.auditErrorTag(new rest.QboApiError('m', 500))).toBe('qbo_500');
    expect(guard.auditErrorTag(new TypeError('x'))).toBe('TypeError');
    expect(guard.auditErrorTag(undefined)).toBe('error');
  });
});

describe('qbo-rest', () => {
  const respond = (status: number, text: string) =>
    ((globalThis as any).fetch = jest.fn(async () => ({ ok: status < 300, status, text: async () => text })));

  it('throws a clear error on a non-JSON response', async () => {
    respond(502, '<html>bad gateway</html>');
    await expect(rest.qboRequest('GET', 'x')).rejects.toThrow('non-JSON response (HTTP 502)');
  });

  it('treats an empty body as an empty object', async () => {
    respond(200, '');
    await expect(rest.qboRequest('GET', 'x')).resolves.toEqual({});
  });

  it('throws on a Fault even with HTTP 200', async () => {
    respond(200, JSON.stringify({ Fault: { Error: [{ Message: 'oops' }] } }));
    await expect(rest.qboRequest('GET', 'x')).rejects.toThrow('QBO 200: oops');
  });

  it('describes failures without a Fault body', async () => {
    respond(500, JSON.stringify({}));
    await expect(rest.qboRequest('GET', 'x')).rejects.toThrow('QBO request failed with HTTP 500');
  });

  it('qboRead rethrows errors other than not-found', async () => {
    respond(401, JSON.stringify({ Fault: { Error: [{ Message: 'AuthenticationFailed', code: '100' }] } }));
    await expect(rest.qboRead('Customer', '1')).rejects.toThrow('AuthenticationFailed');
  });

  it('qboRead returns null when the entity key is absent', async () => {
    respond(200, JSON.stringify({}));
    await expect(rest.qboRead('Customer', '1')).resolves.toBeNull();
  });

  it('skips undefined query params and always sends minorversion', async () => {
    const fetchMock = respond(200, '{}');
    await rest.qboRequest('GET', 'x', { query: { a: '1', b: undefined } });
    const url = new URL(String((fetchMock.mock.calls[0] as any[])[0]));
    expect(url.searchParams.get('a')).toBe('1');
    expect(url.searchParams.has('b')).toBe(false);
    expect(url.searchParams.get('minorversion')).toBe('75');
  });

  it('qboQuery returns [] when QBO omits the QueryResponse', async () => {
    respond(200, '{}');
    await expect(rest.qboQuery('SalesReceipt', 'select * from SalesReceipt')).resolves.toEqual([]);
  });

  it('escapes backslashes and quotes in query values', () => {
    expect(rest.escapeQueryValue("a\\b'c")).toBe("a\\\\b\\'c");
  });
});

describe('parseJsonStringParams', () => {
  it('parses JSON strings and passes other values through', () => {
    expect(parseJsonStringParams('{"a":1}')).toEqual({ a: 1 });
    expect(parseJsonStringParams('not json')).toBe('not json');
    expect(parseJsonStringParams({ a: 1 })).toEqual({ a: 1 });
  });
});
