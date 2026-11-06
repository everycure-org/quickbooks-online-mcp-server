import { jest, describe, it, expect, beforeEach } from '@jest/globals';
import { mockQuickbooksClient, mockQuickBooksInstance, resetAllMocks } from '../../mocks/quickbooks.mock';
import { describeCallbackHandler } from '../../mocks/callback-handler-cases';

jest.unstable_mockModule('../../../src/clients/quickbooks-client', () => ({
  quickbooksClient: mockQuickbooksClient,
}));

const { createQuickbooksEmployee } = await import('../../../src/handlers/create-quickbooks-employee.handler');
const { getQuickbooksEmployee } = await import('../../../src/handlers/get-quickbooks-employee.handler');
const { updateQuickbooksEmployee } = await import('../../../src/handlers/update-quickbooks-employee.handler');
const { deleteQuickbooksEmployee } = await import('../../../src/handlers/delete-quickbooks-employee.handler');
const { createQuickbooksJournalEntry } = await import('../../../src/handlers/create-quickbooks-journal-entry.handler');
const { getQuickbooksJournalEntry } = await import('../../../src/handlers/get-quickbooks-journal-entry.handler');
const { updateQuickbooksJournalEntry } = await import('../../../src/handlers/update-quickbooks-journal-entry.handler');
const { deleteQuickbooksJournalEntry } = await import('../../../src/handlers/delete-quickbooks-journal-entry.handler');
const { searchQuickbooksJournalEntries } = await import('../../../src/handlers/search-quickbooks-journal-entries.handler');

describe('Employee Handlers', () => {
  beforeEach(() => {
    resetAllMocks();
  });

  const employee = { GivenName: 'Ada', FamilyName: 'Lovelace', PrimaryEmailAddr: { Address: 'ada@example.com' } };

  describeCallbackHandler('createQuickbooksEmployee', {
    invoke: () => createQuickbooksEmployee(employee),
    method: 'createEmployee',
    expectedArgs: [employee],
    response: { Id: '55', ...employee },
  });

  describeCallbackHandler('getQuickbooksEmployee', {
    invoke: () => getQuickbooksEmployee('55'),
    method: 'getEmployee',
    expectedArgs: ['55'],
    response: { Id: '55', DisplayName: 'Ada Lovelace' },
  });

  describeCallbackHandler('updateQuickbooksEmployee', {
    invoke: () => updateQuickbooksEmployee({ Id: '55', SyncToken: '0', sparse: true, Title: 'Engineer' }),
    method: 'updateEmployee',
    expectedArgs: [{ Id: '55', SyncToken: '0', sparse: true, Title: 'Engineer' }],
    response: { Id: '55', SyncToken: '1', Title: 'Engineer' },
  });

  describe('deleteQuickbooksEmployee', () => {
    function stubUpdate(response: unknown = { Id: '55', Active: false }) {
      const sent: any[] = [];
      (mockQuickBooksInstance.updateEmployee as any).mockImplementation((payload: any, cb: any) => {
        sent.push(payload);
        cb(null, response);
      });
      return sent;
    }

    it('marks a supplied employee entity inactive without fetching it', async () => {
      const sent = stubUpdate();

      const res = await deleteQuickbooksEmployee({ Id: '55', SyncToken: '3', GivenName: 'Ada' });

      expect(mockQuickBooksInstance.getEmployee).not.toHaveBeenCalled();
      expect(sent).toEqual([{ Id: '55', SyncToken: '3', Active: false, sparse: true }]);
      expect(res).toEqual({ result: { Id: '55', Active: false }, isError: false, error: null });
    });

    it('fetches the employee by id to get the latest SyncToken', async () => {
      (mockQuickBooksInstance.getEmployee as any).mockImplementation((_id: any, cb: any) => cb(null, { Id: '55', SyncToken: '8' }));
      const sent = stubUpdate();

      await deleteQuickbooksEmployee('55');

      expect(mockQuickBooksInstance.getEmployee.mock.calls[0][0]).toBe('55');
      expect(sent).toEqual([{ Id: '55', SyncToken: '8', Active: false, sparse: true }]);
    });

    it('fetches by value when an object without an Id is supplied', async () => {
      (mockQuickBooksInstance.getEmployee as any).mockImplementation((_id: any, cb: any) => cb(null, undefined));

      const res = await deleteQuickbooksEmployee({ DisplayName: 'Ada' });

      expect(mockQuickBooksInstance.getEmployee.mock.calls[0][0]).toEqual({ DisplayName: 'Ada' });
      expect(res).toEqual({ result: null, isError: true, error: 'Error: Unable to retrieve employee for inactive update' });
    });

    it('reports an error when the fetched employee has no Id', async () => {
      (mockQuickBooksInstance.getEmployee as any).mockImplementation((_id: any, cb: any) => cb(new Error('Object Not Found'), { SyncToken: '1' }));

      const res = await deleteQuickbooksEmployee(null);

      expect(mockQuickBooksInstance.getEmployee.mock.calls[0][0]).toBeNull();
      expect(res).toEqual({ result: null, isError: true, error: 'Error: Unable to retrieve employee for inactive update' });
      expect(mockQuickBooksInstance.updateEmployee).not.toHaveBeenCalled();
    });

    it('returns the QBO error when the inactive update fails', async () => {
      (mockQuickBooksInstance.updateEmployee as any).mockImplementation((_p: any, cb: any) => cb(new Error('Stale Object'), null));

      const res = await deleteQuickbooksEmployee({ Id: '55', SyncToken: '1' });

      expect(res).toEqual({ result: null, isError: true, error: 'Error: Stale Object' });
    });

    it('returns an error when authentication fails', async () => {
      (mockQuickbooksClient.authenticate as any).mockRejectedValue(new Error('Auth failed'));

      const res = await deleteQuickbooksEmployee('55');

      expect(res).toEqual({ result: null, isError: true, error: 'Error: Auth failed' });
      expect(mockQuickBooksInstance.updateEmployee).not.toHaveBeenCalled();
    });
  });
});

