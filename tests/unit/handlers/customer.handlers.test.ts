import { jest, describe, it, expect, beforeEach } from '@jest/globals';
import { mockQuickbooksClient, mockQuickBooksInstance, resetAllMocks } from '../../mocks/quickbooks.mock';
import { describeCallbackHandler } from '../../mocks/callback-handler-cases';

jest.unstable_mockModule('../../../src/clients/quickbooks-client', () => ({
  quickbooksClient: mockQuickbooksClient,
}));

const { getQuickbooksCustomer } = await import('../../../src/handlers/get-quickbooks-customer.handler');
const { updateQuickbooksCustomer } = await import('../../../src/handlers/update-quickbooks-customer.handler');
const { deleteQuickbooksCustomer } = await import('../../../src/handlers/delete-quickbooks-customer.handler');
const { searchQuickbooksCustomers } = await import('../../../src/handlers/search-quickbooks-customers.handler');

const qb = mockQuickBooksInstance as any;

describe('Customer Handlers', () => {
  beforeEach(() => {
    resetAllMocks();
  });

  describeCallbackHandler('getQuickbooksCustomer', {
    invoke: () => getQuickbooksCustomer('58'),
    method: 'getCustomer',
    expectedArgs: ['58'],
    response: { Id: '58', DisplayName: 'Acme' },
  });

  describeCallbackHandler('updateQuickbooksCustomer', {
    invoke: () => updateQuickbooksCustomer({ Id: '58', SyncToken: '2', sparse: true, CompanyName: 'Acme Corp' }),
    method: 'updateCustomer',
    expectedArgs: [{ Id: '58', SyncToken: '2', sparse: true, CompanyName: 'Acme Corp' }],
    response: { Id: '58', SyncToken: '3', CompanyName: 'Acme Corp' },
  });

  describe('deleteQuickbooksCustomer', () => {
    function stubUpdate(response: unknown = { Id: '58', Active: false }) {
      const sent: any[] = [];
      qb.updateCustomer.mockImplementation((payload: any, cb: any) => {
        sent.push(payload);
        cb(null, response);
      });
      return sent;
    }

    async function withoutDeleteCustomer<T>(fn: () => Promise<T>): Promise<T> {
      const original = qb.deleteCustomer;
      delete qb.deleteCustomer;
      try {
        return await fn();
      } finally {
        qb.deleteCustomer = original;
      }
    }

    it('uses deleteCustomer when the SDK provides it', async () => {
      qb.deleteCustomer.mockImplementation((_e: any, cb: any) => cb(null, { Customer: { Id: '58', status: 'Deleted' } }));

      const res = await deleteQuickbooksCustomer('58');

      expect(qb.deleteCustomer.mock.calls[0][0]).toBe('58');
      expect(qb.updateCustomer).not.toHaveBeenCalled();
      expect(res).toEqual({ result: { Customer: { Id: '58', status: 'Deleted' } }, isError: false, error: null });
    });

    it('falls back to an inactive update with the supplied entity when deleteCustomer fails', async () => {
      qb.deleteCustomer.mockImplementation((_e: any, cb: any) => cb(new Error('Operation not supported'), null));
      const sent = stubUpdate();

      const res = await deleteQuickbooksCustomer({ Id: '58', SyncToken: '4', DisplayName: 'Acme' });

      expect(qb.getCustomer).not.toHaveBeenCalled();
      expect(sent).toEqual([{ Id: '58', SyncToken: '4', Active: false }]);
      expect(res).toEqual({ result: { Id: '58', Active: false }, isError: false, error: null });
    });

    it('fetches the customer by id for the fallback and surfaces the update error', async () => {
      qb.deleteCustomer.mockImplementation((_e: any, cb: any) => cb(new Error('Operation not supported'), null));
      qb.getCustomer.mockImplementation((_id: any, cb: any) => cb(null, { Id: '58', SyncToken: '9' }));
      qb.updateCustomer.mockImplementation((_p: any, cb: any) => cb(new Error('Stale Object'), null));

      const res = await deleteQuickbooksCustomer('58');

      expect(qb.getCustomer.mock.calls[0][0]).toBe('58');
      expect(qb.updateCustomer.mock.calls[0][0]).toEqual({ Id: '58', SyncToken: '9', Active: false });
      expect(res).toEqual({ result: null, isError: true, error: 'Error: Stale Object' });
    });

    it('reports the original delete error when the customer cannot be fetched', async () => {
      qb.deleteCustomer.mockImplementation((_e: any, cb: any) => cb(new Error('Operation not supported'), null));
      qb.getCustomer.mockImplementation((_id: any, cb: any) => cb(new Error('Object Not Found'), null));

      const res = await deleteQuickbooksCustomer('404');

      expect(res).toEqual({ result: null, isError: true, error: 'Error: Operation not supported' });
      expect(qb.updateCustomer).not.toHaveBeenCalled();
    });

    it('goes straight to the inactive update when the SDK lacks deleteCustomer', async () => {
      qb.getCustomer.mockImplementation((_id: any, cb: any) => cb(null, { Id: '58', SyncToken: '1' }));
      const sent = stubUpdate();

      const res = await withoutDeleteCustomer(() => deleteQuickbooksCustomer('58'));

      expect(sent).toEqual([{ Id: '58', SyncToken: '1', Active: false }]);
      expect(res.isError).toBe(false);
    });

    it('reports a generic error without deleteCustomer when the entity has no Id', async () => {
      qb.getCustomer.mockImplementation((_id: any, cb: any) => cb(null, { SyncToken: '1' }));

      const res = await withoutDeleteCustomer(() => deleteQuickbooksCustomer(null));

      expect(qb.getCustomer.mock.calls[0][0]).toBeNull();
      expect(res).toEqual({ result: null, isError: true, error: 'Error: Unable to retrieve customer for inactive update' });
    });

    it('returns an error when authentication fails', async () => {
      (mockQuickbooksClient.authenticate as any).mockRejectedValue(new Error('Auth failed'));

      const res = await deleteQuickbooksCustomer('58');

      expect(res).toEqual({ result: null, isError: true, error: 'Error: Auth failed' });
      expect(qb.deleteCustomer).not.toHaveBeenCalled();
    });
  });

  describe('searchQuickbooksCustomers', () => {
    describeCallbackHandler('returns the Customer list', {
      invoke: () => searchQuickbooksCustomers([{ field: 'DisplayName', value: 'Ac%', operator: 'LIKE' }]),
      method: 'findCustomers',
      expectedArgs: [[{ field: 'DisplayName', value: 'Ac%', operator: 'LIKE' }]],
      response: { QueryResponse: { Customer: [{ Id: '58' }] } },
      expectedResult: [{ Id: '58' }],
    });

    function respondWith(response: unknown) {
      qb.findCustomers.mockImplementation((_c: any, cb: any) => cb(null, response));
    }

    it('defaults to empty criteria and returns totalCount for count queries', async () => {
      respondWith({ QueryResponse: { totalCount: 4 } });

      const res = await searchQuickbooksCustomers();

      expect(qb.findCustomers.mock.calls[0][0]).toEqual({});
      expect(res).toEqual({ result: 4, isError: false, error: null });
    });

    it('returns an empty list when nothing matched', async () => {
      respondWith({ QueryResponse: {} });

      expect(await searchQuickbooksCustomers({ Active: true })).toEqual({ result: [], isError: false, error: null });
    });

    it('returns an empty list when QBO hands back no body at all', async () => {
      respondWith(null);

      expect(await searchQuickbooksCustomers({})).toEqual({ result: [], isError: false, error: null });
    });
  });
});
