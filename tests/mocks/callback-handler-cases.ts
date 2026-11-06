/**
 * Shared cases for handlers that authenticate, call a single node-quickbooks
 * method with a trailing (err, result) callback, and wrap the outcome in a
 * ToolResponse. Each generated suite checks the arguments actually sent to
 * QBO, the result shape on success, the QBO error path and the auth failure.
 */
import { describe, it, expect } from '@jest/globals';
import { mockQuickbooksClient, mockQuickBooksInstance } from './quickbooks.mock';

type QboMethod = keyof typeof mockQuickBooksInstance;

export interface CallbackHandlerCase {
  /** Invokes the handler under test. */
  invoke: () => Promise<{ result: unknown; isError: boolean; error: unknown }>;
  /** node-quickbooks method the handler is expected to call. */
  method: QboMethod;
  /** Arguments (excluding the callback) the handler must pass to `method`. */
  expectedArgs: unknown[];
  /** Raw value QBO hands to the callback on success. */
  response?: unknown;
  /** Value the handler should expose as `result` (defaults to `response`). */
  expectedResult?: unknown;
}

function qboMock(method: QboMethod): any {
  return mockQuickBooksInstance[method];
}

export function describeCallbackHandler(name: string, c: CallbackHandlerCase): void {
  const response = 'response' in c ? c.response : { Id: '1', SyncToken: '0' };
  const expectedResult = 'expectedResult' in c ? c.expectedResult : response;

  describe(name, () => {
    it(`sends the input to ${String(c.method)} and returns the QBO result`, async () => {
      const mock = qboMock(c.method);
      mock.mockImplementation((...args: any[]) => args[args.length - 1](null, response));

      const res = await c.invoke();

      expect(mockQuickbooksClient.authenticate).toHaveBeenCalledTimes(1);
      expect(mock).toHaveBeenCalledTimes(1);
      expect(mock.mock.calls[0].slice(0, -1)).toEqual(c.expectedArgs);
      expect(res).toEqual({ result: expectedResult, isError: false, error: null });
    });

    it('returns a formatted error when QBO rejects the call', async () => {
      qboMock(c.method).mockImplementation((...args: any[]) =>
        args[args.length - 1](new Error('QBO rejected the request'), null)
      );

      const res = await c.invoke();

      expect(res).toEqual({ result: null, isError: true, error: 'Error: QBO rejected the request' });
    });

    it('returns a formatted error and skips QBO when authentication fails', async () => {
      (mockQuickbooksClient.authenticate as any).mockRejectedValue(new Error('Auth failed'));

      const res = await c.invoke();

      expect(res).toEqual({ result: null, isError: true, error: 'Error: Auth failed' });
      expect(qboMock(c.method)).not.toHaveBeenCalled();
    });
  });
}
