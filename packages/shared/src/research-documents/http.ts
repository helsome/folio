/** Only official connector hosts; redirects cannot turn a disclosure fetch into SSRF. */
const HOSTS = new Set(['data.sec.gov', 'www.sec.gov', 'www.apple.com']);
export type DocumentFetch = (url: string, signal?: AbortSignal) => Promise<string>;

export function assertDocumentUrl(value: string): URL {
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.port || url.username || url.password || !HOSTS.has(url.hostname)) {
    throw new Error('Unsupported research document URL');
  }
  return url;
}

// Serialize SEC request starts, below its published ten requests/second limit.
let secQueue = Promise.resolve();
async function secSlot(signal: AbortSignal) {
  const next = secQueue.then(async () => {
    signal.throwIfAborted();
    await new Promise((resolve) => setTimeout(resolve, 150));
  });
  secQueue = next.catch(() => {});
  await next;
  signal.throwIfAborted();
}

export const fetchDocument: DocumentFetch = async (value, signal) => {
  const timeout = AbortSignal.timeout(15_000);
  const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;
  let url = assertDocumentUrl(value);
  for (let redirect = 0; redirect < 4; redirect++) {
    combined.throwIfAborted();
    const isSec = url.hostname.endsWith('.sec.gov');
    const userAgent = process.env.FINAGENT_SEC_USER_AGENT;
    if (isSec && !userAgent?.trim()) {
      throw new Error('Configure FINAGENT_SEC_USER_AGENT with your organization and contact per SEC fair-access policy');
    }
    if (isSec) await secSlot(combined);
    const response = await fetch(url, {
      signal: combined, redirect: 'manual',
      headers: isSec ? { 'User-Agent': userAgent!, Accept: 'application/json,text/html' } : { Accept: 'application/atom+xml,application/rss+xml,text/html' },
    });
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get('location');
      await response.body?.cancel();
      if (!location) throw new Error('Disclosure redirect has no location');
      url = assertDocumentUrl(new URL(location, url).href);
      continue;
    }
    if (!response.ok) {
      await response.body?.cancel();
      throw new Error(`Disclosure provider returned HTTP ${response.status}`);
    }
    const reader = response.body?.getReader();
    if (!reader) throw new Error('Empty disclosure response');
    const decoder = new TextDecoder();
    let length = 0;
    let text = '';
    try {
      while (true) {
        const chunk = await reader.read();
        if (chunk.done) break;
        length += chunk.value.byteLength;
        if (length > 15_000_000) throw new Error('Disclosure exceeds 15 MB extraction limit');
        text += decoder.decode(chunk.value, { stream: true });
      }
      return text + decoder.decode();
    } finally {
      await reader.cancel();
      reader.releaseLock();
    }
  }
  throw new Error('Too many disclosure redirects');
};
