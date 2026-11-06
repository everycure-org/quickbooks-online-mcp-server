import { jest, describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import { mockQuickbooksClient, resetAllMocks } from '../../mocks/quickbooks.mock';
import { createFakeQbo, FakeQbo } from '../../mocks/qbo-fetch.mock';

jest.unstable_mockModule('../../../src/clients/quickbooks-client', () => ({
  quickbooksClient: mockQuickbooksClient,
}));

const {
  createQuickbooksSalesReceipt,
  buildSalesReceiptPayload,
  validateSalesReceiptLines,
} = await import('../../../src/handlers/create-quickbooks-sales-receipt.handler');
const { voidQuickbooksSalesReceipt, VOID_MARKER } = await import('../../../src/handlers/void-quickbooks-sales-receipt.handler');
const { findQuickbooksSalesReceiptByDocNumber } = await import('../../../src/handlers/find-quickbooks-sales-receipt-by-doc-number.handler');

const ENV_KEYS = [
  'QBO_ENVIRONMENT',
  'QUICKBOOKS_ENVIRONMENT',
  'QBO_WRITE_ENABLED',
  'QBO_PRODUCTION_WRITES_CONFIRMED',
  'QBO_ALLOWED_NEGATIVE_ITEM_IDS',
];

const IDS = { customer: '100000012', account: '4', department: '7', klass: '664620', gift: '19', fee: '25' };

function baseInput(overrides: Record<string, any> = {}) {
  return {
    idempotency_key: 'TEST-0001',
    doc_number: 'TEST-0001',
    txn_date: '2026-11-01',
    customer_id: IDS.customer,
    deposit_to_account_id: IDS.account,
    department_id: IDS.department,
    private_note: 'HubSpotGift=TEST-0001; ChariotDeposit=deposit_test; ChariotDonation=donation_test',
    lines: [
      { item_id: IDS.gift, class_id: IDS.klass, amount: 222.0, description: 'Gift' },
      { item_id: IDS.fee, class_id: IDS.klass, amount: -6.66, description: 'Fee' },
    ],
    dry_run: false,
    ...overrides,
  };
}

let fake: FakeQbo;
let errSpy: any;
const savedEnv: Record<string, string | undefined> = {};

function seedSandbox() {
  fake.entities.set(`Customer:${IDS.customer}`, { Id: IDS.customer, Active: true });
  fake.entities.set(`Account:${IDS.account}`, { Id: IDS.account, Active: true, AccountSubType: 'UndepositedFunds' });
  fake.entities.set(`Department:${IDS.department}`, { Id: IDS.department, Active: true });
  fake.entities.set(`Class:${IDS.klass}`, { Id: IDS.klass, Active: true });
  fake.entities.set(`Item:${IDS.gift}`, { Id: IDS.gift, Active: true });
  fake.entities.set(`Item:${IDS.fee}`, { Id: IDS.fee, Active: true });
}

beforeEach(() => {
  resetAllMocks();
  for (const k of ENV_KEYS) {
    savedEnv[k] = process.env[k];
    delete process.env[k];
  }
  process.env.QBO_ENVIRONMENT = 'sandbox';
  process.env.QBO_WRITE_ENABLED = 'true';
  process.env.QBO_ALLOWED_NEGATIVE_ITEM_IDS = IDS.fee;
  fake = createFakeQbo();
  (globalThis as any).fetch = fake.fetch;
  seedSandbox();
  fake.postResponses.salesreceipt = {
    body: { SalesReceipt: { Id: '900', DocNumber: 'TEST-0001', TotalAmt: 215.34, TxnDate: '2026-11-01', SyncToken: '0' } },
  };
  errSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[k];
  }
});

