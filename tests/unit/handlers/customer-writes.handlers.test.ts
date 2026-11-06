import { jest, describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import { mockQuickbooksClient, resetAllMocks } from '../../mocks/quickbooks.mock';
import { createFakeQbo, FakeQbo } from '../../mocks/qbo-fetch.mock';

jest.unstable_mockModule('../../../src/clients/quickbooks-client', () => ({
  quickbooksClient: mockQuickbooksClient,
}));

const { createQuickbooksCustomer, buildCustomerPayload } = await import('../../../src/handlers/create-quickbooks-customer.handler');

let fake: FakeQbo;
const saved = { env: process.env.QBO_ENVIRONMENT, write: process.env.QBO_WRITE_ENABLED };

beforeEach(() => {
  resetAllMocks();
  process.env.QBO_ENVIRONMENT = 'sandbox';
  process.env.QBO_WRITE_ENABLED = 'true';
  fake = createFakeQbo();
  (globalThis as any).fetch = fake.fetch;
  fake.entities.set('Customer:10', { Id: '10', Active: true });
  fake.postResponses.customer = { body: { Customer: { Id: '77', DisplayName: 'Chariot - Unrestricted' } } };
  jest.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  process.env.QBO_ENVIRONMENT = saved.env;
  if (saved.write === undefined) delete process.env.QBO_WRITE_ENABLED;
  else process.env.QBO_WRITE_ENABLED = saved.write;
  if (saved.env === undefined) delete process.env.QBO_ENVIRONMENT;
});

describe('buildCustomerPayload', () => {
  it('builds a top-level customer', () => {
    expect(buildCustomerPayload({ display_name: 'A', company_name: 'Co' })).toEqual({ DisplayName: 'A', CompanyName: 'Co' });
  });

  it('builds a sub-customer with ParentRef, Job and BillWithParent', () => {
    expect(buildCustomerPayload({ display_name: 'Chariot - Unrestricted', parent_id: '10' })).toEqual({
      DisplayName: 'Chariot - Unrestricted',
      ParentRef: { value: '10' },
      Job: true,
      BillWithParent: true,
    });
  });
});

describe('createQuickbooksCustomer', () => {
  it('creates a sub-customer after checking DisplayName (active and inactive)', async () => {
    const res = await createQuickbooksCustomer({ display_name: "Chariot - O'Brien", parent_id: '10', dry_run: false });
    expect(res.result).toMatchObject({ status: 'created', id: '77' });
    const q = fake.calls.find((c) => c.url.pathname.endsWith('/query'))!;
    expect(q.url.searchParams.get('query')).toBe(
      "select * from Customer where DisplayName = 'Chariot - O\\'Brien' and Active in (true, false)"
    );
    expect(fake.posts()[0].body).toEqual({ DisplayName: "Chariot - O'Brien", ParentRef: { value: '10' }, Job: true, BillWithParent: true });
  });

  it('returns already_exists and never POSTs', async () => {
    fake.queryRows.Customer = [{ Id: '42', DisplayName: 'X' }];
    const res = await createQuickbooksCustomer({ display_name: 'X', dry_run: false });
    expect(res.result).toMatchObject({ status: 'already_exists', id: '42' });
    expect(fake.posts()).toHaveLength(0);
  });

  it('defaults to a dry run', async () => {
    const res = await createQuickbooksCustomer({ display_name: 'New' });
    expect(res.result).toMatchObject({ status: 'dry_run', id: null, payload: { DisplayName: 'New' } });
    expect(fake.posts()).toHaveLength(0);
  });

  it('is forced to a dry run when QBO_WRITE_ENABLED is false', async () => {
    process.env.QBO_WRITE_ENABLED = 'false';
    const res = await createQuickbooksCustomer({ display_name: 'New', dry_run: false });
    expect(res.result).toMatchObject({ status: 'dry_run', dry_run_reason: expect.stringContaining('QBO_WRITE_ENABLED') });
    expect(fake.posts()).toHaveLength(0);
  });

  it('rejects a missing parent', async () => {
    const res = await createQuickbooksCustomer({ display_name: 'New', parent_id: '404', dry_run: false });
    expect(res.isError).toBe(true);
    expect(res.error).toContain('parent customer 404 does not exist');
    expect(fake.posts()).toHaveLength(0);
  });

  it('rejects an inactive parent', async () => {
    fake.entities.set('Customer:10', { Id: '10', Active: false });
    const res = await createQuickbooksCustomer({ display_name: 'New', parent_id: '10', dry_run: false });
    expect(res.isError).toBe(true);
    expect(res.error).toContain('inactive');
  });

  it('surfaces QBO errors', async () => {
    fake.postResponses.customer = { status: 400, body: { Fault: { Error: [{ Message: 'Duplicate Name Exists Error', code: '6240' }] } } };
    const res = await createQuickbooksCustomer({ display_name: 'New', dry_run: false });
    expect(res.isError).toBe(true);
    expect(res.error).toContain('6240');
  });
});
