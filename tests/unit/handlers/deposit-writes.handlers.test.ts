import { jest, describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import { mockQuickbooksClient, resetAllMocks } from '../../mocks/quickbooks.mock';
import { createFakeQbo, FakeQbo } from '../../mocks/qbo-fetch.mock';

jest.unstable_mockModule('../../../src/clients/quickbooks-client', () => ({
  quickbooksClient: mockQuickbooksClient,
}));

const { createQuickbooksDeposit, buildDepositPayload, depositIdsOf } = await import(
  '../../../src/handlers/create-quickbooks-deposit.handler'
);

const ENV_KEYS = ['QBO_ENVIRONMENT', 'QUICKBOOKS_ENVIRONMENT', 'QBO_WRITE_ENABLED', 'QBO_PRODUCTION_WRITES_CONFIRMED'];
const BANK = '91';
const UNDEPOSITED = '4';

let fake: FakeQbo;
let errSpy: any;
const savedEnv: Record<string, string | undefined> = {};

const receipt = (id: string, doc: string, total: number, extra: Record<string, any> = {}) => ({
  Id: id,
  DocNumber: doc,
  TotalAmt: total,
  DepositToAccountRef: { value: UNDEPOSITED, name: '1410' },
  PrivateNote: `HubSpotGift=${doc}`,
  ...extra,
});

function baseInput(overrides: Record<string, any> = {}) {
  return {
    idempotency_key: 'deposit_test',
    txn_date: '2026-11-16',
    deposit_to_account_id: BANK,
    sales_receipt_doc_numbers: ['G-1', 'G-2'],
    expected_total: 315.34,
    private_note: 'ChariotDeposit=deposit_test',
    dry_run: false,
    ...overrides,
  };
}

beforeEach(() => {
  resetAllMocks();
  for (const k of ENV_KEYS) {
    savedEnv[k] = process.env[k];
    delete process.env[k];
  }
  process.env.QBO_ENVIRONMENT = 'sandbox';
  process.env.QBO_WRITE_ENABLED = 'true';
  fake = createFakeQbo();
  (globalThis as any).fetch = fake.fetch;
  fake.entities.set(`Account:${BANK}`, { Id: BANK, Active: true, AccountType: 'Bank', AccountSubType: 'Checking' });
  fake.entities.set(`Account:${UNDEPOSITED}`, { Id: UNDEPOSITED, Active: true, AccountType: 'Other Current Asset', AccountSubType: 'UndepositedFunds' });
  fake.queryRows.SalesReceipt = [receipt('173', 'G-1', 215.34), receipt('174', 'G-2', 100)];
  fake.postResponses.deposit = { body: { Deposit: { Id: '500', TotalAmt: 315.34, TxnDate: '2026-11-16' } } };
  errSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[k];
  }
});

describe('buildDepositPayload', () => {
  it('links each sales receipt as its own line at the receipt total', () => {
    const payload = buildDepositPayload(baseInput(), [
      { id: '173', doc_number: 'G-1', amount: 215.34 },
      { id: '174', doc_number: 'G-2', amount: 100 },
    ]);
    expect(payload).toEqual({
      TxnDate: '2026-11-16',
      DepositToAccountRef: { value: BANK },
      PrivateNote: 'ChariotDeposit=deposit_test',
      Line: [
        { Amount: 215.34, LinkedTxn: [{ TxnId: '173', TxnType: 'SalesReceipt', TxnLineId: '0' }] },
        { Amount: 100, LinkedTxn: [{ TxnId: '174', TxnType: 'SalesReceipt', TxnLineId: '0' }] },
      ],
    });
  });

  it('depositIdsOf reads only Deposit links', () => {
    expect(depositIdsOf({ LinkedTxn: [{ TxnType: 'Deposit', TxnId: 62 }, { TxnType: 'Invoice', TxnId: 1 }] })).toEqual(['62']);
    expect(depositIdsOf({})).toEqual([]);
  });
});

