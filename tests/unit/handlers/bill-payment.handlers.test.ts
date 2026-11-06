import { jest, describe, beforeEach } from '@jest/globals';
import { mockQuickbooksClient, resetAllMocks } from '../../mocks/quickbooks.mock';
import { describeCallbackHandler } from '../../mocks/callback-handler-cases';

jest.unstable_mockModule('../../../src/clients/quickbooks-client', () => ({
  quickbooksClient: mockQuickbooksClient,
}));

const { createQuickbooksBillPayment } = await import('../../../src/handlers/create-quickbooks-bill-payment.handler');
const { getQuickbooksBillPayment } = await import('../../../src/handlers/get-quickbooks-bill-payment.handler');
const { updateQuickbooksBillPayment } = await import('../../../src/handlers/update-quickbooks-bill-payment.handler');
const { deleteQuickbooksBillPayment } = await import('../../../src/handlers/delete-quickbooks-bill-payment.handler');
const { searchQuickbooksBillPayments } = await import('../../../src/handlers/search-quickbooks-bill-payments.handler');

describe('Bill Payment Handlers', () => {
  beforeEach(() => {
    resetAllMocks();
  });

  const billPayment = {
    VendorRef: { value: '56' },
    PayType: 'Check',
    TotalAmt: 200,
    CheckPayment: { BankAccountRef: { value: '35' } },
    Line: [{ Amount: 200, LinkedTxn: [{ TxnId: '108', TxnType: 'Bill' }] }],
  };

  describeCallbackHandler('createQuickbooksBillPayment', {
    invoke: () => createQuickbooksBillPayment(billPayment),
    method: 'createBillPayment',
    expectedArgs: [billPayment],
    response: { Id: '201', SyncToken: '0', ...billPayment },
  });

  describeCallbackHandler('getQuickbooksBillPayment', {
    invoke: () => getQuickbooksBillPayment('201'),
    method: 'getBillPayment',
    expectedArgs: ['201'],
    response: { Id: '201', TotalAmt: 200 },
  });

  describeCallbackHandler('updateQuickbooksBillPayment', {
    invoke: () => updateQuickbooksBillPayment({ Id: '201', SyncToken: '1', sparse: true, PrivateNote: 'paid' }),
    method: 'updateBillPayment',
    expectedArgs: [{ Id: '201', SyncToken: '1', sparse: true, PrivateNote: 'paid' }],
    response: { Id: '201', SyncToken: '2', PrivateNote: 'paid' },
  });

  describeCallbackHandler('deleteQuickbooksBillPayment', {
    invoke: () => deleteQuickbooksBillPayment({ Id: '201', SyncToken: '2' }),
    method: 'deleteBillPayment',
    expectedArgs: [{ Id: '201', SyncToken: '2' }],
    response: { BillPayment: { Id: '201', status: 'Deleted' } },
  });

  describe('searchQuickbooksBillPayments', () => {
    describeCallbackHandler('advanced criteria', {
      invoke: () => searchQuickbooksBillPayments({ criteria: [{ field: 'TotalAmt', value: '100', operator: '>' }], desc: 'TxnDate', offset: 5, count: true }),
      method: 'findBillPayments',
      expectedArgs: [[
        { field: 'TotalAmt', value: '100', operator: '>' },
        { field: 'desc', value: 'TxnDate' },
        { field: 'offset', value: 5 },
        { field: 'count', value: true },
      ]],
      response: { QueryResponse: { totalCount: 3 } },
    });

    describeCallbackHandler('simple criteria passthrough', {
      invoke: () => searchQuickbooksBillPayments({ VendorRef: '56' }),
      method: 'findBillPayments',
      expectedArgs: [{ VendorRef: '56' }],
      response: { QueryResponse: { BillPayment: [{ Id: '201' }] } },
    });
  });
});
