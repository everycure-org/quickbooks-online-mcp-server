import { jest, describe, it, expect, beforeEach } from '@jest/globals';
import { mockQuickbooksClient, mockQuickBooksInstance, resetAllMocks } from '../../mocks/quickbooks.mock';
import { describeCallbackHandler } from '../../mocks/callback-handler-cases';

jest.unstable_mockModule('../../../src/clients/quickbooks-client', () => ({
  quickbooksClient: mockQuickbooksClient,
}));

const { createQuickbooksInvoice } = await import('../../../src/handlers/create-quickbooks-invoice.handler');
const { readQuickbooksInvoice } = await import('../../../src/handlers/read-quickbooks-invoice.handler');
const { updateQuickbooksInvoice } = await import('../../../src/handlers/update-quickbooks-invoice.handler');
const { deleteQuickbooksInvoice } = await import('../../../src/handlers/delete-quickbooks-invoice.handler');
const { searchQuickbooksInvoices } = await import('../../../src/handlers/search-quickbooks-invoices.handler');

const qb = mockQuickBooksInstance as any;

function captureCall(method: string, response: unknown = { Id: '1' }) {
  const sent: any[] = [];
  qb[method].mockImplementation((payload: any, cb: any) => {
    sent.push(payload);
    cb(null, response);
  });
  return sent;
}

