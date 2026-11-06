import { jest, describe, it, expect, beforeEach } from '@jest/globals';
import { mockQuickbooksClient, mockQuickBooksInstance, resetAllMocks } from '../../mocks/quickbooks.mock';
import { describeCallbackHandler } from '../../mocks/callback-handler-cases';

jest.unstable_mockModule('../../../src/clients/quickbooks-client', () => ({
  quickbooksClient: mockQuickbooksClient,
}));

const { createQuickbooksEstimate } = await import('../../../src/handlers/create-quickbooks-estimate.handler');
const { getQuickbooksEstimate } = await import('../../../src/handlers/get-quickbooks-estimate.handler');
const { updateQuickbooksEstimate } = await import('../../../src/handlers/update-quickbooks-estimate.handler');
const { deleteQuickbooksEstimate } = await import('../../../src/handlers/delete-quickbooks-estimate.handler');
const { searchQuickbooksEstimates } = await import('../../../src/handlers/search-quickbooks-estimates.handler');

describe('Estimate Handlers', () => {
  beforeEach(() => {
    resetAllMocks();
  });

  const estimate = {
    CustomerRef: { value: '1' },
    Line: [{ Amount: 100, DetailType: 'SalesItemLineDetail', SalesItemLineDetail: { ItemRef: { value: '1' } } }],
  };

  describeCallbackHandler('createQuickbooksEstimate', {
    invoke: () => createQuickbooksEstimate(estimate),
    method: 'createEstimate',
    expectedArgs: [estimate],
    response: { Id: '41', TotalAmt: 100, ...estimate },
  });

  describeCallbackHandler('getQuickbooksEstimate', {
    invoke: () => getQuickbooksEstimate('41'),
    method: 'getEstimate',
    expectedArgs: ['41'],
    response: { Id: '41', TotalAmt: 100 },
  });

  describeCallbackHandler('updateQuickbooksEstimate', {
    invoke: () => updateQuickbooksEstimate({ Id: '41', SyncToken: '0', sparse: true, TxnStatus: 'Accepted' }),
    method: 'updateEstimate',
    expectedArgs: [{ Id: '41', SyncToken: '0', sparse: true, TxnStatus: 'Accepted' }],
    response: { Id: '41', SyncToken: '1', TxnStatus: 'Accepted' },
  });

  describeCallbackHandler('deleteQuickbooksEstimate', {
    invoke: () => deleteQuickbooksEstimate('41'),
    method: 'deleteEstimate',
    expectedArgs: ['41'],
    response: { Estimate: { Id: '41', status: 'Deleted' } },
  });

  describe('searchQuickbooksEstimates', () => {
    describeCallbackHandler('returns the Estimate list', {
      invoke: () => searchQuickbooksEstimates([{ field: 'TxnStatus', value: 'Pending' }]),
      method: 'findEstimates',
      expectedArgs: [[{ field: 'TxnStatus', value: 'Pending' }]],
      response: { QueryResponse: { Estimate: [{ Id: '41' }] } },
      expectedResult: [{ Id: '41' }],
    });

    function respondWith(response: unknown) {
      (mockQuickBooksInstance.findEstimates as any).mockImplementation((_c: any, cb: any) => cb(null, response));
    }

    it('defaults to empty criteria and returns totalCount for count queries', async () => {
      respondWith({ QueryResponse: { totalCount: 12 } });

      const res = await searchQuickbooksEstimates();

      expect(mockQuickBooksInstance.findEstimates.mock.calls[0][0]).toEqual({});
      expect(res).toEqual({ result: 12, isError: false, error: null });
    });

    it('returns an empty list when the response has no QueryResponse', async () => {
      respondWith({});

      expect(await searchQuickbooksEstimates({})).toEqual({ result: [], isError: false, error: null });
    });

    it('returns an empty list when QBO hands back no body at all', async () => {
      respondWith(undefined);

      expect(await searchQuickbooksEstimates({})).toEqual({ result: [], isError: false, error: null });
    });
  });
});
