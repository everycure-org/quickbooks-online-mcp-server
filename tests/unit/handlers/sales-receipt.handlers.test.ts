import { jest, describe, it, expect, beforeEach } from '@jest/globals';
import { mockQuickbooksClient, mockQuickBooksInstance, resetAllMocks } from '../../mocks/quickbooks.mock';

// ESM-compatible module mocking
jest.unstable_mockModule('../../../src/clients/quickbooks-client', () => ({
  quickbooksClient: mockQuickbooksClient,
}));

// Dynamic imports after mock setup
const { getQuickbooksSalesReceipt } = await import('../../../src/handlers/get-quickbooks-sales-receipt.handler');
const { updateQuickbooksSalesReceipt } = await import('../../../src/handlers/update-quickbooks-sales-receipt.handler');
const { deleteQuickbooksSalesReceipt } = await import('../../../src/handlers/delete-quickbooks-sales-receipt.handler');
const { searchQuickbooksSalesReceipts } = await import('../../../src/handlers/search-quickbooks-sales-receipts.handler');

describe('SalesReceipt Handlers', () => {
  beforeEach(() => {
    resetAllMocks();
  });

  describe('getQuickbooksSalesReceipt', () => {
    it('should get a sales receipt by ID', async () => {
      const mockReceipt = { Id: '123', TotalAmt: 250 };
      mockQuickBooksInstance.getSalesReceipt.mockImplementation((_id: any, cb: any) => cb(null, mockReceipt));

      const result = await getQuickbooksSalesReceipt('123');

      expect(result.isError).toBe(false);
      expect(result.result).toEqual(mockReceipt);
    });

    it('should handle API errors', async () => {
      mockQuickBooksInstance.getSalesReceipt.mockImplementation((_id: any, cb: any) =>
        cb(new Error('Not found'), null)
      );

      const result = await getQuickbooksSalesReceipt('999');

      expect(result.isError).toBe(true);
    });

    it('should handle authentication errors', async () => {
      (mockQuickbooksClient.authenticate as any).mockRejectedValue(new Error('Auth failed'));

      const result = await getQuickbooksSalesReceipt('123');

      expect(result.isError).toBe(true);
      expect(result.error).toContain('Auth failed');
    });
  });

  describe('updateQuickbooksSalesReceipt', () => {
    it('should update a sales receipt', async () => {
      const mockUpdated = { Id: '123', TotalAmt: 300 };
      mockQuickBooksInstance.updateSalesReceipt.mockImplementation((payload: any, cb: any) => cb(null, mockUpdated));

      const result = await updateQuickbooksSalesReceipt({ id: '123', sync_token: '0' });

      expect(result.isError).toBe(false);
    });

    it('should update with all optional fields', async () => {
      const mockUpdated = { Id: '123' };
      mockQuickBooksInstance.updateSalesReceipt.mockImplementation((payload: any, cb: any) => cb(null, mockUpdated));

      const result = await updateQuickbooksSalesReceipt({
        id: '123',
        sync_token: '0',
        customer_ref: 'cust-1',
        private_note: 'Updated note',
        doc_number: 'SR-002'
      });

      expect(result.isError).toBe(false);
    });

    it('should handle API errors', async () => {
      mockQuickBooksInstance.updateSalesReceipt.mockImplementation((payload: any, cb: any) =>
        cb(new Error('Update failed'), null)
      );

      const result = await updateQuickbooksSalesReceipt({ id: '123', sync_token: '0' });

      expect(result.isError).toBe(true);
    });

    it('should handle authentication errors', async () => {
      (mockQuickbooksClient.authenticate as any).mockRejectedValue(new Error('Auth failed'));

      const result = await updateQuickbooksSalesReceipt({ id: '123', sync_token: '0' });

      expect(result.isError).toBe(true);
      expect(result.error).toContain('Auth failed');
    });
  });

  describe('deleteQuickbooksSalesReceipt', () => {
    it('should void a sales receipt', async () => {
      mockQuickBooksInstance.deleteSalesReceipt.mockImplementation((payload: any, cb: any) => cb(null, {}));

      const result = await deleteQuickbooksSalesReceipt({ id: '123', sync_token: '0' });

      expect(result.isError).toBe(false);
    });

    it('should handle API errors', async () => {
      mockQuickBooksInstance.deleteSalesReceipt.mockImplementation((payload: any, cb: any) =>
        cb(new Error('Delete failed'), null)
      );

      const result = await deleteQuickbooksSalesReceipt({ id: '123', sync_token: '0' });

      expect(result.isError).toBe(true);
    });

    it('should handle authentication errors', async () => {
      (mockQuickbooksClient.authenticate as any).mockRejectedValue(new Error('Auth failed'));

      const result = await deleteQuickbooksSalesReceipt({ id: '123', sync_token: '0' });

      expect(result.isError).toBe(true);
      expect(result.error).toContain('Auth failed');
    });
  });

  describe('searchQuickbooksSalesReceipts', () => {
    it('should search sales receipts', async () => {
      const mockReceipts = [{ Id: '1' }];
      mockQuickBooksInstance.findSalesReceipts.mockImplementation((criteria: any, cb: any) =>
        cb(null, { QueryResponse: { SalesReceipt: mockReceipts } })
      );

      const result = await searchQuickbooksSalesReceipts({});

      expect(result.isError).toBe(false);
      expect(result.result).toEqual(mockReceipts);
    });

    it('should handle API errors', async () => {
      mockQuickBooksInstance.findSalesReceipts.mockImplementation((criteria: any, cb: any) =>
        cb(new Error('Search failed'), null)
      );

      const result = await searchQuickbooksSalesReceipts({});

      expect(result.isError).toBe(true);
    });

    it('should handle authentication errors', async () => {
      (mockQuickbooksClient.authenticate as any).mockRejectedValue(new Error('Auth failed'));

      const result = await searchQuickbooksSalesReceipts({});

      expect(result.isError).toBe(true);
      expect(result.error).toContain('Auth failed');
    });

    it('should search with all filter options', async () => {
      mockQuickBooksInstance.findSalesReceipts.mockImplementation((criteria: any, cb: any) =>
        cb(null, { QueryResponse: { SalesReceipt: [] } })
      );

      const result = await searchQuickbooksSalesReceipts({
        customer_ref: 'cust-1',
        txn_date_from: '2024-01-01',
        txn_date_to: '2024-12-31',
        limit: 50
      });

      expect(result.isError).toBe(false);
    });

    it('should handle empty QueryResponse', async () => {
      mockQuickBooksInstance.findSalesReceipts.mockImplementation((criteria: any, cb: any) =>
        cb(null, { QueryResponse: {} })
      );

      const result = await searchQuickbooksSalesReceipts({ limit: 5 });

      expect(result.isError).toBe(false);
      expect(result.result).toEqual([]);
    });
  });
});
