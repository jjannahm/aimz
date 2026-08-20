import { api } from '@/src/lib/api';

const fetchMock = jest.fn();
globalThis.fetch = fetchMock as unknown as typeof fetch;

function page(items: unknown[], total: number) {
  return {
    ok: true, status: 200,
    json: async () => ({ items, total, limit: 100, offset: 0 }),
    headers: new Headers(),
  };
}

const player = (id: number) => ({ id: `p-${id}`, name: `Player ${id}` });

describe('list endpoints paginate', () => {
  beforeEach(() => fetchMock.mockReset());

  it('returns every player when the roster outgrows one page', async () => {
    const first = Array.from({ length: 100 }, (_, i) => player(i));
    const second = [player(100)];
    fetchMock
      .mockResolvedValueOnce(page(first, 101))
      .mockResolvedValueOnce(page(second, 101));

    const result = await api.players('?limit=100');

    expect(result.items).toHaveLength(101);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    // The second request must ask for the remainder, not repeat page one.
    expect(String(fetchMock.mock.calls[1]![0])).toContain('offset=100');
  });

  it('stops after one request when everything already fits', async () => {
    fetchMock.mockResolvedValueOnce(page([player(1)], 1));
    const result = await api.players();
    expect(result.items).toHaveLength(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('keeps caller filters and never duplicates the limit', async () => {
    fetchMock.mockResolvedValueOnce(page([], 0));
    await api.players('?active=&limit=50');
    const url = String(fetchMock.mock.calls[0]![0]);
    expect(url).toContain('active=');
    expect(url.match(/limit=/gu)).toHaveLength(1);
    expect(url).toContain('limit=100');
  });

  it('does not loop forever if the server reports a total it will not serve', async () => {
    fetchMock
      .mockResolvedValueOnce(page([player(1)], 500))
      .mockResolvedValueOnce(page([], 500));
    const result = await api.teams();
    expect(result.items).toHaveLength(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
