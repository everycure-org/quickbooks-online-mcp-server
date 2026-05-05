import { jest, describe, it, expect, beforeEach } from '@jest/globals';
import { mockQuickbooksClient, mockQuickBooksInstance, resetAllMocks } from '../../mocks/quickbooks.mock';

// ESM-compatible module mocking
jest.unstable_mockModule('../../../src/clients/quickbooks-client', () => ({
  quickbooksClient: mockQuickbooksClient,
}));

// Mock https for upload tests
const mockHttpsRequest = jest.fn();
jest.unstable_mockModule('https', () => ({
  default: { request: mockHttpsRequest },
  request: mockHttpsRequest,
}));

function mockHttpsUploadSuccess(statusCode: number, responseBody: unknown) {
  const mockReq = { write: jest.fn(), end: jest.fn(), on: jest.fn() };
  (mockHttpsRequest as any).mockImplementation((_options: unknown, callback: (res: unknown) => void) => {
    const mockRes = {
      statusCode,
      on: jest.fn((event: string, handler: (...args: unknown[]) => void) => {
        if (event === 'data') handler(Buffer.from(JSON.stringify(responseBody)));
        else if (event === 'end') handler();
      }),
    };
    callback(mockRes);
    return mockReq;
  });
}

function mockHttpsUploadNetworkError(err: Error) {
  const mockReq = {
    write: jest.fn(),
    end: jest.fn(),
    on: jest.fn((event: string, handler: (...args: unknown[]) => void) => {
      if (event === 'error') handler(err);
    }),
  };
  (mockHttpsRequest as any).mockImplementation((_options: unknown, _callback: unknown) => mockReq);
}

// Dynamic imports after mock setup
const { getQuickbooksCompanyInfo } = await import('../../../src/handlers/get-quickbooks-company-info.handler');
const { updateQuickbooksCompanyInfo } = await import('../../../src/handlers/update-quickbooks-company-info.handler');
const { createQuickbooksAttachable } = await import('../../../src/handlers/create-quickbooks-attachable.handler');
const { getQuickbooksAttachable } = await import('../../../src/handlers/get-quickbooks-attachable.handler');
const { updateQuickbooksAttachable } = await import('../../../src/handlers/update-quickbooks-attachable.handler');
const { deleteQuickbooksAttachable } = await import('../../../src/handlers/delete-quickbooks-attachable.handler');
const { searchQuickbooksAttachables } = await import('../../../src/handlers/search-quickbooks-attachables.handler');

