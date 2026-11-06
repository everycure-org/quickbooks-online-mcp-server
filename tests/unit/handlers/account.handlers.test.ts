import { jest, describe, it, expect, beforeEach } from '@jest/globals';
import { mockQuickbooksClient, mockQuickBooksInstance, resetAllMocks } from '../../mocks/quickbooks.mock';
import { describeCallbackHandler } from '../../mocks/callback-handler-cases';

jest.unstable_mockModule('../../../src/clients/quickbooks-client', () => ({
  quickbooksClient: mockQuickbooksClient,
}));

const { createQuickbooksAccount } = await import('../../../src/handlers/create-quickbooks-account.handler');
const { getQuickbooksAccount } = await import('../../../src/handlers/get-quickbooks-account.handler');
const { searchQuickbooksAccounts } = await import('../../../src/handlers/search-quickbooks-accounts.handler');
const { updateQuickbooksAccount } = await import('../../../src/handlers/update-quickbooks-account.handler');

function captureCall(method: keyof typeof mockQuickBooksInstance, response: unknown = { Id: '1' }) {
  const sent: any[] = [];
  (mockQuickBooksInstance[method] as any).mockImplementation((payload: any, cb: any) => {
    sent.push(payload);
    cb(null, response);
  });
  return sent;
}

describe('Account Handlers', () => {
  beforeEach(() => {
    resetAllMocks();
  });

  describe('createQuickbooksAccount', () => {
    describeCallbackHandler('callback contract', {
      invoke: () => createQuickbooksAccount({ name: 'Office', type: 'Expense' }),
      method: 'createAccount',
      expectedArgs: [{ Name: 'Office', AccountType: 'Expense' }],
    });

    it('maps every input field and drops the optional ones that are missing or null', async () => {
      const sent = captureCall('createAccount');

      await createQuickbooksAccount({ name: 'Bank Fees', type: 'Expense', sub_type: 'BankCharges', description: 'Monthly fees' });
      await createQuickbooksAccount({ name: 'Rent', type: 'Expense', sub_type: null as any });

      expect(sent[0]).toEqual({ Name: 'Bank Fees', AccountType: 'Expense', AccountSubType: 'BankCharges', Description: 'Monthly fees' });
      expect(sent[1]).toEqual({ Name: 'Rent', AccountType: 'Expense' });
    });

    it('coerces non-string values for string fields', async () => {
      const sent = captureCall('createAccount');

      await createQuickbooksAccount({ name: 1234 as any, type: 'Income' });

      expect(sent[0]).toEqual({ Name: '1234', AccountType: 'Income' });
    });

    // The handler only ever builds Name/AccountType/AccountSubType/Description, so the
    // boolean, number, passthrough and default branches of its normalizer cannot be
    // reached from the public input. Injecting extra entries into the payload walk is
    // the only way to exercise that coercion logic without changing src.
    it('coerces boolean, number and unknown fields when they appear in the payload', async () => {
      const realEntries = Object.entries;
      jest.spyOn(Object, 'entries').mockImplementation(((obj: any) => {
        const entries = realEntries(obj);
        if (obj && 'AccountType' in obj && 'Name' in obj) {
          entries.push(
            ['Active', 'true'],
            ['SubAccount', false],
            ['CurrentBalance', '12.5'],
            ['Classification', 'Expense'],
            ['ParentRef', 7],
            ['OpeningBalance', 3],
            ['constructor', 'kept as-is']
          );
        }
        return entries;
      }) as any);
      const sent = captureCall('createAccount');

      await createQuickbooksAccount({ name: 'Petty Cash', type: 'Bank' });

      expect(sent[0]).toEqual({
        Name: 'Petty Cash',
        AccountType: 'Bank',
        Active: true,
        SubAccount: false,
        CurrentBalance: 12.5,
        Classification: 'Expense',
        ParentRef: '7',
        OpeningBalance: 3,
        constructor: 'kept as-is',
      });
    });

    it('treats a numeric CurrentBalance and non-"true" boolean strings correctly', async () => {
      const realEntries = Object.entries;
      jest.spyOn(Object, 'entries').mockImplementation(((obj: any) => {
        const entries = realEntries(obj);
        if (obj && 'AccountType' in obj && 'Name' in obj) {
          entries.push(['CurrentBalance', 42], ['Active', 'yes']);
        }
        return entries;
      }) as any);
      const sent = captureCall('createAccount');

      await createQuickbooksAccount({ name: 'Savings', type: 'Bank' });

      expect(sent[0]).toMatchObject({ CurrentBalance: 42, Active: false });
    });
  });

  describeCallbackHandler('getQuickbooksAccount', {
    invoke: () => getQuickbooksAccount('33'),
    method: 'getAccount',
    expectedArgs: ['33'],
    response: { Id: '33', Name: 'Checking' },
  });

  describe('searchQuickbooksAccounts', () => {
    describeCallbackHandler('callback contract', {
      invoke: () => searchQuickbooksAccounts({ filters: [{ field: 'AccountType', value: 'Bank' }], limit: 10 }),
      method: 'findAccounts',
      expectedArgs: [[
        { field: 'AccountType', value: 'Bank', operator: undefined },
        { field: 'limit', value: 10 },
      ]],
      response: { QueryResponse: { Account: [{ Id: '1' }, { Id: '2' }] } },
      expectedResult: [{ Id: '1' }, { Id: '2' }],
    });

    it('returns an empty list when QBO returns no Account array', async () => {
      (mockQuickBooksInstance.findAccounts as any).mockImplementation((_c: any, cb: any) => cb(null, { QueryResponse: {} }));

      const res = await searchQuickbooksAccounts({ Name: 'Nope' });

      expect(mockQuickBooksInstance.findAccounts.mock.calls[0][0]).toEqual({ Name: 'Nope' });
      expect(res).toEqual({ result: [], isError: false, error: null });
    });
  });

  describe('updateQuickbooksAccount', () => {
    const existing = { Id: '33', SyncToken: '4', Name: 'Checking', AccountType: 'Bank', Active: true };

    function stubExisting() {
      (mockQuickBooksInstance.getAccount as any).mockImplementation((_id: any, cb: any) => cb(null, existing));
    }

    it('merges the normalized patch onto the fetched account as a sparse update', async () => {
      stubExisting();
      const sent = captureCall('updateAccount', { Id: '33', SyncToken: '5' });

      const res = await updateQuickbooksAccount({
        account_id: '33',
        patch: {
          Name: 99,
          Description: 'Main account',
          Active: 'false',
          SubAccount: true,
          CurrentBalance: '100.25',
          Classification: undefined,
          ParentRef: 12,
          CustomField: { a: 1 },
        },
      });

      expect(mockQuickBooksInstance.getAccount.mock.calls[0][0]).toBe('33');
      expect(sent[0]).toEqual({
        ...existing,
        Name: '99',
        Description: 'Main account',
        Active: false,
        SubAccount: true,
        CurrentBalance: 100.25,
        ParentRef: '12',
        CustomField: { a: 1 },
        Id: '33',
        sparse: true,
      });
      expect(sent[0]).not.toHaveProperty('Classification');
      expect(res).toEqual({ result: { Id: '33', SyncToken: '5' }, isError: false, error: null });
    });

    it('keeps numeric balances and string "true" booleans', async () => {
      stubExisting();
      const sent = captureCall('updateAccount');

      await updateQuickbooksAccount({ account_id: '33', patch: { CurrentBalance: 7, Active: 'true' } });

      expect(sent[0]).toMatchObject({ CurrentBalance: 7, Active: true });
    });

    it('passes keys that resolve through the prototype of the type map through unchanged', async () => {
      stubExisting();
      const sent = captureCall('updateAccount');

      await updateQuickbooksAccount({ account_id: '33', patch: { constructor: 'raw' } as any });

      expect(sent[0].constructor).toBe('raw');
    });

    it('does not overwrite Id even when the patch carries a different one', async () => {
      stubExisting();
      const sent = captureCall('updateAccount');

      await updateQuickbooksAccount({ account_id: '33', patch: { Id: '999' } });

      expect(sent[0].Id).toBe('33');
    });

    it('returns an error when the existing account cannot be fetched', async () => {
      (mockQuickBooksInstance.getAccount as any).mockImplementation((_id: any, cb: any) => cb(new Error('Object Not Found'), null));

      const res = await updateQuickbooksAccount({ account_id: '404', patch: { Name: 'x' } });

      expect(res).toEqual({ result: null, isError: true, error: 'Error: Object Not Found' });
      expect(mockQuickBooksInstance.updateAccount).not.toHaveBeenCalled();
    });

    it('returns an error when QBO rejects the update', async () => {
      stubExisting();
      (mockQuickBooksInstance.updateAccount as any).mockImplementation((_p: any, cb: any) => cb(new Error('Stale Object'), null));

      const res = await updateQuickbooksAccount({ account_id: '33', patch: { Name: 'x' } });

      expect(res).toEqual({ result: null, isError: true, error: 'Error: Stale Object' });
    });

    it('returns an error when authentication fails', async () => {
      (mockQuickbooksClient.authenticate as any).mockRejectedValue(new Error('Auth failed'));

      const res = await updateQuickbooksAccount({ account_id: '33', patch: {} });

      expect(res).toEqual({ result: null, isError: true, error: 'Error: Auth failed' });
      expect(mockQuickBooksInstance.getAccount).not.toHaveBeenCalled();
    });
  });
});
