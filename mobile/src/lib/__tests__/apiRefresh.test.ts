import { ApiError, request } from '@/src/lib/api';
import { sessionStore } from '@/src/lib/session';

jest.mock('@/src/config', () => ({
  appConfig: { apiBaseUrl: 'https://api.test', requestTimeoutMs: 5000, isStaging: false },
}));

let mockStored: { access_token: string; refresh_token: string } | null = null;
jest.mock('@/src/lib/session', () => ({
  sessionStore: {
    get: () => mockStored,
    save: jest.fn(async (next) => { mockStored = next; }),
    clear: jest.fn(async () => { mockStored = null; }),
  },
}));

const json = (body: unknown, status = 200) => ({
  ok: status >= 200 && status < 300,
  status,
  headers: new Headers({ 'content-type': 'application/json' }),
  json: async () => body,
  text: async () => JSON.stringify(body),
});

const token = (access: string) => ({ access_token: access, refresh_token: 'r-1', user: { id: 'u-1' } });

describe('a request whose token is refused', () => {
  beforeEach(() => {
    mockStored = { access_token: 'stale', refresh_token: 'r-1' };
    jest.clearAllMocks();
  });

  it('refreshes once and carries on when the new token is accepted', async () => {
    const fetchMock = jest.fn()
      .mockResolvedValueOnce(json({ detail: 'Token expired.' }, 401))
      .mockResolvedValueOnce(json(token('fresh')))
      .mockResolvedValueOnce(json({ items: [] }));
    globalThis.fetch = fetchMock as never;

    await expect(request('/api/v1/matches')).resolves.toEqual({ items: [] });
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(sessionStore.clear).not.toHaveBeenCalled();
  });

  /**
   * The refresh endpoint answering happily while the resource keeps refusing is
   * what used to recurse without end: refresh, retry, refuse, refresh. The app
   * hung on requests that never settled, which reads as a dead page.
   */
  it('gives up after one refresh rather than looping when it is refused again', async () => {
    const fetchMock = jest.fn(async (url: string) =>
      String(url).includes('/auth/refresh') ? json(token('fresh')) : json({ detail: 'Token expired.' }, 401));
    globalThis.fetch = fetchMock as never;

    await expect(request('/api/v1/matches')).rejects.toBeInstanceOf(ApiError);

    // The resource twice, the refresh once, and then a stop.
    expect(fetchMock).toHaveBeenCalledTimes(3);
    // A token minted seconds ago and still refused means the session is spent,
    // so it is put down and the reader lands on sign-in.
    expect(sessionStore.clear).toHaveBeenCalled();
  });
});