describe('Invoice Handlers', () => {
  beforeEach(() => {
    resetAllMocks();
  });

  describe('createQuickbooksInvoice', () => {
    const singleLineInput = { customer_ref: '1', line_items: [{ item_ref: '9', qty: 2, unit_price: 5 }] };
    const singleLinePayload = {
      CustomerRef: { value: '1' },
      Line: [{
        Id: '1',
        LineNum: 1,
        Description: undefined,
        Amount: 10,
        DetailType: 'SalesItemLineDetail',
        SalesItemLineDetail: { ItemRef: { value: '9' }, Qty: 2, UnitPrice: 5 },
      }],
      DocNumber: undefined,
      TxnDate: undefined,
    };

    describeCallbackHandler('callback contract', {
      invoke: () => createQuickbooksInvoice(singleLineInput),
      method: 'createInvoice',
      expectedArgs: [singleLinePayload],
      response: { Id: '130', TotalAmt: 10 },
    });

    it('numbers lines, computes amounts and stringifies DocNumber', async () => {
      const sent = captureCall('createInvoice');

      await createQuickbooksInvoice({
        customer_ref: '1',
        line_items: [
          { item_ref: '9', qty: 3, unit_price: 2.5, description: 'Widgets' },
          { item_ref: '10', qty: 1, unit_price: 100, description: '' },
        ],
        doc_number: 1042 as any,
        txn_date: '2026-11-01',
      });

      expect(sent[0]).toEqual({
        CustomerRef: { value: '1' },
        Line: [
          { Id: '1', LineNum: 1, Description: 'Widgets', Amount: 7.5, DetailType: 'SalesItemLineDetail', SalesItemLineDetail: { ItemRef: { value: '9' }, Qty: 3, UnitPrice: 2.5 } },
          { Id: '2', LineNum: 2, Description: undefined, Amount: 100, DetailType: 'SalesItemLineDetail', SalesItemLineDetail: { ItemRef: { value: '10' }, Qty: 1, UnitPrice: 100 } },
        ],
        DocNumber: '1042',
        TxnDate: '2026-11-01',
      });
    });

    it('leaves null primitive fields untouched', async () => {
      const sent = captureCall('createInvoice');

      await createQuickbooksInvoice({ ...singleLineInput, txn_date: null as any });

      expect(sent[0].TxnDate).toBeNull();
    });

    // The payload only ever contains CustomerRef, Line, DocNumber and TxnDate, so the
    // number and boolean branches of normalizeInvoiceFields are unreachable from the
    // handler input. Injecting extra entries into the field walk exercises them.
    it('coerces number and boolean primitive fields when they appear in the payload', async () => {
      const realEntries = Object.entries;
      jest.spyOn(Object, 'entries').mockImplementation(((obj: any) => {
        const entries = realEntries(obj);
        if (obj && 'CustomerRef' in obj && 'Line' in obj) {
          entries.push(
            ['TotalAmt', '19.99'],
            ['ApplyTaxAfterDiscount', 'true'],
            ['GlobalTaxCalculation', 'TaxExcluded']
          );
        }
        return entries;
      }) as any);
      const sent = captureCall('createInvoice');

      await createQuickbooksInvoice(singleLineInput);
      jest.restoreAllMocks();

      expect(sent[0]).toMatchObject({ TotalAmt: 19.99, ApplyTaxAfterDiscount: true, GlobalTaxCalculation: 'TaxExcluded' });
    });

    it('keeps already typed number and boolean values', async () => {
      const realEntries = Object.entries;
      jest.spyOn(Object, 'entries').mockImplementation(((obj: any) => {
        const entries = realEntries(obj);
        if (obj && 'CustomerRef' in obj && 'Line' in obj) {
          entries.push(['TotalAmt', 12], ['ApplyTaxAfterDiscount', false]);
        }
        return entries;
      }) as any);
      const sent = captureCall('createInvoice');

      await createQuickbooksInvoice(singleLineInput);
      jest.restoreAllMocks();

      expect(sent[0]).toMatchObject({ TotalAmt: 12, ApplyTaxAfterDiscount: false });
    });
  });

  describeCallbackHandler('readQuickbooksInvoice', {
    invoke: () => readQuickbooksInvoice('130'),
    method: 'getInvoice',
    expectedArgs: ['130'],
    response: { Id: '130', TotalAmt: 10, Balance: 10 },
  });

  describe('updateQuickbooksInvoice', () => {
    it('merges the patch onto the fetched invoice as a sparse update', async () => {
      qb.getInvoice.mockImplementation((_id: any, cb: any) => cb(null, { Id: '130', SyncToken: '2', DueDate: '2026-11-30' }));
      const sent = captureCall('updateInvoice', { Id: '130', SyncToken: '3' });

      const res = await updateQuickbooksInvoice({ invoice_id: '130', patch: { DueDate: '2026-12-31', Id: 'ignored' } });

      expect(qb.getInvoice.mock.calls[0][0]).toBe('130');
      expect(sent[0]).toEqual({ Id: '130', SyncToken: '2', DueDate: '2026-12-31', sparse: true });
      expect(res).toEqual({ result: { Id: '130', SyncToken: '3' }, isError: false, error: null });
    });

    it('returns an error when the invoice cannot be fetched', async () => {
      qb.getInvoice.mockImplementation((_id: any, cb: any) => cb(new Error('Object Not Found'), null));

      const res = await updateQuickbooksInvoice({ invoice_id: '404', patch: {} });

      expect(res).toEqual({ result: null, isError: true, error: 'Error: Object Not Found' });
      expect(qb.updateInvoice).not.toHaveBeenCalled();
    });

    it('returns an error when QBO rejects the update', async () => {
      qb.getInvoice.mockImplementation((_id: any, cb: any) => cb(null, { Id: '130', SyncToken: '2' }));
      qb.updateInvoice.mockImplementation((_p: any, cb: any) => cb(new Error('Stale Object'), null));

      const res = await updateQuickbooksInvoice({ invoice_id: '130', patch: {} });

      expect(res).toEqual({ result: null, isError: true, error: 'Error: Stale Object' });
    });

    it('returns an error when authentication fails', async () => {
      (mockQuickbooksClient.authenticate as any).mockRejectedValue(new Error('Auth failed'));

      const res = await updateQuickbooksInvoice({ invoice_id: '130', patch: {} });

      expect(res).toEqual({ result: null, isError: true, error: 'Error: Auth failed' });
      expect(qb.getInvoice).not.toHaveBeenCalled();
    });
  });

  describe('deleteQuickbooksInvoice', () => {
    async function withoutDeleteInvoice<T>(fn: () => Promise<T>): Promise<T> {
      const original = qb.deleteInvoice;
      delete qb.deleteInvoice;
      try {
        return await fn();
      } finally {
        qb.deleteInvoice = original;
      }
    }

    it('uses deleteInvoice when the SDK provides it', async () => {
      qb.deleteInvoice.mockImplementation((_e: any, cb: any) => cb(null, { Invoice: { Id: '130', status: 'Deleted' } }));

      const res = await deleteQuickbooksInvoice({ Id: '130', SyncToken: '2' });

      expect(qb.deleteInvoice.mock.calls[0][0]).toEqual({ Id: '130', SyncToken: '2' });
      expect(qb.voidInvoice).not.toHaveBeenCalled();
      expect(res).toEqual({ result: { Invoice: { Id: '130', status: 'Deleted' } }, isError: false, error: null });
    });

    it('voids the supplied invoice entity when deleteInvoice fails', async () => {
      qb.deleteInvoice.mockImplementation((_e: any, cb: any) => cb(new Error('Business Validation Error'), null));
      const sent = captureCall('voidInvoice', { Id: '130', PrivateNote: 'Voided via API' });

      const res = await deleteQuickbooksInvoice({ Id: '130', SyncToken: '2' });

      expect(qb.getInvoice).not.toHaveBeenCalled();
      expect(sent).toEqual([{ Id: '130', SyncToken: '2', sparse: true, PrivateNote: 'Voided via API' }]);
      expect(res).toEqual({ result: { Id: '130', PrivateNote: 'Voided via API' }, isError: false, error: null });
    });

    it('fetches the invoice by id before voiding and surfaces the void error', async () => {
      qb.deleteInvoice.mockImplementation((_e: any, cb: any) => cb(new Error('Business Validation Error'), null));
      qb.getInvoice.mockImplementation((_id: any, cb: any) => cb(null, { Id: '130', SyncToken: '6' }));
      qb.voidInvoice.mockImplementation((_p: any, cb: any) => cb(new Error('Void not allowed'), null));

      const res = await deleteQuickbooksInvoice('130');

      expect(qb.getInvoice.mock.calls[0][0]).toBe('130');
      expect(qb.voidInvoice.mock.calls[0][0]).toEqual({ Id: '130', SyncToken: '6', sparse: true, PrivateNote: 'Voided via API' });
      expect(res).toEqual({ result: null, isError: true, error: 'Error: Void not allowed' });
    });

    it('reports the original delete error when the invoice cannot be fetched', async () => {
      qb.deleteInvoice.mockImplementation((_e: any, cb: any) => cb(new Error('Business Validation Error'), null));
      qb.getInvoice.mockImplementation((_id: any, cb: any) => cb(new Error('Object Not Found'), null));

      const res = await deleteQuickbooksInvoice('404');

      expect(res).toEqual({ result: null, isError: true, error: 'Error: Business Validation Error' });
      expect(qb.voidInvoice).not.toHaveBeenCalled();
    });

    it('voids directly when the SDK lacks deleteInvoice', async () => {
      qb.getInvoice.mockImplementation((_id: any, cb: any) => cb(null, { Id: '130', SyncToken: '1' }));
      const sent = captureCall('voidInvoice');

      const res = await withoutDeleteInvoice(() => deleteQuickbooksInvoice('130'));

      expect(sent).toEqual([{ Id: '130', SyncToken: '1', sparse: true, PrivateNote: 'Voided via API' }]);
      expect(res.isError).toBe(false);
    });

    it('reports a generic error without deleteInvoice when the entity has no Id', async () => {
      qb.getInvoice.mockImplementation((_id: any, cb: any) => cb(null, undefined));

      const res = await withoutDeleteInvoice(() => deleteQuickbooksInvoice(null));

      expect(qb.getInvoice.mock.calls[0][0]).toBeNull();
      expect(res).toEqual({ result: null, isError: true, error: 'Error: Unable to retrieve invoice for void operation' });
    });

    it('returns an error when authentication fails', async () => {
      (mockQuickbooksClient.authenticate as any).mockRejectedValue(new Error('Auth failed'));

      const res = await deleteQuickbooksInvoice('130');

      expect(res).toEqual({ result: null, isError: true, error: 'Error: Auth failed' });
      expect(qb.deleteInvoice).not.toHaveBeenCalled();
    });
  });

  describe('searchQuickbooksInvoices', () => {
    describeCallbackHandler('callback contract', {
      invoke: () => searchQuickbooksInvoices({ criteria: [{ field: 'Balance', value: '0', operator: '>' }], limit: 25 }),
      method: 'findInvoices',
      expectedArgs: [[
        { field: 'Balance', value: '0', operator: '>' },
        { field: 'limit', value: 25 },
      ]],
      response: { QueryResponse: { Invoice: [{ Id: '130' }] } },
      expectedResult: [{ Id: '130' }],
    });

    it('returns an empty list when QBO returns no Invoice array', async () => {
      qb.findInvoices.mockImplementation((_c: any, cb: any) => cb(null, { QueryResponse: {} }));

      const res = await searchQuickbooksInvoices({ CustomerRef: '1' });

      expect(qb.findInvoices.mock.calls[0][0]).toEqual({ CustomerRef: '1' });
      expect(res).toEqual({ result: [], isError: false, error: null });
    });
  });
});