describe('Journal Entry Handlers', () => {
  beforeEach(() => {
    resetAllMocks();
  });

  const journalEntry = {
    Line: [
      { Amount: 50, DetailType: 'JournalEntryLineDetail', JournalEntryLineDetail: { PostingType: 'Debit', AccountRef: { value: '1' } } },
      { Amount: 50, DetailType: 'JournalEntryLineDetail', JournalEntryLineDetail: { PostingType: 'Credit', AccountRef: { value: '2' } } },
    ],
  };

  describeCallbackHandler('createQuickbooksJournalEntry', {
    invoke: () => createQuickbooksJournalEntry(journalEntry),
    method: 'createJournalEntry',
    expectedArgs: [journalEntry],
    response: { Id: '77', ...journalEntry },
  });

  describeCallbackHandler('getQuickbooksJournalEntry', {
    invoke: () => getQuickbooksJournalEntry('77'),
    method: 'getJournalEntry',
    expectedArgs: ['77'],
    response: { Id: '77', TotalAmt: 50 },
  });

  describeCallbackHandler('updateQuickbooksJournalEntry', {
    invoke: () => updateQuickbooksJournalEntry({ Id: '77', SyncToken: '0', sparse: true, PrivateNote: 'accrual' }),
    method: 'updateJournalEntry',
    expectedArgs: [{ Id: '77', SyncToken: '0', sparse: true, PrivateNote: 'accrual' }],
    response: { Id: '77', SyncToken: '1' },
  });

  describeCallbackHandler('deleteQuickbooksJournalEntry', {
    invoke: () => deleteQuickbooksJournalEntry({ Id: '77', SyncToken: '1' }),
    method: 'deleteJournalEntry',
    expectedArgs: [{ Id: '77', SyncToken: '1' }],
    response: { JournalEntry: { Id: '77', status: 'Deleted' } },
  });

  describeCallbackHandler('searchQuickbooksJournalEntries', {
    invoke: () => searchQuickbooksJournalEntries({ filters: [{ field: 'TxnDate', value: '2026-01-01', operator: '>=' }], asc: 'TxnDate', fetchAll: true }),
    method: 'findJournalEntries',
    expectedArgs: [[
      { field: 'TxnDate', value: '2026-01-01', operator: '>=' },
      { field: 'asc', value: 'TxnDate' },
      { field: 'fetchAll', value: true },
    ]],
    response: { QueryResponse: { JournalEntry: [{ Id: '77' }] } },
  });
});
