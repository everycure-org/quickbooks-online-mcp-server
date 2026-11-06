import { jest, describe, beforeEach } from '@jest/globals';
import { mockQuickbooksClient, resetAllMocks } from '../../mocks/quickbooks.mock';
import { describeCallbackHandler } from '../../mocks/callback-handler-cases';

jest.unstable_mockModule('../../../src/clients/quickbooks-client', () => ({
  quickbooksClient: mockQuickbooksClient,
}));

const { createQuickbooksPurchase } = await import('../../../src/handlers/create-quickbooks-purchase.handler');
const { getQuickbooksPurchase } = await import('../../../src/handlers/get-quickbooks-purchase.handler');
const { updateQuickbooksPurchase } = await import('../../../src/handlers/update-quickbooks-purchase.handler');
const { deleteQuickbooksPurchase } = await import('../../../src/handlers/delete-quickbooks-purchase.handler');

describe('Purchase Handlers', () => {
  beforeEach(() => {
    resetAllMocks();
  });

  const purchase = {
    PaymentType: 'Cash',
    AccountRef: { value: '35' },
    Line: [{ Amount: 10, DetailType: 'AccountBasedExpenseLineDetail', AccountBasedExpenseLineDetail: { AccountRef: { value: '7' } } }],
  };

  describeCallbackHandler('createQuickbooksPurchase', {
    invoke: () => createQuickbooksPurchase(purchase),
    method: 'createPurchase',
    expectedArgs: [purchase],
    response: { Id: '90', TotalAmt: 10, ...purchase },
  });

  describeCallbackHandler('getQuickbooksPurchase', {
    invoke: () => getQuickbooksPurchase('90'),
    method: 'getPurchase',
    expectedArgs: ['90'],
    response: { Id: '90', TotalAmt: 10 },
  });

  describeCallbackHandler('updateQuickbooksPurchase', {
    invoke: () => updateQuickbooksPurchase({ Id: '90', SyncToken: '0', sparse: true, PrivateNote: 'lunch' }),
    method: 'updatePurchase',
    expectedArgs: [{ Id: '90', SyncToken: '0', sparse: true, PrivateNote: 'lunch' }],
    response: { Id: '90', SyncToken: '1', PrivateNote: 'lunch' },
  });

  describeCallbackHandler('deleteQuickbooksPurchase', {
    invoke: () => deleteQuickbooksPurchase('90'),
    method: 'deletePurchase',
    expectedArgs: ['90'],
    response: { Purchase: { Id: '90', status: 'Deleted' } },
  });
});
