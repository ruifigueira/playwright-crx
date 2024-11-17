import { NetworkCookie } from "@protocol/channels";

// borrowed from playwright/packages/playwright-core/src/server/network.ts
export function filterCookies(cookies: NetworkCookie[], urls: string[]): NetworkCookie[] {
  const parsedURLs = urls.map(s => new URL(s));
  // Chromiums's cookies are missing sameSite when it is 'None'
  return cookies.filter(c => {
    if (!parsedURLs.length)
      return true;
    for (const parsedURL of parsedURLs) {
      let domain = c.domain;
      if (!domain.startsWith('.'))
        domain = '.' + domain;
      if (!('.' + parsedURL.hostname).endsWith(domain))
        continue;
      if (!parsedURL.pathname.startsWith(c.path))
        continue;
      if (parsedURL.protocol !== 'https:' && parsedURL.hostname !== 'localhost' && c.secure)
        continue;
      return true;
    }
    return false;
  });
}