describe('createQuickbooksDeposit', () => {
  it('creates the deposit with requestid and returns status created', async () => {
    const res = await createQuickbooksDeposit(baseInput());
    expect(res.isError).toBe(false);
    expect(res.result).toMatchObject({
      status: 'created',
      id: '500',
      total_amt: 315.34,
      deposit_to_account_id: BANK,
      sales_receipts: [
        { id: '173', doc_number: 'G-1', amount: 215.34 },
        { id: '174', doc_number: 'G-2', amount: 100 },
      ],
    });
    const posts = fake.posts();
    expect(posts).toHaveLength(1);
    expect(posts[0].url.pathname).toBe('/v3/company/mock-realm-id/deposit');
    expect(posts[0].url.searchParams.get('requestid')).toBe('deposit_test');
    expect(posts[0].url.searchParams.get('minorversion')).toBe('75');
    expect(posts[0].body.Line).toHaveLength(2);
  });

  it('dry_run validates and returns the payload without POSTing', async () => {
    const res = await createQuickbooksDeposit(baseInput({ dry_run: true }));
    expect(res.result).toMatchObject({ status: 'dry_run', id: null, total_amt: 315.34 });
    expect(res.result!.dry_run_reason).toBeUndefined();
    expect(fake.posts()).toHaveLength(0);
  });

  it('dry_run defaults to true', async () => {
    const { dry_run, ...input } = baseInput();
    const res = await createQuickbooksDeposit(input as any);
    expect(res.result!.status).toBe('dry_run');
    expect(fake.posts()).toHaveLength(0);
  });

  it('QBO_WRITE_ENABLED=false forces a dry run', async () => {
    process.env.QBO_WRITE_ENABLED = 'false';
    const res = await createQuickbooksDeposit(baseInput());
    expect(res.result).toMatchObject({ status: 'dry_run', dry_run_reason: expect.stringContaining('QBO_WRITE_ENABLED') });
    expect(fake.posts()).toHaveLength(0);
  });

  it('refuses production writes without QBO_PRODUCTION_WRITES_CONFIRMED', async () => {
    process.env.QBO_ENVIRONMENT = 'production';
    const res = await createQuickbooksDeposit(baseInput());
    expect(res.isError).toBe(true);
    expect(res.error).toContain('QBO_PRODUCTION_WRITES_CONFIRMED');
    expect(fake.calls).toHaveLength(0);
  });

  it('returns already_exists when every receipt is in the same deposit with the same set', async () => {
    fake.queryRows.SalesReceipt = [
      receipt('173', 'G-1', 215.34, { LinkedTxn: [{ TxnId: '500', TxnType: 'Deposit' }] }),
      receipt('174', 'G-2', 100, { LinkedTxn: [{ TxnId: '500', TxnType: 'Deposit' }] }),
    ];
    fake.entities.set('Deposit:500', {
      Id: '500', TotalAmt: 315.34, TxnDate: '2026-11-16', DepositToAccountRef: { value: BANK },
      Line: [
        { Amount: 215.34, LinkedTxn: [{ TxnId: '173', TxnType: 'SalesReceipt' }] },
        { Amount: 100, LinkedTxn: [{ TxnId: '174', TxnType: 'SalesReceipt' }] },
      ],
    });
    const res = await createQuickbooksDeposit(baseInput());
    expect(res.result).toMatchObject({ status: 'already_exists', id: '500', total_amt: 315.34, deposit_to_account_id: BANK });
    expect(fake.posts()).toHaveLength(0);
  });

  it('refuses when the receipts sit in a deposit that links a different set', async () => {
    fake.queryRows.SalesReceipt = [
      receipt('173', 'G-1', 215.34, { LinkedTxn: [{ TxnId: '500', TxnType: 'Deposit' }] }),
      receipt('174', 'G-2', 100, { LinkedTxn: [{ TxnId: '500', TxnType: 'Deposit' }] }),
    ];
    fake.entities.set('Deposit:500', {
      Id: '500', Line: [{ Amount: 215.34, LinkedTxn: [{ TxnId: '173', TxnType: 'SalesReceipt' }] }],
    });
    const res = await createQuickbooksDeposit(baseInput());
    expect(res.isError).toBe(true);
    expect(res.error).toContain('links a different set of receipts');
    expect(fake.posts()).toHaveLength(0);
  });

  it('ignores non-linked lines on the existing deposit when comparing sets', async () => {
    fake.queryRows.SalesReceipt = [
      receipt('173', 'G-1', 215.34, { LinkedTxn: [{ TxnId: '500', TxnType: 'Deposit' }] }),
      receipt('174', 'G-2', 100, { LinkedTxn: [{ TxnId: '500', TxnType: 'Deposit' }] }),
    ];
    fake.entities.set('Deposit:500', {
      Id: '500', TotalAmt: 315.34,
      Line: [
        { Amount: 215.34, LinkedTxn: [{ TxnId: '173', TxnType: 'SalesReceipt' }] },
        { Amount: 100, LinkedTxn: [{ TxnId: '174', TxnType: 'SalesReceipt' }] },
        { Amount: 0, DetailType: 'DepositLineDetail' },
      ],
    });
    const res = await createQuickbooksDeposit(baseInput());
    expect(res.result!.status).toBe('already_exists');
  });

  it('treats an existing deposit with no lines as a different set', async () => {
    fake.queryRows.SalesReceipt = [
      receipt('173', 'G-1', 215.34, { LinkedTxn: [{ TxnId: '500', TxnType: 'Deposit' }] }),
      receipt('174', 'G-2', 100, { LinkedTxn: [{ TxnId: '500', TxnType: 'Deposit' }] }),
    ];
    fake.entities.set('Deposit:500', { Id: '500' });
    const res = await createQuickbooksDeposit(baseInput());
    expect(res.isError).toBe(true);
    expect(res.error).toContain('links a different set of receipts');
  });

  it('errors when the linked deposit cannot be read', async () => {
    fake.queryRows.SalesReceipt = [
      receipt('173', 'G-1', 215.34, { LinkedTxn: [{ TxnId: '999', TxnType: 'Deposit' }] }),
      receipt('174', 'G-2', 100, { LinkedTxn: [{ TxnId: '999', TxnType: 'Deposit' }] }),
    ];
    const res = await createQuickbooksDeposit(baseInput());
    expect(res.isError).toBe(true);
    expect(res.error).toContain('deposit 999, which could not be read');
  });

  const invalid: Array<[string, () => void, Record<string, any>, string]> = [
    ['a receipt is missing', () => {}, { sales_receipt_doc_numbers: ['G-1', 'NOPE'] }, 'sales receipt NOPE does not exist'],
    ['doc numbers repeat', () => {}, { sales_receipt_doc_numbers: ['G-1', 'G-1'] }, 'duplicate doc numbers: G-1'],
    ['the total does not match', () => {}, { expected_total: 315.35 }, 'sales receipts total 315.34 but expected_total is 315.35'],
    ['expected_total is not positive', () => {}, { expected_total: 0 }, 'expected_total must be greater than 0'],
    ['expected_total has 3 decimals', () => {}, { expected_total: 315.341 }, 'more than 2 decimal places'],
    ['the bank account is missing', () => {}, { deposit_to_account_id: '404' }, 'deposit account 404 does not exist'],
    ['the target is not a Bank account', () => {}, { deposit_to_account_id: UNDEPOSITED }, 'only Bank accounts are allowed'],
    ['the bank account is inactive', () => fake.entities.set(`Account:${BANK}`, { Id: BANK, Active: false, AccountType: 'Bank' }), {}, 'is inactive'],
    ['a receipt is voided', () => { fake.queryRows.SalesReceipt[1] = receipt('174', 'G-2', 0, { PrivateNote: 'Voided - HubSpotGift=G-2' }); }, { expected_total: 215.34 }, 'sales receipt G-2 is voided'],
    ['a receipt has a zero total', () => { fake.queryRows.SalesReceipt[1] = receipt('174', 'G-2', 0); }, { expected_total: 215.34 }, 'has a total of 0'],
    ['a receipt went straight to a bank account', () => { fake.queryRows.SalesReceipt[1] = receipt('174', 'G-2', 100, { DepositToAccountRef: { value: BANK } }); }, {}, 'G-2 were not posted to Undeposited Funds'],
    ['a receipt has no deposit account', () => { fake.queryRows.SalesReceipt[1] = receipt('174', 'G-2', 100, { DepositToAccountRef: undefined }); }, {}, 'G-2 has no deposit account'],
    ['one receipt is already in another deposit', () => { fake.queryRows.SalesReceipt[1] = receipt('174', 'G-2', 100, { LinkedTxn: [{ TxnId: '62', TxnType: 'Deposit' }] }); }, {}, 'already in a deposit: G-2 (deposit 62)'],
    ['receipts are spread over two deposits', () => {
      fake.queryRows.SalesReceipt = [
        receipt('173', 'G-1', 215.34, { LinkedTxn: [{ TxnId: '61', TxnType: 'Deposit' }] }),
        receipt('174', 'G-2', 100, { LinkedTxn: [{ TxnId: '62', TxnType: 'Deposit' }] }),
      ];
    }, {}, 'already in a deposit'],
  ];

  it.each(invalid)('refuses when %s and makes no write call', async (_label, setup, overrides, expected) => {
    setup();
    const res = await createQuickbooksDeposit(baseInput(overrides));
    expect(res.isError).toBe(true);
    expect(res.error).toContain(expected);
    expect(fake.posts()).toHaveLength(0);
  });

  it('reports QBO faults from the POST', async () => {
    fake.postResponses.deposit = { status: 400, body: { Fault: { Error: [{ Message: 'Business Validation Error', code: '6000' }] } } };
    const res = await createQuickbooksDeposit(baseInput());
    expect(res.isError).toBe(true);
    expect(res.error).toContain('[6000] Business Validation Error');
  });

  it('logs identifiers only', async () => {
    await createQuickbooksDeposit(baseInput());
    const lines = errSpy.mock.calls.map((c: any[]) => String(c[0])).filter((l: string) => l.startsWith('[qbo-write] {'));
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0].slice('[qbo-write] '.length))).toMatchObject({
      tool: 'create_deposit', idempotency_key: 'deposit_test', qbo_id: '500', environment: 'sandbox', result: 'created',
    });
    expect(errSpy.mock.calls.flat().join('\n')).not.toContain('mock-token');
  });
});
