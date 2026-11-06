import { jest, describe, it, expect, beforeEach } from '@jest/globals';
import { EventEmitter } from 'events';
import { mockQuickbooksClient, resetAllMocks } from '../../mocks/quickbooks.mock';

/**
 * Fake node http(s) plumbing: no sockets are opened. Each download (GET) and the
 * QBO upload (POST) are answered by scripted steps queued per test.
 */
class FakeRequest extends EventEmitter {
  destroy = jest.fn();
  write = jest.fn();
  end = jest.fn();
}

type Callback = (res: any) => void;
type Step = (req: FakeRequest, cb: Callback) => void;

function fakeResponse(statusCode: number | undefined, headers: Record<string, string> = {}) {
  const res: any = new EventEmitter();
  res.statusCode = statusCode;
  res.headers = headers;
  res.resume = jest.fn();
  return res;
}

/** Responds with a status, headers and an optional body, then ends the stream. */
function reply(statusCode: number | undefined, headers: Record<string, string> = {}, body?: string | Buffer): Step {
  return (_req, cb) => {
    const res = fakeResponse(statusCode, headers);
    cb(res);
    if (body !== undefined) res.emit('data', Buffer.isBuffer(body) ? body : Buffer.from(body));
    res.emit('end');
  };
}

let downloadSteps: Step[] = [];
let uploadSteps: Step[] = [];
const downloadRequests: FakeRequest[] = [];
const uploadRequests: FakeRequest[] = [];

function fakeGet(transport: string) {
  return jest.fn((url: string, _opts: unknown, cb: Callback) => {
    const req = new FakeRequest();
    downloadRequests.push(req);
    const step = downloadSteps.shift();
    if (!step) throw new Error(`Unexpected ${transport} GET ${url}`);
    setImmediate(() => step(req, cb));
    return req;
  });
}

const httpsGet = fakeGet('https');
const httpGet = fakeGet('http');
const httpsRequest = jest.fn((_opts: any, cb: Callback) => {
  const req = new FakeRequest();
  uploadRequests.push(req);
  req.end.mockImplementation(() => {
    const step = uploadSteps.shift();
    if (!step) throw new Error('Unexpected QBO upload');
    setImmediate(() => step(req, cb));
  });
  return req;
});

jest.unstable_mockModule('https', () => {
  const mod = { get: httpsGet, request: httpsRequest };
  return { ...mod, default: mod };
});
jest.unstable_mockModule('http', () => {
  const mod = { get: httpGet, request: jest.fn() };
  return { ...mod, default: mod };
});
jest.unstable_mockModule('../../../src/clients/quickbooks-client', () => ({
  quickbooksClient: mockQuickbooksClient,
}));

const { uploadAttachmentFromUrl } = await import('../../../src/handlers/upload-attachment-from-url.handler');

const QBO_OK = JSON.stringify({ AttachableResponse: [{ Attachable: { Id: '5000000000000001' } }] });

function uploadBody(): string {
  const body = uploadRequests[0].write.mock.calls[0][0] as Buffer;
  return body.toString('utf-8');
}

function uploadMetadata(): any {
  const match = uploadBody().match(/name="file_metadata_01"\r\nContent-Type: application\/json\r\n\r\n(.*)\r\n/);
  return JSON.parse(match![1]);
}