describe('buildSalesReceiptPayload', () => {
  it('maps a donation line plus a negative fee line', () => {
    const payload = buildSalesReceiptPayload(baseInput());
    expect(payload).toEqual({
      DocNumber: 'TEST-0001',
      TxnDate: '2026-11-01',
      CustomerRef: { value: IDS.customer },
      DepositToAccountRef: { value: IDS.account },
      DepartmentRef: { value: IDS.department },
      PrivateNote: 'HubSpotGift=TEST-0001; ChariotDeposit=deposit_test; ChariotDonation=donation_test',
      Line: [
        {
          DetailType: 'SalesItemLineDetail',
          Amount: 222,
          Description: 'Gift',
          SalesItemLineDetail: { ItemRef: { value: IDS.gift }, ClassRef: { value: IDS.klass }, Qty: 1, UnitPrice: 222 },
        },
        {
          DetailType: 'SalesItemLineDetail',
          Amount: -6.66,
          Description: 'Fee',
          SalesItemLineDetail: { ItemRef: { value: IDS.fee }, ClassRef: { value: IDS.klass }, Qty: 1, UnitPrice: -6.66 },
        },
      ],
    });
  });

  it('omits Description when not given', () => {
    const payload = buildSalesReceiptPayload(baseInput({ lines: [{ item_id: '1', class_id: '2', amount: 5 }] }));
    expect(payload.Line[0]).not.toHaveProperty('Description');
  });

  it('computes the net total in cents without float drift', () => {
    expect(validateSalesReceiptLines(baseInput().lines)).toBe(215.34);
  });
});

