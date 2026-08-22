import { DEFAULT_ORIGIN } from "@/lib/http.ts";

/** Crawl policy for the public Worker root. */
export const robotsTxt = (origin = DEFAULT_ORIGIN): string => `User-agent: *
Allow: /
Disallow:
Sitemap: ${origin}/sitemap.xml
`;