describe('uploadAttachmentFromUrl', () => {
  beforeEach(() => {
    resetAllMocks();
    downloadSteps = [];
    uploadSteps = [];
    downloadRequests.length = 0;
    uploadRequests.length = 0;
    httpsGet.mockClear();
    httpGet.mockClear();
    httpsRequest.mockClear();
  });

  it('downloads over https and uploads a multipart body with all metadata to the sandbox host', async () => {
    downloadSteps.push(reply(200, { 'content-type': 'application/pdf' }, '%PDF-1.7 fake'));
    uploadSteps.push(reply(200, {}, QBO_OK));

    const res = await uploadAttachmentFromUrl({
      file_url: 'https://files.example.com/receipts/r1.pdf',
      file_name: 'bad"name\r\n\\.pdf',
      note: 'March receipt',
      category: 'Receipt',
      attachable_ref: { entity_ref_type: 'Purchase', entity_ref_value: '90' },
    });

    expect(res).toEqual({ result: JSON.parse(QBO_OK), isError: false, error: null });
    expect(httpsGet).toHaveBeenCalledWith('https://files.example.com/receipts/r1.pdf', { timeout: 30000 }, expect.any(Function));
    expect(mockQuickbooksClient.authenticate).toHaveBeenCalledTimes(1);

    const opts = httpsRequest.mock.calls[0][0];
    expect(opts).toMatchObject({
      hostname: 'sandbox-quickbooks.api.intuit.com',
      path: '/v3/company/mock-realm-id/upload',
      method: 'POST',
    });
    expect(opts.headers.Authorization).toBe('Bearer mock-token');
    expect(opts.headers['Content-Type']).toMatch(/^multipart\/form-data; boundary=----QBOBoundary\d+$/);
    expect(opts.headers['Content-Length']).toBe((uploadRequests[0].write.mock.calls[0][0] as Buffer).length);

    expect(uploadMetadata()).toEqual({
      FileName: 'bad_name___.pdf',
      ContentType: 'application/pdf',
      Note: 'March receipt',
      Category: 'Receipt',
      AttachableRef: [{ EntityRef: { type: 'Purchase', value: '90' } }],
    });
    const body = uploadBody();
    expect(body).toContain('name="file_content_01"; filename="bad_name___.pdf"\r\nContent-Type: application/pdf\r\n\r\n%PDF-1.7 fake\r\n');
    expect(uploadRequests[0].end).toHaveBeenCalled();
  });

  it('uses http for http URLs, normalizes the header content type and derives the file name', async () => {
    (mockQuickbooksClient.getAuthCredentials as any).mockReturnValue({ accessToken: 'prod-token', realmId: '123', isSandbox: false });
    downloadSteps.push((_req, cb) => {
      const res = fakeResponse(200, { 'content-type': 'Image/PNG; charset=binary' });
      cb(res);
      res.emit('data', Buffer.from('part1-'));
      res.emit('data', Buffer.from('part2'));
      res.emit('end');
    });
    uploadSteps.push(reply(200, {}, QBO_OK));

    const res = await uploadAttachmentFromUrl({ file_url: 'http://cdn.example.com/img/my%20logo.png' });

    expect(res.isError).toBe(false);
    expect(httpGet).toHaveBeenCalledTimes(1);
    expect(httpsGet).not.toHaveBeenCalled();
    expect(httpsRequest.mock.calls[0][0]).toMatchObject({ hostname: 'quickbooks.api.intuit.com', path: '/v3/company/123/upload' });
    expect(uploadMetadata()).toEqual({ FileName: 'my logo.png', ContentType: 'image/png' });
    expect(uploadBody()).toContain('\r\n\r\npart1-part2\r\n');
  });

  it('lets an explicit content_type override an octet-stream download', async () => {
    downloadSteps.push(reply(200, { 'content-type': 'application/octet-stream' }, 'jpegbytes'));
    uploadSteps.push(reply(201, {}, QBO_OK));

    const res = await uploadAttachmentFromUrl({ file_url: 'https://bucket.example.com/', content_type: 'IMAGE/JPEG; q=1' });

    expect(res.isError).toBe(false);
    expect(uploadMetadata()).toEqual({ FileName: 'attachment', ContentType: 'image/jpeg' });
  });

  it('falls back to "attachment" when the URL path cannot be decoded', async () => {
    downloadSteps.push(reply(200, { 'content-type': 'application/pdf' }, 'x'));
    uploadSteps.push(reply(200, {}, QBO_OK));

    await uploadAttachmentFromUrl({ file_url: 'https://files.example.com/bad%E0%A4%A' });

    expect(uploadMetadata().FileName).toBe('attachment');
  });

  it('rejects unsupported content types before authenticating', async () => {
    downloadSteps.push(reply(200, {}, 'unknown'));

    const res = await uploadAttachmentFromUrl({ file_url: 'https://files.example.com/blob' });

    expect(res.isError).toBe(true);
    expect(res.error).toContain('Unsupported content type "application/octet-stream"');
    expect(res.error).toContain('application/pdf, image/png, image/jpeg');
    expect(mockQuickbooksClient.authenticate).not.toHaveBeenCalled();
    expect(httpsRequest).not.toHaveBeenCalled();
  });

  it('rejects an invalid URL without any network call', async () => {
    const res = await uploadAttachmentFromUrl({ file_url: 'not a url' });

    expect(res).toEqual({ result: null, isError: true, error: 'Error: Invalid URL: not a url' });
    expect(httpsGet).not.toHaveBeenCalled();
    expect(httpGet).not.toHaveBeenCalled();
  });

  it('rejects non-http protocols', async () => {
    const res = await uploadAttachmentFromUrl({ file_url: 'ftp://files.example.com/a.pdf' });

    expect(res).toEqual({ result: null, isError: true, error: 'Error: URL must use http or https, got: ftp:' });
  });

  it('follows relative redirects and switches transport as needed', async () => {
    downloadSteps.push(reply(302, { location: 'https://secure.example.com/final.pdf' }));
    downloadSteps.push(reply(301, { location: '/moved/doc.pdf' }));
    downloadSteps.push(reply(200, { 'content-type': 'application/pdf' }, 'pdf'));
    uploadSteps.push(reply(200, {}, QBO_OK));

    const res = await uploadAttachmentFromUrl({ file_url: 'http://example.com/start' });

    expect(res.isError).toBe(false);
    expect(httpGet.mock.calls.map((c) => c[0])).toEqual(['http://example.com/start']);
    expect(httpsGet.mock.calls.map((c) => c[0])).toEqual([
      'https://secure.example.com/final.pdf',
      'https://secure.example.com/moved/doc.pdf',
    ]);
    // The file name comes from the original URL, not the redirect target.
    expect(uploadMetadata().FileName).toBe('start');
  });

  it('gives up after five redirects', async () => {
    for (let i = 0; i < 6; i++) downloadSteps.push(reply(302, { location: `/hop${i}` }));

    const res = await uploadAttachmentFromUrl({ file_url: 'https://loop.example.com/a.pdf' });

    expect(res).toEqual({ result: null, isError: true, error: 'Error: Too many redirects while downloading file' });
    expect(httpsGet).toHaveBeenCalledTimes(6);
  });

  it('treats a 3xx without a Location header as a failed download', async () => {
    let res304: any;
    downloadSteps.push((_req, cb) => {
      res304 = fakeResponse(304);
      cb(res304);
    });

    const res = await uploadAttachmentFromUrl({ file_url: 'https://files.example.com/a.pdf' });

    expect(res).toEqual({ result: null, isError: true, error: 'Error: Failed to download file: HTTP 304' });
    expect(res304.resume).toHaveBeenCalled();
  });

  it('fails on non-2xx and missing status codes', async () => {
    downloadSteps.push(reply(404));
    downloadSteps.push(reply(undefined));

    const notFound = await uploadAttachmentFromUrl({ file_url: 'https://files.example.com/a.pdf' });
    const noStatus = await uploadAttachmentFromUrl({ file_url: 'https://files.example.com/a.pdf' });

    expect(notFound.error).toBe('Error: Failed to download file: HTTP 404');
    expect(noStatus.error).toBe('Error: Failed to download file: HTTP undefined');
  });

  it('aborts downloads larger than 20 MB', async () => {
    downloadSteps.push(reply(200, { 'content-type': 'application/pdf' }, Buffer.alloc(20 * 1024 * 1024 + 1)));

    const res = await uploadAttachmentFromUrl({ file_url: 'https://files.example.com/huge.pdf' });

    expect(res).toEqual({ result: null, isError: true, error: 'Error: File exceeds maximum allowed size of 20 MB' });
    expect(downloadRequests[0].destroy).toHaveBeenCalled();
    expect(httpsRequest).not.toHaveBeenCalled();
  });

  it('surfaces stream errors while downloading', async () => {
    downloadSteps.push((_req, cb) => {
      const res = fakeResponse(200, { 'content-type': 'application/pdf' });
      cb(res);
      res.emit('error', new Error('socket hang up'));
    });

    const res = await uploadAttachmentFromUrl({ file_url: 'https://files.example.com/a.pdf' });

    expect(res).toEqual({ result: null, isError: true, error: 'Error: socket hang up' });
  });

  it('destroys the request and fails on download timeout', async () => {
    downloadSteps.push((req) => req.emit('timeout'));

    const res = await uploadAttachmentFromUrl({ file_url: 'https://slow.example.com/a.pdf' });

    expect(res).toEqual({ result: null, isError: true, error: 'Error: Timed out while downloading file' });
    expect(downloadRequests[0].destroy).toHaveBeenCalled();
  });

  it('surfaces request errors while downloading', async () => {
    downloadSteps.push((req) => req.emit('error', new Error('getaddrinfo ENOTFOUND')));

    const res = await uploadAttachmentFromUrl({ file_url: 'https://nowhere.example.com/a.pdf' });

    expect(res).toEqual({ result: null, isError: true, error: 'Error: getaddrinfo ENOTFOUND' });
  });

  it('returns an error when authentication fails after a good download', async () => {
    (mockQuickbooksClient.authenticate as any).mockRejectedValue(new Error('Auth failed'));
    downloadSteps.push(reply(200, { 'content-type': 'application/pdf' }, 'pdf'));

    const res = await uploadAttachmentFromUrl({ file_url: 'https://files.example.com/a.pdf' });

    expect(res).toEqual({ result: null, isError: true, error: 'Error: Auth failed' });
    expect(httpsRequest).not.toHaveBeenCalled();
  });

  describe('QBO upload failures', () => {
    beforeEach(() => {
      downloadSteps.push(reply(200, { 'content-type': 'application/pdf' }, 'pdf'));
    });

    it('rejects JSON error responses with the status code', async () => {
      const fault = JSON.stringify({ Fault: { Error: [{ Message: 'Invalid file' }] } });
      uploadSteps.push(reply(400, {}, fault));

      const res = await uploadAttachmentFromUrl({ file_url: 'https://files.example.com/a.pdf' });

      expect(res).toEqual({ result: null, isError: true, error: `Error: QBO upload failed (400): ${fault}` });
    });

    it('rejects non-JSON responses', async () => {
      uploadSteps.push(reply(502, {}, '<html>Bad Gateway</html>'));

      const res = await uploadAttachmentFromUrl({ file_url: 'https://files.example.com/a.pdf' });

      expect(res).toEqual({ result: null, isError: true, error: 'Error: QBO upload: unexpected response (502): <html>Bad Gateway</html>' });
    });

    it('accepts a JSON response without a status code', async () => {
      uploadSteps.push(reply(undefined, {}, QBO_OK));

      const res = await uploadAttachmentFromUrl({ file_url: 'https://files.example.com/a.pdf' });

      expect(res).toEqual({ result: JSON.parse(QBO_OK), isError: false, error: null });
    });

    it('surfaces response stream errors', async () => {
      uploadSteps.push((_req, cb) => {
        const res = fakeResponse(200);
        cb(res);
        res.emit('error', new Error('ECONNRESET'));
      });

      const res = await uploadAttachmentFromUrl({ file_url: 'https://files.example.com/a.pdf' });

      expect(res).toEqual({ result: null, isError: true, error: 'Error: ECONNRESET' });
    });

    it('surfaces request errors', async () => {
      uploadSteps.push((req) => req.emit('error', new Error('TLS handshake failed')));

      const res = await uploadAttachmentFromUrl({ file_url: 'https://files.example.com/a.pdf' });

      expect(res).toEqual({ result: null, isError: true, error: 'Error: TLS handshake failed' });
    });
  });
});
