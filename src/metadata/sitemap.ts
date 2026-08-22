import { DEFAULT_ORIGIN } from "@/http/request.ts";

// oxlint-disable-next-line sonarjs/no-clear-text-protocols -- The Sitemaps protocol requires this exact HTTP namespace.
const SITEMAP_NAMESPACE = "http://www.sitemaps.org/schemas/sitemap/0.9";

const escapeXml = (value: string): string =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll("'", "&apos;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");

/** Canonical, indexable documentation pages exposed by the Worker. */
export const sitemapXml = (origin = DEFAULT_ORIGIN): string => {
  const urls = ["/", "/docs"]
    .map(
      (path) =>
        `    <url><loc>${escapeXml(new URL(path, origin).toString())}</loc></url>`
    )
    .join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="${SITEMAP_NAMESPACE}">
${urls}
</urlset>
`;
};