describe('createQuickbooksSalesReceipt', () => {
  it('creates the receipt with requestid and minorversion and returns status created', async () => {
    const res = await createQuickbooksSalesReceipt(baseInput());
    expect(res.isError).toBe(false);
    expect(res.result).toMatchObject({ status: 'created', id: '900', doc_number: 'TEST-0001', total_amt: 215.34, txn_date: '2026-11-01' });

    const posts = fake.posts();
    expect(posts).toHaveLength(1);
    expect(posts[0].url.origin).toBe('https://sandbox-quickbooks.api.intuit.com');
    expect(posts[0].url.pathname).toBe('/v3/company/mock-realm-id/salesreceipt');
    expect(posts[0].url.searchParams.get('requestid')).toBe('TEST-0001');
    expect(posts[0].url.searchParams.get('minorversion')).toBe('75');
    expect(posts[0].body).toEqual(buildSalesReceiptPayload(baseInput()));
  });

  it('checks DocNumber with an escaped query', async () => {
    await createQuickbooksSalesReceipt(baseInput({ doc_number: "A'B", dry_run: true }));
    const q = fake.calls.find((c) => c.url.pathname.endsWith('/query'))!;
    expect(q.url.searchParams.get('query')).toBe("select * from SalesReceipt where DocNumber = 'A\\'B'");
  });

  it('returns already_exists for an existing DocNumber and never POSTs', async () => {
    fake.queryRows.SalesReceipt = [{ Id: '555', DocNumber: 'TEST-0001', TotalAmt: 215.34, TxnDate: '2026-11-01' }];
    const res = await createQuickbooksSalesReceipt(baseInput());
    expect(res.result).toMatchObject({ status: 'already_exists', id: '555', total_amt: 215.34 });
    expect(fake.posts()).toHaveLength(0);
  });

  it('dry_run validates and returns the payload without POSTing', async () => {
    const res = await createQuickbooksSalesReceipt(baseInput({ dry_run: true }));
    expect(res.result).toMatchObject({ status: 'dry_run', id: null, total_amt: 215.34 });
    expect(res.result!.payload).toEqual(buildSalesReceiptPayload(baseInput()));
    expect(res.result!.dry_run_reason).toBeUndefined();
    expect(fake.posts()).toHaveLength(0);
  });

  it('dry_run defaults to true when omitted', async () => {
    const { dry_run, ...input } = baseInput();
    const res = await createQuickbooksSalesReceipt(input as any);
    expect(res.result!.status).toBe('dry_run');
    expect(fake.posts()).toHaveLength(0);
  });

  it('QBO_WRITE_ENABLED=false forces a dry run even when dry_run is false', async () => {
    process.env.QBO_WRITE_ENABLED = 'false';
    const res = await createQuickbooksSalesReceipt(baseInput({ dry_run: false }));
    expect(res.result).toMatchObject({ status: 'dry_run', dry_run_reason: expect.stringContaining('QBO_WRITE_ENABLED') });
    expect(fake.posts()).toHaveLength(0);
    expect(errSpy).toHaveBeenCalledWith(expect.stringContaining('WARNING create_sales_receipt'));
  });

  it('QBO_WRITE_ENABLED unset forces a dry run', async () => {
    delete process.env.QBO_WRITE_ENABLED;
    const res = await createQuickbooksSalesReceipt(baseInput());
    expect(res.result!.status).toBe('dry_run');
    expect(fake.posts()).toHaveLength(0);
  });

  it('refuses production writes without QBO_PRODUCTION_WRITES_CONFIRMED', async () => {
    process.env.QBO_ENVIRONMENT = 'production';
    const res = await createQuickbooksSalesReceipt(baseInput());
    expect(res.isError).toBe(true);
    expect(res.error).toContain('QBO_PRODUCTION_WRITES_CONFIRMED');
    expect(fake.calls).toHaveLength(0);
  });

  it('writes to the production base URL when both flags are set', async () => {
    process.env.QBO_ENVIRONMENT = 'production';
    process.env.QBO_PRODUCTION_WRITES_CONFIRMED = 'true';
    const res = await createQuickbooksSalesReceipt(baseInput());
    expect(res.result!.status).toBe('created');
    expect(fake.posts()[0].url.origin).toBe('https://quickbooks.api.intuit.com');
  });

  it('allows production dry runs without the confirmation flag', async () => {
    process.env.QBO_ENVIRONMENT = 'production';
    const res = await createQuickbooksSalesReceipt(baseInput({ dry_run: true }));
    expect(res.result!.status).toBe('dry_run');
  });

  const invalidCases: Array<[string, () => Record<string, any>, string | RegExp]> = [
    ['total is zero', () => baseInput({ lines: [{ item_id: IDS.gift, class_id: IDS.klass, amount: 6.66 }, { item_id: IDS.fee, class_id: IDS.klass, amount: -6.66 }] }), 'greater than 0'],
    ['total is negative', () => baseInput({ lines: [{ item_id: IDS.fee, class_id: IDS.klass, amount: -1 }] }), 'greater than 0'],
    ['more than 2 decimals', () => baseInput({ lines: [{ item_id: IDS.gift, class_id: IDS.klass, amount: 10.005 }] }), 'more than 2 decimal places'],
    ['zero amount line', () => baseInput({ lines: [{ item_id: IDS.gift, class_id: IDS.klass, amount: 10 }, { item_id: IDS.gift, class_id: IDS.klass, amount: 0 }] }), 'must not be 0'],
    ['non-finite amount', () => baseInput({ lines: [{ item_id: IDS.gift, class_id: IDS.klass, amount: Number.NaN }] }), 'finite'],
    ['two negative lines', () => baseInput({ lines: [{ item_id: IDS.gift, class_id: IDS.klass, amount: 100 }, { item_id: IDS.fee, class_id: IDS.klass, amount: -1 }, { item_id: IDS.fee, class_id: IDS.klass, amount: -2 }] }), 'at most one negative line'],
    ['negative line on a non-fee item', () => baseInput({ lines: [{ item_id: IDS.gift, class_id: IDS.klass, amount: 100 }, { item_id: IDS.gift, class_id: IDS.klass, amount: -2 }] }), 'not in QBO_ALLOWED_NEGATIVE_ITEM_IDS'],
    ['customer missing', () => baseInput({ customer_id: '999' }), 'customer 999 does not exist'],
    ['department missing', () => baseInput({ department_id: '998' }), 'department 998 does not exist'],
    ['item missing', () => baseInput({ lines: [{ item_id: '997', class_id: IDS.klass, amount: 5 }] }), 'item 997 does not exist'],
    ['class missing', () => baseInput({ lines: [{ item_id: IDS.gift, class_id: '996', amount: 5 }] }), 'class 996 does not exist'],
    ['deposit account missing', () => baseInput({ deposit_to_account_id: '995' }), 'deposit account 995 does not exist'],
  ];

  it.each(invalidCases)('rejects when %s and makes no write call', async (_label, input, expected) => {
    const res = await createQuickbooksSalesReceipt(input() as any);
    expect(res.isError).toBe(true);
    expect(res.error).toMatch(expected);
    expect(fake.posts()).toHaveLength(0);
  });

  it.each([
    ['customer', `Customer:${IDS.customer}`, 'customer 100000012 is inactive'],
    ['department', `Department:${IDS.department}`, 'department 7 is inactive'],
    ['item', `Item:${IDS.gift}`, 'item 19 is inactive'],
    ['class', `Class:${IDS.klass}`, 'class 664620 is inactive'],
    ['deposit account', `Account:${IDS.account}`, 'deposit account 4 is inactive'],
  ])('rejects an inactive %s and makes no write call', async (_label, key, expected) => {
    fake.entities.set(key, { ...fake.entities.get(key)!, Active: false });
    const res = await createQuickbooksSalesReceipt(baseInput());
    expect(res.isError).toBe(true);
    expect(res.error).toContain(expected);
    expect(fake.posts()).toHaveLength(0);
  });

  it('refuses to write when location (department) tracking is off', async () => {
    fake.preferences = { AccountingInfoPrefs: { TrackDepartments: false, ClassTrackingPerTxnLine: true } };
    const res = await createQuickbooksSalesReceipt(baseInput());
    expect(res.isError).toBe(true);
    expect(res.error).toContain("'Track locations' is off");
    expect(fake.posts()).toHaveLength(0);
  });

  it('refuses to write when class tracking is not one per row', async () => {
    fake.preferences = { AccountingInfoPrefs: { TrackDepartments: true, ClassTrackingPerTxn: true, ClassTrackingPerTxnLine: false } };
    const res = await createQuickbooksSalesReceipt(baseInput());
    expect(res.isError).toBe(true);
    expect(res.error).toContain("'One to each row'");
    expect(fake.posts()).toHaveLength(0);
  });

  it('refuses when QBO returns no preferences at all', async () => {
    fake.preferences = undefined as any;
    const res = await createQuickbooksSalesReceipt(baseInput({ dry_run: true }));
    expect(res.isError).toBe(true);
    expect(res.error).toContain('Track locations');
  });

  it('refuses a deposit account that is not Undeposited Funds (e.g. a bank account)', async () => {
    fake.entities.set(`Account:${IDS.account}`, { Id: IDS.account, Active: true, AccountSubType: 'Checking' });
    const res = await createQuickbooksSalesReceipt(baseInput());
    expect(res.isError).toBe(true);
    expect(res.error).toContain('only UndepositedFunds is allowed');
    expect(fake.posts()).toHaveLength(0);
  });

  it('reports QBO faults from the POST', async () => {
    fake.postResponses.salesreceipt = { status: 400, body: { Fault: { Error: [{ Message: 'Business Validation Error', Detail: 'bad', code: '6000' }] } } };
    const res = await createQuickbooksSalesReceipt(baseInput());
    expect(res.isError).toBe(true);
    expect(res.error).toContain('[6000] Business Validation Error bad');
  });

  it('logs writes with identifiers only (no memo, no token)', async () => {
    await createQuickbooksSalesReceipt(baseInput());
    const lines = errSpy.mock.calls.map((c: any[]) => String(c[0])).filter((l: string) => l.startsWith('[qbo-write] {'));
    expect(lines).toHaveLength(1);
    const entry = JSON.parse(lines[0].slice('[qbo-write] '.length));
    expect(entry).toMatchObject({ tool: 'create_sales_receipt', idempotency_key: 'TEST-0001', doc_number: 'TEST-0001', qbo_id: '900', environment: 'sandbox', result: 'created' });
    const all = errSpy.mock.calls.flat().join('\n');
    expect(all).not.toContain('ChariotDonation');
    expect(all).not.toContain('mock-token');
  });

  it('logs a failure with a fault tag rather than the fault text', async () => {
    fake.postResponses.salesreceipt = { status: 400, body: { Fault: { Error: [{ Message: 'Duplicate', Detail: 'Jane Donor', code: '6240' }] } } };
    await createQuickbooksSalesReceipt(baseInput());
    const all = errSpy.mock.calls.flat().join('\n');
    expect(all).toContain('"error":"qbo_400_6240"');
    expect(all).not.toContain('Jane Donor');
  });

  it('logs environment "unknown" when the environment config is invalid', async () => {
    process.env.QBO_ENVIRONMENT = 'staging';
    const res = await createQuickbooksSalesReceipt(baseInput());
    expect(res.isError).toBe(true);
    expect(res.error).toContain('QBO_ENVIRONMENT must be');
    expect(errSpy.mock.calls.flat().join('\n')).toContain('"environment":"unknown"');
  });
});