describe('Company and Attachable Handlers', () => {
  beforeEach(() => {
    resetAllMocks();
  });

  describe('getQuickbooksCompanyInfo', () => {
    it('should get company info', async () => {
      const mockInfo = { Id: '1', CompanyName: 'Test Company' };
      mockQuickBooksInstance.getCompanyInfo.mockImplementation((_id: any, cb: any) => cb(null, mockInfo));
      (mockQuickBooksInstance as any).realmId = '123456';

      const result = await getQuickbooksCompanyInfo();

      expect(result.isError).toBe(false);
      expect(result.result).toEqual(mockInfo);
    });

    it('should get company info with specific ID', async () => {
      const mockInfo = { Id: '2', CompanyName: 'Another Company' };
      mockQuickBooksInstance.getCompanyInfo.mockImplementation((_id: any, cb: any) => cb(null, mockInfo));

      const result = await getQuickbooksCompanyInfo('specific-id');

      expect(result.isError).toBe(false);
    });

    it('should handle errors', async () => {
      mockQuickBooksInstance.getCompanyInfo.mockImplementation((_id: any, cb: any) =>
        cb(new Error('Not authorized'), null)
      );

      const result = await getQuickbooksCompanyInfo();

      expect(result.isError).toBe(true);
    });
  });

  describe('updateQuickbooksCompanyInfo', () => {
    it('should update company info', async () => {
      const mockUpdated = { Id: '1', CompanyName: 'Updated Company' };
      mockQuickBooksInstance.updateCompanyInfo.mockImplementation((payload: any, cb: any) => cb(null, mockUpdated));

      const result = await updateQuickbooksCompanyInfo({
        id: '1',
        sync_token: '0',
        company_name: 'Updated Company'
      });

      expect(result.isError).toBe(false);
    });

    it('should update with all fields', async () => {
      mockQuickBooksInstance.updateCompanyInfo.mockImplementation((payload: any, cb: any) => cb(null, {}));

      const result = await updateQuickbooksCompanyInfo({
        id: '1',
        sync_token: '0',
        company_name: 'Test',
        legal_name: 'Test LLC',
        company_addr: {
          line1: '123 Main St',
          city: 'Anytown',
          country_sub_division_code: 'CA',
          postal_code: '12345',
          country: 'USA'
        },
        primary_phone: '555-1234',
        email: 'test@test.com',
        web_addr: 'https://test.com'
      });

      expect(result.isError).toBe(false);
    });

    it('should update with partial company_addr fields', async () => {
      mockQuickBooksInstance.updateCompanyInfo.mockImplementation((payload: any, cb: any) => cb(null, {}));

      const result = await updateQuickbooksCompanyInfo({
        id: '1',
        sync_token: '0',
        company_addr: {
          line1: '456 Oak Ave'
        }
      });

      expect(result.isError).toBe(false);
    });

    it('should update with only city in company_addr', async () => {
      mockQuickBooksInstance.updateCompanyInfo.mockImplementation((payload: any, cb: any) => cb(null, {}));

      const result = await updateQuickbooksCompanyInfo({
        id: '1',
        sync_token: '0',
        company_addr: {
          city: 'Los Angeles'
        }
      });

      expect(result.isError).toBe(false);
    });

    it('should handle API errors', async () => {
      mockQuickBooksInstance.updateCompanyInfo.mockImplementation((payload: any, cb: any) =>
        cb(new Error('Update failed'), null)
      );

      const result = await updateQuickbooksCompanyInfo({ id: '1', sync_token: '0' });

      expect(result.isError).toBe(true);
    });

    it('should handle authentication errors', async () => {
      (mockQuickbooksClient.authenticate as any).mockRejectedValue(new Error('Auth failed'));

      const result = await updateQuickbooksCompanyInfo({ id: '1', sync_token: '0' });

      expect(result.isError).toBe(true);
      expect(result.error).toContain('Auth failed');
    });
  });

  describe('getQuickbooksCompanyInfo auth errors', () => {
    it('should handle authentication errors', async () => {
      (mockQuickbooksClient.authenticate as any).mockRejectedValue(new Error('Auth failed'));

      const result = await getQuickbooksCompanyInfo();

      expect(result.isError).toBe(true);
      expect(result.error).toContain('Auth failed');
    });
  });

  describe('createQuickbooksAttachable', () => {
    it('should create an attachable', async () => {
      const mockAttachable = { Id: '1', FileName: 'test.pdf' };
      mockQuickBooksInstance.createAttachable.mockImplementation((payload: any, cb: any) => cb(null, mockAttachable));

      const result = await createQuickbooksAttachable({ file_name: 'test.pdf' });

      expect(result.isError).toBe(false);
      expect(result.result).toEqual(mockAttachable);
    });

    it('should create with all fields', async () => {
      mockQuickBooksInstance.createAttachable.mockImplementation((payload: any, cb: any) => cb(null, {}));

      const result = await createQuickbooksAttachable({
        file_name: 'invoice.pdf',
        note: 'Invoice attachment',
        category: 'Invoice',
        content_type: 'application/pdf',
        attachable_ref: { entity_ref_type: 'Invoice', entity_ref_value: '123' }
      });

      expect(result.isError).toBe(false);
    });

    it('should handle API errors', async () => {
      mockQuickBooksInstance.createAttachable.mockImplementation((payload: any, cb: any) =>
        cb(new Error('Create failed'), null)
      );

      const result = await createQuickbooksAttachable({ file_name: 'test.pdf' });

      expect(result.isError).toBe(true);
    });

    it('should handle authentication errors', async () => {
      (mockQuickbooksClient.authenticate as any).mockRejectedValue(new Error('Auth failed'));

      const result = await createQuickbooksAttachable({ file_name: 'test.pdf' });

      expect(result.isError).toBe(true);
      expect(result.error).toContain('Auth failed');
    });

    it('should upload file when base64_content is provided', async () => {
      const uploadResponse = {
        AttachableResponse: [{ Attachable: { Id: '99', FileName: 'invoice.pdf', FileAccessUri: 'https://example.com/file' }, responseStatus: '200' }]
      };
      mockHttpsUploadSuccess(200, uploadResponse);

      const result = await createQuickbooksAttachable({
        file_name: 'invoice.pdf',
        content_type: 'application/pdf',
        base64_content: Buffer.from('fake-pdf-bytes').toString('base64'),
        note: 'Supplier invoice',
        attachable_ref: { entity_ref_type: 'Bill', entity_ref_value: '123' },
      });

      expect(result.isError).toBe(false);
      expect(result.result).toEqual(uploadResponse);
      expect(mockHttpsRequest).toHaveBeenCalledTimes(1);
      const [[reqOptions]] = (mockHttpsRequest as jest.Mock).mock.calls as any[][];
      expect(reqOptions.method).toBe('POST');
      expect(reqOptions.path).toBe('/v3/company/mock-realm-id/upload');
      expect(reqOptions.hostname).toBe('sandbox-quickbooks.api.intuit.com');
    });

    it('should upload image/png file', async () => {
      const uploadResponse = { AttachableResponse: [{ Attachable: { Id: '100', FileName: 'photo.png' }, responseStatus: '200' }] };
      mockHttpsUploadSuccess(200, uploadResponse);

      const result = await createQuickbooksAttachable({
        file_name: 'photo.png',
        content_type: 'image/png',
        base64_content: Buffer.from('fake-png-bytes').toString('base64'),
      });

      expect(result.isError).toBe(false);
    });

    it('should upload image/jpeg file', async () => {
      const uploadResponse = { AttachableResponse: [{ Attachable: { Id: '101', FileName: 'photo.jpg' }, responseStatus: '200' }] };
      mockHttpsUploadSuccess(200, uploadResponse);

      const result = await createQuickbooksAttachable({
        file_name: 'photo.jpg',
        content_type: 'image/jpeg',
        base64_content: Buffer.from('fake-jpeg-bytes').toString('base64'),
      });

      expect(result.isError).toBe(false);
    });

    it('should return error for unsupported content_type on upload', async () => {
      const result = await createQuickbooksAttachable({
        file_name: 'archive.zip',
        content_type: 'application/zip',
        base64_content: Buffer.from('fake-bytes').toString('base64'),
      });

      expect(result.isError).toBe(true);
      expect(result.error).toContain('Unsupported content_type');
      expect(mockHttpsRequest).not.toHaveBeenCalled();
    });

    it('should return error when base64_content is provided without content_type', async () => {
      const result = await createQuickbooksAttachable({
        file_name: 'document.pdf',
        base64_content: Buffer.from('fake-bytes').toString('base64'),
      });

      expect(result.isError).toBe(true);
      expect(result.error).toContain('Unsupported content_type');
      expect(mockHttpsRequest).not.toHaveBeenCalled();
    });

    it('should return error when QBO upload endpoint returns 4xx', async () => {
      mockHttpsUploadSuccess(400, { fault: { error: [{ message: 'Bad Request' }] } });

      const result = await createQuickbooksAttachable({
        file_name: 'invoice.pdf',
        content_type: 'application/pdf',
        base64_content: Buffer.from('fake-pdf-bytes').toString('base64'),
      });

      expect(result.isError).toBe(true);
      expect(result.error).toContain('QBO upload failed');
    });

    it('should return error on upload network failure', async () => {
      mockHttpsUploadNetworkError(new Error('ECONNREFUSED'));

      const result = await createQuickbooksAttachable({
        file_name: 'invoice.pdf',
        content_type: 'application/pdf',
        base64_content: Buffer.from('fake-pdf-bytes').toString('base64'),
      });

      expect(result.isError).toBe(true);
      expect(result.error).toContain('ECONNREFUSED');
    });

    it('should return error when QBO returns non-JSON response', async () => {
      const mockReq = { write: jest.fn(), end: jest.fn(), on: jest.fn() };
      (mockHttpsRequest as any).mockImplementation((_options: unknown, callback: (res: unknown) => void) => {
        const mockRes = {
          statusCode: 200,
          on: jest.fn((event: string, handler: (...args: unknown[]) => void) => {
            if (event === 'data') handler(Buffer.from('not-valid-json'));
            else if (event === 'end') handler();
          }),
        };
        callback(mockRes);
        return mockReq;
      });

      const result = await createQuickbooksAttachable({
        file_name: 'invoice.pdf',
        content_type: 'application/pdf',
        base64_content: Buffer.from('fake-pdf-bytes').toString('base64'),
      });

      expect(result.isError).toBe(true);
      expect(result.error).toContain('unexpected response');
    });

    it('should use production host when not sandbox', async () => {
      (mockQuickbooksClient.getAuthCredentials as any).mockReturnValue({ accessToken: 'mock-token', realmId: 'prod-realm', isSandbox: false });
      const uploadResponse = { AttachableResponse: [{ Attachable: { Id: '102' }, responseStatus: '200' }] };
      mockHttpsUploadSuccess(200, uploadResponse);

      await createQuickbooksAttachable({
        file_name: 'invoice.pdf',
        content_type: 'application/pdf',
        base64_content: Buffer.from('fake-pdf-bytes').toString('base64'),
      });

      const [[reqOptions]] = (mockHttpsRequest as jest.Mock).mock.calls as any[][];
      expect(reqOptions.hostname).toBe('quickbooks.api.intuit.com');
      expect(reqOptions.path).toBe('/v3/company/prod-realm/upload');
    });
  });

  describe('getQuickbooksAttachable', () => {
    it('should get an attachable by ID', async () => {
      const mockAttachable = { Id: '1', FileName: 'test.pdf' };
      mockQuickBooksInstance.getAttachable.mockImplementation((_id: any, cb: any) => cb(null, mockAttachable));

      const result = await getQuickbooksAttachable('1');

      expect(result.isError).toBe(false);
    });

    it('should handle API errors', async () => {
      mockQuickBooksInstance.getAttachable.mockImplementation((_id: any, cb: any) =>
        cb(new Error('Not found'), null)
      );

      const result = await getQuickbooksAttachable('999');

      expect(result.isError).toBe(true);
    });

    it('should handle authentication errors', async () => {
      (mockQuickbooksClient.authenticate as any).mockRejectedValue(new Error('Auth failed'));

      const result = await getQuickbooksAttachable('1');

      expect(result.isError).toBe(true);
      expect(result.error).toContain('Auth failed');
    });
  });

  describe('updateQuickbooksAttachable', () => {
    it('should update an attachable', async () => {
      mockQuickBooksInstance.updateAttachable.mockImplementation((payload: any, cb: any) => cb(null, {}));

      const result = await updateQuickbooksAttachable({
        id: '1',
        sync_token: '0',
        file_name: 'updated.pdf',
        note: 'Updated note',
        category: 'Updated'
      });

      expect(result.isError).toBe(false);
    });

    it('should handle API errors', async () => {
      mockQuickBooksInstance.updateAttachable.mockImplementation((payload: any, cb: any) =>
        cb(new Error('Update failed'), null)
      );

      const result = await updateQuickbooksAttachable({ id: '1', sync_token: '0' });

      expect(result.isError).toBe(true);
    });

    it('should handle authentication errors', async () => {
      (mockQuickbooksClient.authenticate as any).mockRejectedValue(new Error('Auth failed'));

      const result = await updateQuickbooksAttachable({ id: '1', sync_token: '0' });

      expect(result.isError).toBe(true);
      expect(result.error).toContain('Auth failed');
    });
  });

  describe('deleteQuickbooksAttachable', () => {
    it('should delete an attachable', async () => {
      mockQuickBooksInstance.deleteAttachable.mockImplementation((payload: any, cb: any) => cb(null, {}));

      const result = await deleteQuickbooksAttachable({ id: '1', sync_token: '0' });

      expect(result.isError).toBe(false);
    });

    it('should handle API errors', async () => {
      mockQuickBooksInstance.deleteAttachable.mockImplementation((payload: any, cb: any) =>
        cb(new Error('Delete failed'), null)
      );

      const result = await deleteQuickbooksAttachable({ id: '1', sync_token: '0' });

      expect(result.isError).toBe(true);
    });

    it('should handle authentication errors', async () => {
      (mockQuickbooksClient.authenticate as any).mockRejectedValue(new Error('Auth failed'));

      const result = await deleteQuickbooksAttachable({ id: '1', sync_token: '0' });

      expect(result.isError).toBe(true);
      expect(result.error).toContain('Auth failed');
    });
  });

  describe('searchQuickbooksAttachables', () => {
    it('should search attachables', async () => {
      const mockAttachables = [{ Id: '1', FileName: 'test.pdf' }];
      mockQuickBooksInstance.findAttachables.mockImplementation((criteria: any, cb: any) =>
        cb(null, { QueryResponse: { Attachable: mockAttachables } })
      );

      const result = await searchQuickbooksAttachables({});

      expect(result.isError).toBe(false);
      expect(result.result).toEqual(mockAttachables);
    });

    it('should search with filters', async () => {
      mockQuickBooksInstance.findAttachables.mockImplementation((criteria: any, cb: any) =>
        cb(null, { QueryResponse: { Attachable: [] } })
      );

      const result = await searchQuickbooksAttachables({
        file_name: 'test',
        content_type: 'application/pdf',
        limit: 10
      });

      expect(result.isError).toBe(false);
    });

    it('should handle API errors', async () => {
      mockQuickBooksInstance.findAttachables.mockImplementation((criteria: any, cb: any) =>
        cb(new Error('Search failed'), null)
      );

      const result = await searchQuickbooksAttachables({});

      expect(result.isError).toBe(true);
    });

    it('should handle authentication errors', async () => {
      (mockQuickbooksClient.authenticate as any).mockRejectedValue(new Error('Auth failed'));

      const result = await searchQuickbooksAttachables({});

      expect(result.isError).toBe(true);
      expect(result.error).toContain('Auth failed');
    });

    it('should handle empty QueryResponse', async () => {
      mockQuickBooksInstance.findAttachables.mockImplementation((criteria: any, cb: any) =>
        cb(null, { QueryResponse: {} })
      );

      const result = await searchQuickbooksAttachables({ limit: 5 });

      expect(result.isError).toBe(false);
      expect(result.result).toEqual([]);
    });
  });
});
