import { afterEach, expect, it, spyOn } from 'bun:test';
import { fetchDocument } from './http.ts';

let fetchSpy: ReturnType<typeof spyOn> | undefined;
afterEach(() => { fetchSpy?.mockRestore(); });

it('rejects a redirect to a private host before issuing a second request', async () => {
  fetchSpy = spyOn(globalThis, 'fetch').mockResolvedValue(new Response(null, { status: 302, headers: { location: 'https://127.0.0.1/private' } }));
  await expect(fetchDocument('https://www.apple.com/newsroom/rss-feed.rss')).rejects.toThrow('Unsupported');
  expect(fetchSpy).toHaveBeenCalledTimes(1);
});

it('does not put SEC contact information into Apple requests', async () => {
  const requestSpy = spyOn(globalThis, 'fetch').mockResolvedValue(new Response('<feed/>'));
  fetchSpy = requestSpy;
  expect(await fetchDocument('https://www.apple.com/newsroom/rss-feed.rss')).toBe('<feed/>');
  expect(new Headers(requestSpy.mock.calls[0]?.[1]?.headers).has('User-Agent')).toBe(false);
});

it('surfaces HTTP access failures rather than retrying around a denial', async () => {
  fetchSpy = spyOn(globalThis, 'fetch').mockResolvedValue(new Response(null, { status: 403 }));
  await expect(fetchDocument('https://www.apple.com/newsroom/rss-feed.rss')).rejects.toThrow('HTTP 403');
  expect(fetchSpy).toHaveBeenCalledTimes(1);
});

it('rejects oversized bodies while reading the response stream', async () => {
  fetchSpy = spyOn(globalThis, 'fetch').mockResolvedValue(new Response(new Uint8Array(15_000_001)));
  await expect(fetchDocument('https://www.apple.com/newsroom/rss-feed.rss')).rejects.toThrow('15 MB');
});

it('honors cancellation before contacting a provider', async () => {
  fetchSpy = spyOn(globalThis, 'fetch');
  await expect(fetchDocument('https://www.apple.com/newsroom/rss-feed.rss', AbortSignal.abort())).rejects.toThrow();
  expect(fetchSpy).not.toHaveBeenCalled();
});
