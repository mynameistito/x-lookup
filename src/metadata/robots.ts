import { DEFAULT_ORIGIN } from "@/http/request.ts";

/** Crawl policy for the public Worker root. */
export const robotsTxt = (origin = DEFAULT_ORIGIN): string => `User-agent: *
Allow: /
Disallow:
Content-Signal: ai-train=yes, search=yes, ai-input=yes
Sitemap: ${origin}/sitemap.xml
`;
