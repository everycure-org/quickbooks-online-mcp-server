import { jest, describe, it, expect, beforeEach } from '@jest/globals';
import { mockQuickbooksClient, mockQuickBooksInstance, resetAllMocks } from '../../mocks/quickbooks.mock';
import { describeCallbackHandler } from '../../mocks/callback-handler-cases';

jest.unstable_mockModule('../../../src/clients/quickbooks-client', () => ({
  quickbooksClient: mockQuickbooksClient,
}));

const { createQuickbooksItem } = await import('../../../src/handlers/create-quickbooks-item.handler');
const { readQuickbooksItem } = await import('../../../src/handlers/read-quickbooks-item.handler');
const { updateQuickbooksItem } = await import('../../../src/handlers/update-quickbooks-item.handler');
const { deleteQuickbooksItem } = await import('../../../src/handlers/delete-quickbooks-item.handler');
const { searchQuickbooksItems } = await import('../../../src/handlers/search-quickbooks-items.handler');

const qb = mockQuickBooksInstance as any;

function captureCall(method: string, response: unknown = { Id: '1' }) {
  const sent: any[] = [];
  qb[method].mockImplementation((payload: any, cb: any) => {
    sent.push(payload);
    cb(null, response);
  });
  return sent;
}

describe('Item Handlers', () => {
  beforeEach(() => {
    resetAllMocks();
  });

  describe('createQuickbooksItem', () => {
    describeCallbackHandler('callback contract', {
      invoke: () => createQuickbooksItem({ name: 'Consulting', type: 'Service', income_account_ref: '79' }),
      method: 'createItem',
      expectedArgs: [{
        Name: 'Consulting',
        Type: 'Service',
        IncomeAccountRef: { value: '79' },
        ExpenseAccountRef: undefined,
        UnitPrice: undefined,
        Description: undefined,
      }],
      response: { Id: '21', Name: 'Consulting' },
    });

    it('includes the expense account, price and description when provided', async () => {
      const sent = captureCall('createItem');

      await createQuickbooksItem({
        name: 'Widget',
        type: 'NonInventory',
        income_account_ref: '79',
        expense_account_ref: '80',
        unit_price: 12.5,
        description: 'Blue widget',
      });

      expect(sent[0]).toEqual({
        Name: 'Widget',
        Type: 'NonInventory',
        IncomeAccountRef: { value: '79' },
        ExpenseAccountRef: { value: '80' },
        UnitPrice: 12.5,
        Description: 'Blue widget',
      });
    });
  });

  describeCallbackHandler('readQuickbooksItem', {
    invoke: () => readQuickbooksItem('21'),
    method: 'getItem',
    expectedArgs: ['21'],
    response: { Id: '21', Name: 'Consulting' },
  });

  describe('updateQuickbooksItem', () => {
    it('merges the patch onto the fetched item as a sparse update', async () => {
      qb.getItem.mockImplementation((_id: any, cb: any) => cb(null, { Id: '21', SyncToken: '1', Name: 'Consulting', UnitPrice: 100 }));
      const sent = captureCall('updateItem', { Id: '21', SyncToken: '2', UnitPrice: 150 });

      const res = await updateQuickbooksItem({ item_id: '21', patch: { UnitPrice: 150, Id: 'ignored' } });

      expect(qb.getItem.mock.calls[0][0]).toBe('21');
      expect(sent[0]).toEqual({ Id: '21', SyncToken: '1', Name: 'Consulting', UnitPrice: 150, sparse: true });
      expect(res).toEqual({ result: { Id: '21', SyncToken: '2', UnitPrice: 150 }, isError: false, error: null });
    });

    it('returns an error when the item cannot be fetched', async () => {
      qb.getItem.mockImplementation((_id: any, cb: any) => cb(new Error('Object Not Found'), null));

      const res = await updateQuickbooksItem({ item_id: '404', patch: {} });

      expect(res).toEqual({ result: null, isError: true, error: 'Error: Object Not Found' });
      expect(qb.updateItem).not.toHaveBeenCalled();
    });

    it('returns an error when QBO rejects the update', async () => {
      qb.getItem.mockImplementation((_id: any, cb: any) => cb(null, { Id: '21', SyncToken: '1' }));
      qb.updateItem.mockImplementation((_p: any, cb: any) => cb(new Error('Duplicate Name Exists Error'), null));

      const res = await updateQuickbooksItem({ item_id: '21', patch: { Name: 'Taken' } });

      expect(res).toEqual({ result: null, isError: true, error: 'Error: Duplicate Name Exists Error' });
    });

    it('returns an error when authentication fails', async () => {
      (mockQuickbooksClient.authenticate as any).mockRejectedValue(new Error('Auth failed'));

      const res = await updateQuickbooksItem({ item_id: '21', patch: {} });

      expect(res).toEqual({ result: null, isError: true, error: 'Error: Auth failed' });
      expect(qb.getItem).not.toHaveBeenCalled();
    });
  });

  describe('deleteQuickbooksItem', () => {
    it('marks a supplied item entity inactive without fetching it', async () => {
      const sent = captureCall('updateItem', { Id: '21', Active: false });

      const res = await deleteQuickbooksItem({ Id: '21', SyncToken: '3', Name: 'Consulting' });

      expect(qb.getItem).not.toHaveBeenCalled();
      expect(sent).toEqual([{ Id: '21', SyncToken: '3', Active: false, sparse: true }]);
      expect(res).toEqual({ result: { Id: '21', Active: false }, isError: false, error: null });
    });

    it('fetches the item by id to get the latest SyncToken', async () => {
      qb.getItem.mockImplementation((_id: any, cb: any) => cb(null, { Id: '21', SyncToken: '7' }));
      const sent = captureCall('updateItem');

      await deleteQuickbooksItem('21');

      expect(qb.getItem.mock.calls[0][0]).toBe('21');
      expect(sent).toEqual([{ Id: '21', SyncToken: '7', Active: false, sparse: true }]);
    });

    it('reports an error when the item cannot be retrieved', async () => {
      qb.getItem.mockImplementation((_id: any, cb: any) => cb(new Error('Object Not Found'), null));

      const res = await deleteQuickbooksItem(null);

      expect(qb.getItem.mock.calls[0][0]).toBeNull();
      expect(res).toEqual({ result: null, isError: true, error: 'Error: Unable to retrieve item for inactive update' });
      expect(qb.updateItem).not.toHaveBeenCalled();
    });

    it('reports an error when the fetched item has no Id', async () => {
      qb.getItem.mockImplementation((_id: any, cb: any) => cb(null, { SyncToken: '1' }));

      const res = await deleteQuickbooksItem({ Name: 'No id' });

      expect(qb.getItem.mock.calls[0][0]).toEqual({ Name: 'No id' });
      expect(res.isError).toBe(true);
    });

    it('returns the QBO error when the inactive update fails', async () => {
      qb.updateItem.mockImplementation((_p: any, cb: any) => cb(new Error('Stale Object'), null));

      const res = await deleteQuickbooksItem({ Id: '21', SyncToken: '1' });

      expect(res).toEqual({ result: null, isError: true, error: 'Error: Stale Object' });
    });

    it('returns an error when authentication fails', async () => {
      (mockQuickbooksClient.authenticate as any).mockRejectedValue(new Error('Auth failed'));

      const res = await deleteQuickbooksItem('21');

      expect(res).toEqual({ result: null, isError: true, error: 'Error: Auth failed' });
    });
  });

  describe('searchQuickbooksItems', () => {
    describeCallbackHandler('callback contract', {
      invoke: () => searchQuickbooksItems({ filters: [{ field: 'Type', value: 'Service' }], asc: 'Name' }),
      method: 'findItems',
      expectedArgs: [[
        { field: 'Type', value: 'Service', operator: undefined },
        { field: 'asc', value: 'Name' },
      ]],
      response: { QueryResponse: { Item: [{ Id: '21' }] } },
      expectedResult: [{ Id: '21' }],
    });

    it('returns an empty list when QBO returns no Item array', async () => {
      qb.findItems.mockImplementation((_c: any, cb: any) => cb(null, { QueryResponse: {} }));

      const res = await searchQuickbooksItems({ Name: 'Nope' });

      expect(qb.findItems.mock.calls[0][0]).toEqual({ Name: 'Nope' });
      expect(res).toEqual({ result: [], isError: false, error: null });
    });
  });
});