describe('findQuickbooksSalesReceiptByDocNumber', () => {
  it('returns the receipt when found', async () => {
    fake.queryRows.SalesReceipt = [{ Id: '555', DocNumber: 'X' }];
    const res = await findQuickbooksSalesReceiptByDocNumber('X');
    expect(res).toEqual({ result: { Id: '555', DocNumber: 'X' }, isError: false, error: null });
  });

  it('returns null when not found', async () => {
    const res = await findQuickbooksSalesReceiptByDocNumber('nope');
    expect(res.result).toBeNull();
    expect(res.isError).toBe(false);
  });

  it('returns an error when authentication fails', async () => {
    (mockQuickbooksClient.authenticate as any).mockRejectedValue(new Error('Auth failed'));
    const res = await findQuickbooksSalesReceiptByDocNumber('X');
    expect(res.isError).toBe(true);
    expect(res.error).toContain('Auth failed');
  });
});

describe('voidQuickbooksSalesReceipt', () => {
  beforeEach(() => {
    fake.entities.set('SalesReceipt:900', { Id: '900', SyncToken: '3', DocNumber: 'TEST-0001', PrivateNote: 'HubSpotGift=TEST-0001' });
    fake.postResponses.salesreceipt = { body: { SalesReceipt: { Id: '900', SyncToken: '4', TotalAmt: 0 } } };
  });

  it('fetches the current SyncToken and voids via operation=update&include=void', async () => {
    const res = await voidQuickbooksSalesReceipt({ id: '900', reason: 'smoke test' });
    expect(res.result).toMatchObject({ status: 'voided', id: '900', doc_number: 'TEST-0001' });

    const get = fake.calls.find((c) => c.method === 'GET' && c.url.pathname.endsWith('/salesreceipt/900'));
    expect(get).toBeDefined();
    const posts = fake.posts();
    expect(posts).toHaveLength(1);
    expect(posts[0].url.searchParams.get('operation')).toBe('update');
    expect(posts[0].url.searchParams.get('include')).toBe('void');
    expect(posts[0].body).toEqual({
      Id: '900',
      SyncToken: '3',
      sparse: true,
      PrivateNote: `HubSpotGift=TEST-0001 | ${VOID_MARKER} smoke test`,
    });
  });

  it('is a dry run when writes are disabled', async () => {
    process.env.QBO_WRITE_ENABLED = 'false';
    const res = await voidQuickbooksSalesReceipt({ id: '900', reason: 'smoke test' });
    expect(res.result).toMatchObject({ status: 'dry_run', payload: { SyncToken: '3' } });
    expect(fake.posts()).toHaveLength(0);
  });

  it('refuses production voids without QBO_PRODUCTION_WRITES_CONFIRMED', async () => {
    process.env.QBO_ENVIRONMENT = 'production';
    const res = await voidQuickbooksSalesReceipt({ id: '900', reason: 'x' });
    expect(res.isError).toBe(true);
    expect(fake.calls).toHaveLength(0);
  });

  it('returns already_voided when the marker is present', async () => {
    fake.entities.set('SalesReceipt:900', { Id: '900', SyncToken: '4', PrivateNote: `x | ${VOID_MARKER} earlier` });
    const res = await voidQuickbooksSalesReceipt({ id: '900', reason: 'again' });
    expect(res.result!.status).toBe('already_voided');
    expect(fake.posts()).toHaveLength(0);
  });

  it('errors when the receipt does not exist', async () => {
    const res = await voidQuickbooksSalesReceipt({ id: '404', reason: 'x' });
    expect(res.isError).toBe(true);
    expect(res.error).toContain('does not exist');
    expect(fake.posts()).toHaveLength(0);
  });

  it('works when the receipt has no PrivateNote', async () => {
    fake.entities.set('SalesReceipt:900', { Id: '900', SyncToken: '3' });
    await voidQuickbooksSalesReceipt({ id: '900', reason: 'r' });
    expect(fake.posts()[0].body.PrivateNote).toBe(`${VOID_MARKER} r`);
  });

  it('refuses when the note would exceed 4000 characters', async () => {
    fake.entities.set('SalesReceipt:900', { Id: '900', SyncToken: '3', PrivateNote: 'x'.repeat(3990) });
    const res = await voidQuickbooksSalesReceipt({ id: '900', reason: 'long enough reason' });
    expect(res.isError).toBe(true);
    expect(res.error).toContain('max 4000');
    expect(fake.posts()).toHaveLength(0);
  });
});
